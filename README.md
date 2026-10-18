# Offres

Collecte d'offres d'emploi **dev, data / ML et devops en France**, lues sur les pages
carrières publiques des ATS (Greenhouse, Lever, Ashby, SmartRecruiters, Workable).
Découverte de nouvelles entreprises via Serper, suivi de l'ancienneté et de la
fermeture des offres, export CSV.

## Démarrage

```bash
npm install
npm start              # http://localhost:3200
```

Variables d'environnement (fichier `.env`) :

- `SERPER_API_KEY` : découverte d'entreprises
- `FULLENRICH_API_KEY` (optionnel) : emails des contacts
- `ENRICHISSEMENT_DB` (optionnel) : chemin de la base
  [Enrichissement](https://github.com/jmougeot/enrichissement). Par défaut, le dépôt
  `enrichissement` est attendu à côté de celui-ci (`../Enrichissement/data/enrichissement.db`).

La base SQLite reste dans `data/` et n'est pas versionnée.

## Projets liés

- [sequence-mail](https://github.com/jmougeot/sequence-mail) : séquences d'emails et LinkedIn
- [enrichissement](https://github.com/jmougeot/enrichissement) : prospection B2B

## Licence

MIT
