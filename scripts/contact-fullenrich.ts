/**
 * Cherche dans FullEnrich l'email professionnel des contacts d'un ou plusieurs CSV (colonnes linkedin, first_name,
 * last_name, company), par l'API d'enrichissement (1 crédit par adresse trouvée, rien sinon ; un contact déjà enrichi
 * avec les mêmes informations n'est pas refacturé). Le domaine de l'entreprise, s'il est connu de la base (fiche
 * FullEnrich, site), est joint pour aider le rapprochement.
 *   npx tsx scripts/contact-fullenrich.ts <dossier de sortie> <contacts.csv> [<contacts.csv> …]
 *
 * Sortie : `<dossier>/enrichment_<id>.csv`, aux colonnes des exports de l'application FullEnrich, que
 * scripts/campaign-emails.ts lit pour vérifier chaque adresse avant de la rattacher. Rien n'est rattaché ici.
 * Sans FULLENRICH_API_KEY dans .env, ne fait rien.
 */
import fs from "node:fs";
import path from "node:path";
import { contactCompany, csvLine, parseCsv, profile } from "../src/campaign.js";
import { config } from "../src/config.js";
import { db } from "../src/db.js";

const [folder, ...files] = process.argv.slice(2);
if (!folder || !files.length) {
  console.error("Usage : npx tsx scripts/contact-fullenrich.ts <dossier de sortie> <contacts.csv> [<contacts.csv> …]");
  process.exit(1);
}
if (!config.fullenrichApiKey) {
  console.log("FULLENRICH_API_KEY absente de .env : emails non cherchés");
  process.exit(0);
}
fs.mkdirSync(folder, { recursive: true });

const API = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";
const headers = { Authorization: `Bearer ${config.fullenrichApiKey}`, "content-type": "application/json" };
// statuts de l'API → libellés des exports de l'application, ceux qu'attend campaign-emails.ts
const STATUS: Record<string, string> = {
  DELIVERABLE: "Valid & safe to send email",
  HIGH_PROBABILITY: "Probably Valid Email",
  CATCH_ALL: "Catch-all Email",
  INVALID: "Invalid Email",
};

const domainOf = db.prepare(
  `SELECT COALESCE((SELECT domain FROM company_profiles WHERE company_key = ? AND domain IS NOT NULL),
                   (SELECT slug FROM jobs WHERE company_key = ? AND ats = 'site' LIMIT 1)) AS domain`
).pluck();

interface Input { linkedin: string; first_name: string; last_name: string; company: string }
const seen = new Set<string>();
const inputs: Input[] = [];
for (const file of files) {
  for (const r of parseCsv(fs.readFileSync(file, "utf8"))) {
    const id = profile(r.linkedin);
    if (!id || seen.has(id) || (r.email ?? "").trim()) continue;
    seen.add(id);
    inputs.push({ linkedin: r.linkedin, first_name: r.first_name ?? "", last_name: r.last_name ?? "", company: r.company ?? "" });
  }
}
console.log(`${inputs.length} contact(s) à enrichir`);

async function call(url: string, init?: RequestInit): Promise<unknown> {
  // limite de requêtes par minute (429) : on attend la minute demandée, cinq fois au plus
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30000) });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 61000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`FullEnrich ${res.status}: ${text.slice(0, 160)}`), { status: res.status });
    return JSON.parse(text);
  }
}

interface Email { email?: string; status?: string }
interface Employment { title?: string; start_at?: string; company?: { name?: string; domain?: string; website?: string } }
interface Row {
  input?: { professional_network_url?: string };
  custom?: Record<string, string>;
  contact_info?: { most_probable_work_email?: Email; work_emails?: Email[] };
  profile?: { first_name?: string; last_name?: string; full_name?: string; headline?: string; employment?: { current?: Employment } };
}

const COLUMNS = ["LinkedIn Profile Url", "First Name", "Last Name", "Headline", "Job Title", "Job Started At", "Company Name",
  "Company Website", "Email (FullEnrich)", "Bounce Status (FullEnrich)", "All Valid Emails (FullEnrich)"];
const BATCH = 100; // contacts par enrichissement
let credits = 0;
let withEmail = 0;
for (let i = 0; i < inputs.length; i += BATCH) {
  const batch = inputs.slice(i, i + BATCH);
  const start = (await call(API, {
    method: "POST",
    body: JSON.stringify({
      name: `Offres · contacts ${new Date().toISOString().slice(0, 10)} (${i / BATCH + 1})`,
      data: batch.map((c, n) => {
        const domain = domainOf.get(contactCompany(c.linkedin, c.company), contactCompany(c.linkedin, c.company)) as string | null;
        return {
          first_name: c.first_name, last_name: c.last_name, company_name: c.company, ...(domain && { domain }),
          linkedin_url: c.linkedin, enrich_fields: ["contact.work_emails"], custom: { n: String(i + n) },
        };
      }),
    }),
  })) as { enrichment_id: string };
  const id = start.enrichment_id;
  console.log(`enrichissement ${id} : ${batch.length} contact(s) envoyé(s)`);
  // l'enrichissement prend quelques minutes : relevé toutes les 20 s, une heure au plus
  let result: { status?: string; cost?: { credits?: number }; data?: Row[] } | null = null;
  for (let t = 0; t < 180; t++) {
    await new Promise((r) => setTimeout(r, 20000));
    try {
      result = (await call(`${API}/${id}`)) as typeof result;
    } catch (err) {
      if ((err as { status?: number }).status === 400) continue; // encore en cours
      throw err;
    }
    if (result?.status === "FINISHED") break;
  }
  if (result?.status !== "FINISHED") {
    console.error(`enrichissement ${id} non terminé au bout d'une heure : relevé abandonné (à relire avec ?forceResults=true)`);
    continue;
  }
  credits += result.cost?.credits ?? 0;
  const lines = [COLUMNS.map((c) => `"${c}"`).join(",")];
  for (const r of result.data ?? []) {
    const c = inputs[Number(r.custom?.n)];
    if (!c) continue;
    const best = r.contact_info?.most_probable_work_email;
    const job = r.profile?.employment?.current;
    if (best?.email) withEmail++;
    lines.push(csvLine([
      c.linkedin, r.profile?.first_name ?? c.first_name, r.profile?.last_name ?? c.last_name, r.profile?.headline ?? "",
      job?.title ?? "", job?.start_at ?? "", job?.company?.name ?? "", job?.company?.website ?? job?.company?.domain ?? "",
      best?.email ?? "", STATUS[best?.status ?? ""] ?? best?.status ?? "",
      (r.contact_info?.work_emails ?? []).filter((e) => e.status === "DELIVERABLE").map((e) => e.email).join(" "),
    ]));
  }
  const out = path.join(folder, `enrichment_${id.slice(0, 8)}.csv`);
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`→ ${out}`);
}
console.log(`${withEmail}/${inputs.length} adresse(s) trouvée(s) · ${credits} crédit(s) FullEnrich`);
