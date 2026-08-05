# Suivi Commercial

Application de suivi commercial (assurances & crédits) pour une équipe : saisie des dossiers, suivi des objectifs mensuels, gestion d'équipe, export Excel mensuel.

## Démarrage (développement)

```bash
npm install
npm run pages:dev
```

`pages:dev` lance Vite (avec hot-reload) et Wrangler en local par-dessus, avec l'API (`functions/api/`) branchée sur du KV simulé localement — aucun compte Cloudflare requis pour développer. L'application est disponible sur l'URL affichée par Wrangler (en général http://localhost:8788).

## Stack

- React + Vite
- Tailwind CSS
- lucide-react (icônes)
- Cloudflare Pages Functions + KV (backend)
- xlsx / SheetJS (export Excel)

## Backend

Le backend (`functions/api/storage/[key].js`) est une Cloudflare Pages Function : elle expose une API clé/valeur (`GET/PUT /api/storage/:key`) et persiste les données dans un namespace **Cloudflare KV**. C'est là que sont stockés les membres, les ventes déclarées et les chiffres officiels du mois — partagés par tous les utilisateurs, quel que soit leur navigateur ou appareil, sans serveur à gérer.

Le "dernier compte connecté" (pour l'auto-login) reste dans le `localStorage` du navigateur : c'est une préférence locale à l'appareil, elle n'a pas besoin d'être partagée.

**Limites** : KV est une base clé/valeur "eventually consistent" (propagation globale en quelques dizaines de secondes dans le pire cas) — largement suffisant pour une saisie occasionnelle en équipe, mais pas fait pour de l'écriture concurrente à haute fréquence. Pas d'authentification par mot de passe (le code responsable protège seulement la mise à jour des chiffres officiels). Pour aller plus loin, remplacer le binding KV par **Cloudflare D1** (SQLite managé, cohérence forte) dans `functions/api/storage/[key].js`.

## Déploiement sur Cloudflare

1. **Créer le namespace KV** (une seule fois) :
   ```bash
   npx wrangler login
   npx wrangler kv namespace create STORAGE_KV
   ```
   Copier l'`id` retourné dans `wrangler.toml` (remplace `REMPLACER_PAR_L_ID_DU_NAMESPACE_KV`).

2. **Déployer** :
   ```bash
   npm run deploy
   ```
   Ceci build le frontend (`vite build`) puis publie `dist/` + les functions via `wrangler pages deploy`.

   Alternative recommandée pour les déploiements automatiques : connecter le repo GitHub directement à un projet **Cloudflare Pages** depuis le dashboard Cloudflare (Workers & Pages → Create → Pages → Connect to Git). Renseigner la commande de build `npm run build` et le dossier de sortie `dist`, puis lier le namespace KV au projet dans Settings → Functions → KV namespace bindings (nom du binding : `STORAGE_KV`). Chaque push sur la branche configurée redéploie automatiquement.

## Export Excel

Dans l'onglet **Suivi & objectifs**, le responsable dispose d'un bouton **Exporter en Excel** qui télécharge un fichier `.xlsx` (`suivi-commercial-AAAA-MM.xlsx`) avec, pour chaque collaborateur : assurances réalisées/objectif, détail des crédits par type (PAT/OCA/BPR/MP7), total crédits/objectif, et nombre de dossiers déclarés dans le journal. Pratique à générer en fin de mois pour archiver les chiffres officiels de toute l'équipe.

## Comptes

- **Collaborateur** : nom + e-mail suffisent pour créer un compte.
- **Responsable** : nécessite le code d'accès (`OVB2026`, modifiable dans `src/App.jsx`).
