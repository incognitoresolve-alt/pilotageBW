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

## Synchronisation entre utilisateurs

Les données partagées (membres, ventes, chiffres, invitations) ne sont chargées qu'une fois à l'ouverture de l'application — sans mécanisme de rafraîchissement, un responsable qui garde l'onglet ouvert ne verrait jamais les ventes déclarées entre-temps par un collaborateur (et inversement). Pour éviter ça, l'application se resynchronise automatiquement :

- au retour sur l'onglet (évènements `visibilitychange` / `focus`) ;
- toutes les 30 secondes tant que l'onglet reste ouvert ;
- à tout moment via le bouton d'actualisation (icône ↻) dans l'en-tête.

Ce rafraîchissement est silencieux (pas de notification, sauf en cas d'échec) pour l'automatique, et confirmé par un toast pour le bouton manuel. C'est un rafraîchissement en arrière-plan, pas du temps réel — un écart de quelques secondes à quelques dizaines de secondes entre deux utilisateurs reste possible, cohérent avec le modèle KV décrit ci-dessus.

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

## Graphique de performance

Dans **Suivi & objectifs**, chaque carte collaborateur affiche un graphique linéaire "Performance — dossiers vendus" (nombre de ventes déclarées, assurances + crédits confondus, pondéré par la quantité pour les assurances). Quatre bascules — **Jour** (14 derniers jours), **Semaine** (8 dernières semaines), **Mois** (6 derniers mois), **Année** (5 dernières années) — recalculent la série depuis le journal des ventes déclarées, tous mois confondus (contrairement au reste de l'onglet qui reste centré sur le mois consulté). Survoler le graphique affiche un repère + une infobulle ; un détail chiffré par période (tableau) est disponible sous le graphique, replié par défaut, pour un accès sans souris.

## Journal des ventes

L'onglet **Journal** offre une vue structurée des ventes, jour par jour (au lieu d'une simple liste plate) : chaque jour est une section avec un dossier de détail, et le détail des dossiers déclarés ce jour-là. Un collaborateur y voit son propre journal ; le responsable y voit celui de toute l'équipe, avec le nom du vendeur sur chaque ligne, et peut supprimer n'importe quel dossier (pas seulement les siens). Navigation par mois comme dans "Suivi & objectifs". Dans **Ma saisie**, la carte "Mes ventes du jour" ne montre plus que les ventes du jour même (avec un lien direct vers le Journal complet) — pratique juste après avoir déclaré une vente, sans être noyé dans tout l'historique du mois.

Le récapitulatif de chaque jour reprend la présentation du tableau papier utilisé par l'équipe : un tableau avec une colonne par produit (ALLIN, DIMC, DIM pour les assurances ; PAT, OCA, BPR, MP7, AUG, DIM pour les crédits — PAT et BPR scindés en Papier/eDirect), plutôt qu'un simple total. Zone teal = assurances (nombre), zone ambre = crédits (montant) ; les cases sans activité affichent un tiret plutôt qu'un zéro, pour que l'œil aille directement à ce qui bouge.

## Crédits financés — saisie quotidienne du responsable

Contrairement aux assurances (déclarées par les collaborateurs et comptabilisées automatiquement), les crédits financés sont validés par le **responsable**, au jour le jour, depuis le panneau "Mettre à jour" de chaque collaborateur dans **Suivi & objectifs**. Pour une date donnée (aujourd'hui par défaut, modifiable), le responsable saisit, pour chaque type de crédit (PAT/OCA/BPR/MP7/AUG/DIM), le **nombre** de dossiers financés et le **montant** total financé. Changer la date recharge la saisie déjà enregistrée ce jour-là (pour la corriger) ou un formulaire vide (pour un nouveau jour) ; le panneau reste ouvert après l'enregistrement pour saisir plusieurs jours à la suite.

Le total "Crédits (total)" et le détail par type qu'on voit ailleurs dans l'app (export Excel compris) sont la somme de toutes ces saisies quotidiennes du mois consulté — plus, le cas échéant, un chiffre "historique" antérieur à cette fonctionnalité (jamais perdu, jamais réécrit, simplement additionné une fois pour toutes).

Pour **PAT** et **BPR**, la saisie du jour se scinde en **Papier** et **eDirect** (comme le type de contrat déjà distingué côté collaborateur dans "Ma saisie") : deux paires nombre/montant distinctes, stockées comme deux enregistrements séparés mais additionnées ensemble dans le total du type.

## Comptes

- **Collaborateur** : la création d'un compte se fait uniquement par **invitation** — voir ci-dessous. Une fois le compte créé, la connexion se fait ensuite par simple nom + e-mail (comme avant).
- **Responsable** : nécessite le code d'accès, défini par `MANAGER_CODE` dans `wrangler.toml` (à personnaliser avant mise en production). Contrairement à `APP_SECRET`, ce code est vérifié côté Worker (`POST /api/verify-manager-code`) et n'est **jamais envoyé au navigateur** — sa valeur reste un vrai secret, invisible dans le bundle JS public.

## Invitation des collaborateurs

Depuis l'onglet **Équipe**, le responsable génère un lien d'invitation unique pour chaque nouveau collaborateur (nom + e-mail), puis l'envoie lui-même par le canal de son choix (e-mail, WhatsApp, SMS…) — **aucun service tiers d'envoi d'e-mail n'est utilisé**. Le lien (`https://.../?invite=<jeton>`) contient un jeton aléatoire de 24 octets généré via `crypto.getRandomValues`. La personne qui le reçoit clique dessus, vérifie que le nom/e-mail affichés sont bien les siens, puis clique sur "Activer mon compte" pour créer son profil et se connecter directement.

Un lien d'invitation ne peut être utilisé qu'une seule fois (il est marqué `used` après activation) et peut être révoqué à tout moment tant qu'il n'a pas été utilisé. L'auto-inscription libre (n'importe qui créant un compte avec un nom + e-mail arbitraires) a été supprimée : sans invitation valide, un e-mail inconnu ne peut plus se connecter côté collaborateur.
