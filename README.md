# Suivi Commercial

Application de suivi commercial (assurances & crédits) pour une équipe : saisie des dossiers, suivi des objectifs mensuels, gestion d'équipe, export Excel mensuel.

## Démarrage (développement)

```bash
npm install
cp .env.example .env.local        # choisir une valeur pour VITE_APP_SECRET
cp .dev.vars.example .dev.vars    # même valeur pour APP_SECRET
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

**Limites** : KV est une base clé/valeur "eventually consistent" (propagation globale en quelques dizaines de secondes dans le pire cas) — largement suffisant pour une saisie occasionnelle en équipe, mais pas fait pour de l'écriture concurrente à haute fréquence (deux sauvegardes quasi simultanées peuvent s'écraser l'une l'autre). Pour aller plus loin, remplacer le binding KV par **Cloudflare D1** (SQLite managé, cohérence forte) dans `worker/index.js`.

## Sécurité

L'API (`/api/storage/*`) exige un header `X-App-Secret` correspondant au secret `APP_SECRET` configuré côté Worker — sans lui, impossible de lire ou d'écrire les données directement (curl, script, etc.) sans passer par l'application. Le frontend l'envoie automatiquement, sa valeur est injectée au build via la variable `VITE_APP_SECRET`.

⚠️ Ce n'est **pas** une authentification par utilisateur : la valeur finit dans le fichier JS envoyé au navigateur, donc quelqu'un qui inspecte le bundle peut la récupérer. Ça bloque l'accès direct et non authentifié à l'API pour un visiteur ou un robot qui tomberait sur l'URL, mais ce n'est pas une protection contre quelqu'un de déterminé. Il n'y a par ailleurs pas de mot de passe à la connexion collaborateur (nom + e-mail suffisent) : à n'utiliser que dans un cadre de confiance (équipe restreinte, URL non publicisée). Pour une vraie protection, la prochaine étape recommandée est **Cloudflare Access** (Zero Trust, gratuit jusqu'à 50 utilisateurs) : il permet d'exiger une vérification d'e-mail avant que quiconque n'atteigne le site, y compris l'API — se configure entièrement depuis le dashboard Cloudflare (Zero Trust → Access → Applications), sans changement de code.

Les deux valeurs `APP_SECRET` (Worker) et `VITE_APP_SECRET` (build frontend) doivent être **identiques** — n'importe quelle chaîne aléatoire suffit (ex. générée avec `openssl rand -hex 16`).

## Déploiement sur Cloudflare

1. **Créer le namespace KV** (une seule fois) :
   ```bash
   npx wrangler login
   npx wrangler kv namespace create STORAGE_KV
   ```
   Copier l'`id` retourné dans `wrangler.toml` (remplace `REMPLACER_PAR_L_ID_DU_NAMESPACE_KV`).

2. **Choisir et configurer le secret partagé** (voir section Sécurité ci-dessus) :
   - Côté Worker : dashboard Cloudflare → le projet → **Paramètres** → **Variables et secrets** → Ajouter → nom `APP_SECRET`, cocher "Encrypt"/"Secret", coller la valeur choisie.
   - Côté build frontend : même section (ou l'équivalent "Build variables" selon l'interface) → ajouter une variable `VITE_APP_SECRET` avec la **même** valeur, disponible au moment du `npm run build`.

3. **Déployer** :
   ```bash
   npm run deploy
   ```
   Ceci build le frontend (`vite build`, en lisant `VITE_APP_SECRET` depuis l'environnement) puis publie le Worker + les assets via `wrangler deploy`.

   Alternative recommandée pour les déploiements automatiques : connecter le repo GitHub à un projet **Workers** depuis le dashboard Cloudflare (Compute (Workers) → Create → Connect to Git). Cloudflare lit `wrangler.toml`, exécute `npm run build` puis `wrangler deploy` à chaque push — il faut juste avoir renseigné `APP_SECRET` et `VITE_APP_SECRET` comme à l'étape 2, et lier le namespace KV créé à l'étape 1 si `wrangler.toml` ne suffit pas à le résoudre automatiquement.

   ⚠️ Tant que `APP_SECRET`/`VITE_APP_SECRET` ne sont pas configurés, l'application se charge mais apparaît vide (l'API renvoie 401) — à faire avant ou juste après le premier déploiement avec cette protection.

## Export Excel

Dans l'onglet **Suivi & objectifs**, le responsable dispose d'un bouton **Exporter en Excel** qui télécharge un fichier `.xlsx` (`suivi-commercial-AAAA-MM.xlsx`) avec, pour chaque collaborateur : assurances réalisées/objectif, détail des crédits par type (PAT/OCA/BPR/MP7), total crédits/objectif, et nombre de dossiers déclarés dans le journal. Pratique à générer en fin de mois pour archiver les chiffres officiels de toute l'équipe.

## Comptes

- **Collaborateur** : nom + e-mail suffisent pour créer un compte.
- **Responsable** : nécessite le code d'accès (défini par `MANAGER_CODE` dans `src/App.jsx`, à personnaliser avant mise en production).
