# Contribuer

- Lancer en local : `npm install`, créer un `.env` avec `SERPER_API_KEY` (voir le README), puis `npm run dev` (http://localhost:3200).
- Avant une PR : `npm run typecheck` (`tsc --noEmit`).
- PR courtes et ciblées ; jamais de clés API, de `.env`, de base SQLite ni de données personnelles.
- Ce dépôt est un miroir de l'arbre du mainteneur, régénéré à chaque publication : les PR ne sont pas mergées via GitHub. Une PR est relue ici, appliquée en amont avec vous comme auteur du commit, republiée sur ce dépôt, puis fermée avec un lien vers le commit. La paternité est conservée dans l'historique.
