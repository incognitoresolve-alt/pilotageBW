# Suivi Commercial

Application de suivi commercial (assurances & crédits) pour une équipe : saisie des dossiers, suivi des objectifs mensuels, gestion d'équipe, export Excel mensuel.

## Démarrage (développement)

```bash
npm install
cp .env.example .env.local   # VITE_APP_SECRET, doit matcher APP_SECRET dans wrangler.toml
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

L'API (`/api/storage/*`) exige un header `X-App-Secret` correspondant à `APP_SECRET` — sans lui, impossible de lire ou d'écrire les données directement (curl, script, etc.) sans passer par l'application. Le frontend l'envoie automatiquement, sa valeur est injectée au build via la variable `VITE_APP_SECRET`.

⚠️ Ce n'est **pas** une authentification par utilisateur : la valeur finit dans le fichier JS envoyé au navigateur, donc quelqu'un qui inspecte le bundle peut la récupérer. Ça bloque l'accès direct et non authentifié à l'API pour un visiteur ou un robot qui tomberait sur l'URL, mais ce n'est pas une protection contre quelqu'un de déterminé. Il n'y a par ailleurs pas de mot de passe à la connexion collaborateur (nom + e-mail suffisent) : à n'utiliser que dans un cadre de confiance (équipe restreinte, URL non publicisée). Pour une vraie protection, la prochaine étape recommandée est **Cloudflare Access** (Zero Trust, gratuit jusqu'à 50 utilisateurs) : il permet d'exiger une vérification d'e-mail avant que quiconque n'atteigne le site, y compris l'API — se configure entièrement depuis le dashboard Cloudflare (Zero Trust → Access → Applications), sans changement de code.

**`APP_SECRET` est défini directement dans `wrangler.toml`** (sous `[vars]`), pas via le dashboard Cloudflare. Ce choix vient d'un comportement observé sur ce projet : avec un déploiement Git-connecté exécutant `wrangler deploy`, les variables/secrets configurés dans le dashboard (que ce soit sous "Paramètres → Variables et secrets" ou sous "Liaisons") n'étaient jamais effectivement liés au Worker au moment du déploiement — seul `wrangler.toml` faisait foi (vérifiable dans les logs de build, qui listent "Your worker has access to the following bindings" et n'affichaient jamais `APP_SECRET`, contrairement à `STORAGE_KV` qui lui est déclaré dans `wrangler.toml`). Le mettre directement dans `wrangler.toml` élimine cette source d'échec — sans perte de confidentialité réelle puisque cette valeur est de toute façon publique côté client (voir ci-dessus).

`VITE_APP_SECRET`, en revanche, reste une variable de **build**, configurée dans le dashboard Cloudflare (Paramètres → Variables et secrets) — elle doit avoir la **même valeur** que `APP_SECRET` dans `wrangler.toml`. Si tu changes l'une des deux, il faut changer l'autre pour qu'elles restent identiques, puis redéployer.

## Déploiement sur Cloudflare

1. **Créer le namespace KV** (une seule fois) :
   ```bash
   npx wrangler login
   npx wrangler kv namespace create STORAGE_KV
   ```
   Copier l'`id` retourné dans `wrangler.toml` (remplace `REMPLACER_PAR_L_ID_DU_NAMESPACE_KV`).

2. **Vérifier/changer le secret partagé** (voir section Sécurité ci-dessus) :
   - `APP_SECRET` dans `wrangler.toml` — déjà défini, à changer si besoin (n'importe quelle chaîne aléatoire, ex. `openssl rand -hex 16`).
   - `VITE_APP_SECRET` côté dashboard Cloudflare → le projet → **Paramètres** → **Variables et secrets** → variable (non chiffrée) avec la **même** valeur que `APP_SECRET` ci-dessus.

3. **Déployer** :
   ```bash
   npm run deploy
   ```
   Ceci build le frontend (`vite build`, en lisant `VITE_APP_SECRET` depuis l'environnement) puis publie le Worker + les assets via `wrangler deploy` (qui lit `APP_SECRET` depuis `wrangler.toml`).

   Alternative recommandée pour les déploiements automatiques : connecter le repo GitHub à un projet **Workers** depuis le dashboard Cloudflare (Compute (Workers) → Create → Connect to Git). Cloudflare exécute `npm run build` puis `wrangler deploy` à chaque push — il faut juste avoir renseigné `VITE_APP_SECRET` comme à l'étape 2 (identique à `APP_SECRET` du `wrangler.toml` commité).

   ⚠️ Si l'application se charge mais apparaît vide avec un bandeau rouge (l'API renvoie 401), le message affiché indique désormais la cause exacte (secret absent côté serveur, longueurs différentes, etc.) — voir `worker/index.js`.

## Export Excel

Dans l'onglet **Suivi & objectifs**, le responsable dispose d'un bouton **Exporter en Excel** qui télécharge un fichier `.xlsx` (`suivi-commercial-AAAA-MM.xlsx`) avec, pour chaque collaborateur : assurances réalisées/objectif, détail des crédits par type (PAT/OCA/BPR/MP7), total crédits/objectif, et nombre de dossiers déclarés dans le journal. Pratique à générer en fin de mois pour archiver les chiffres officiels de toute l'équipe.

## Comptes

- **Collaborateur** : nom + e-mail suffisent pour créer un compte.
- **Responsable** : nécessite le code d'accès (défini par `MANAGER_CODE` dans `src/App.jsx`, à personnaliser avant mise en production).
