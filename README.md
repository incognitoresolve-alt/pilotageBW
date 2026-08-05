# Suivi Commercial

Application de suivi commercial (assurances & crédits) pour une équipe : saisie des dossiers, suivi des objectifs mensuels, gestion d'équipe, export Excel mensuel.

## Démarrage (développement)

```bash
npm install
npm run worker:dev
```

`worker:dev` build le frontend puis lance Wrangler en local (Worker + assets statiques + KV simulé) — aucun compte Cloudflare requis pour développer. L'application est disponible sur l'URL affichée par Wrangler (en général http://localhost:8787). Après une modification du frontend, relancer la commande (ou builder dans un autre terminal avec `npm run build` en watch) pour rafraîchir les assets servis.

## Stack

- React + Vite
- Tailwind CSS
- lucide-react (icônes)
- Cloudflare Worker + Assets statiques + KV (backend)
- xlsx / SheetJS (export Excel)

## Backend

Le backend (`worker/index.js`) est un **Cloudflare Worker** unique qui sert à la fois les fichiers statiques du build (`dist/`, via le binding `ASSETS` déclaré dans `wrangler.toml`) et une API clé/valeur (`GET/PUT /api/storage/:key`) adossée à un namespace **Cloudflare KV**. C'est là que sont stockés les membres, les ventes déclarées et les chiffres officiels du mois — partagés par tous les utilisateurs, quel que soit leur navigateur ou appareil, sans serveur à gérer.

Le "dernier compte connecté" (pour l'auto-login) reste dans le `localStorage` du navigateur : c'est une préférence locale à l'appareil, elle n'a pas besoin d'être partagée.

**Limites** : KV est une base clé/valeur "eventually consistent" (propagation globale en quelques dizaines de secondes dans le pire cas) — largement suffisant pour une saisie occasionnelle en équipe, mais pas fait pour de l'écriture concurrente à haute fréquence. Pas d'authentification par mot de passe (le code responsable protège seulement la mise à jour des chiffres officiels). Pour aller plus loin, remplacer le binding KV par **Cloudflare D1** (SQLite managé, cohérence forte) dans `worker/index.js`.

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
   Ceci build le frontend (`vite build`) puis publie le Worker + les assets via `wrangler deploy`.

   Alternative recommandée pour les déploiements automatiques : connecter le repo GitHub à un projet **Workers** depuis le dashboard Cloudflare (Compute (Workers) → Create → Connect to Git). Cloudflare lit `wrangler.toml`, exécute `npm run build` puis `wrangler deploy` à chaque push — il faut juste lier le namespace KV créé à l'étape 1 dans les paramètres du projet (Settings → Bindings → KV Namespace, binding `STORAGE_KV`) si `wrangler.toml` ne suffit pas à le résoudre automatiquement.

## Export Excel

Dans l'onglet **Suivi & objectifs**, le responsable dispose d'un bouton **Exporter en Excel** qui télécharge un fichier `.xlsx` (`suivi-commercial-AAAA-MM.xlsx`) avec, pour chaque collaborateur : assurances réalisées/objectif, détail des crédits par type (PAT/OCA/BPR/MP7), total crédits/objectif, et nombre de dossiers déclarés dans le journal. Pratique à générer en fin de mois pour archiver les chiffres officiels de toute l'équipe.

## Comptes

- **Collaborateur** : nom + e-mail suffisent pour créer un compte.
- **Responsable** : nécessite le code d'accès (`OVB2026`, modifiable dans `src/App.jsx`).
