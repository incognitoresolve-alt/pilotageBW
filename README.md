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

## Design

Palette "navy & laiton" façon banque privée (bleu marine très profond, laiton/or discret, bourgogne pour le responsable, sur fond crème neutre, cartes blanches en légère élévation) et pairing typographique Fraunces (titres, gros chiffres — serif éditorial à graisse variable) + Inter (corps de texte), volontairement à l'écart des couples Space Grotesk/Sora omniprésents dans les interfaces générées automatiquement. Tous les tokens (couleurs, ombre de carte, polices) sont centralisés dans `THEME`, `MANAGER_ACCENT` et `FONT_DISPLAY`/`FONT_BODY` en tête de `src/App.jsx` — les modifier là se répercute sur toute l'application.

**Mobile** : l'application est utilisable sur téléphone (aucun défilement horizontal parasite, quel que soit l'onglet). Le bandeau d'onglets défile horizontalement au doigt sur les petits écrans plutôt que de déborder de l'écran ; les toasts s'étalent en pleine largeur (marges de 1rem) au lieu de risquer de sortir du cadre. Attention en ajoutant de nouvelles grilles responsives (`sm:grid-cols-N`, `md:grid-cols-N`) : toujours poser une classe `grid-cols-1` de base avant le préfixe — sans elle, Tailwind ne génère pas le `minmax(0, 1fr)` qui empêche un contenu large de faire déborder toute la page sur mobile (bug rencontré et corrigé sur plusieurs grilles de l'app).

## Robustesse des formulaires

Tous les boutons qui déclenchent un enregistrement réseau (nouvelle vente, connexion responsable, objectifs, crédits du jour, invitation d'un collaborateur…) sont protégés contre le double envoi : un état "en cours" désactive le bouton et affiche un indicateur de chargement pendant l'appel, jusqu'à la fin de la requête — un double-clic ou une connexion lente ne peut donc pas créer deux fois la même donnée. Les actions destructrices (suppression d'un dossier, retrait d'un membre, révocation d'une invitation, restauration depuis l'historique) passent toutes par un bouton à double confirmation (`ConfirmActionButton`) : un premier clic arme un bouton "Confirmer" affiché quelques secondes, le second déclenche réellement l'action.

Les champs numériques critiques (nombre d'assurances vendues, montant d'un crédit) refusent une valeur nulle ou négative, à la fois via l'attribut HTML `min` (le navigateur bloque la soumission avant même que le code ne s'exécute) et via une vérification côté application pour les cas que `min` ne couvre pas — avec un message d'erreur explicite dans les deux cas.

Un `ErrorBoundary` React (`src/lib/ErrorBoundary.jsx`) entoure toute l'application : une exception JS imprévue n'importe où dans l'arbre de composants affiche un écran d'erreur clair avec un bouton "Recharger" au lieu d'un écran blanc silencieux.

## Backend

Le backend (`worker/index.js`) est un **Cloudflare Worker** unique qui sert à la fois les fichiers statiques du build (`dist/`, via le binding `ASSETS` déclaré dans `wrangler.toml`) et une API clé/valeur (`GET/PUT /api/storage/:key`) adossée à un namespace **Cloudflare KV**. C'est là que sont stockés les membres, les ventes déclarées et les chiffres officiels du mois — partagés par tous les utilisateurs, quel que soit leur navigateur ou appareil, sans serveur à gérer.

Le "dernier compte connecté" (pour l'auto-login) reste dans le `localStorage` du navigateur : c'est une préférence locale à l'appareil, elle n'a pas besoin d'être partagée.

**Limites** : KV est une base clé/valeur "eventually consistent" (propagation globale en quelques dizaines de secondes dans le pire cas) — largement suffisant pour une saisie occasionnelle en équipe, mais pas fait pour de l'écriture concurrente à haute fréquence. Chaque collection partagée (`members`, `entries`, `deletionHistory`, `invites`, `creditRecords`) porte désormais un numéro de version (métadonnée KV, incrémentée à chaque écriture) : avant d'écrire, l'app précise la version qu'elle pensait modifier, et le Worker refuse (409) si elle a changé entre-temps plutôt que d'écraser silencieusement le travail de quelqu'un d'autre — l'app annule alors sa modification locale, prévient l'utilisateur et se resynchronise. Ça élimine les pertes silencieuses lors d'écritures concurrentes sur la même collection ; ça ne fusionne pas automatiquement deux modifications simultanées (il faut réessayer après resynchronisation). Pour aller plus loin, remplacer le binding KV par **Cloudflare D1** (SQLite managé, cohérence forte, transactions) dans `worker/index.js`.

## Synchronisation entre utilisateurs

Les données partagées (membres, ventes, chiffres, invitations) ne sont chargées qu'une fois à l'ouverture de l'application — sans mécanisme de rafraîchissement, un responsable qui garde l'onglet ouvert ne verrait jamais les ventes déclarées entre-temps par un collaborateur (et inversement). Pour éviter ça, l'application se resynchronise automatiquement :

- au retour sur l'onglet (évènements `visibilitychange` / `focus`) ;
- toutes les 30 secondes tant que l'onglet reste ouvert ;
- à tout moment via le bouton d'actualisation (icône ↻) dans l'en-tête.

Ce rafraîchissement est silencieux (pas de notification, sauf en cas d'échec) pour l'automatique, et confirmé par un toast pour le bouton manuel. C'est un rafraîchissement en arrière-plan, pas du temps réel — un écart de quelques secondes à quelques dizaines de secondes entre deux utilisateurs reste possible, cohérent avec le modèle KV décrit ci-dessus.

## Sécurité

L'API (`/api/storage/*`) exige un header `X-App-Secret` correspondant à `APP_SECRET` — sans lui, impossible de lire ou d'écrire les données directement (curl, script, etc.) sans passer par l'application. Le frontend l'envoie automatiquement, sa valeur est injectée au build via la variable `VITE_APP_SECRET`.

⚠️ Ce n'est **pas** une authentification par utilisateur : la valeur finit dans le fichier JS envoyé au navigateur, donc quelqu'un qui inspecte le bundle peut la récupérer. Ça bloque l'accès direct et non authentifié à l'API pour un visiteur ou un robot qui tomberait sur l'URL, mais ce n'est pas une protection contre quelqu'un de déterminé — à n'utiliser que dans un cadre de confiance (équipe restreinte, URL non publicisée). La connexion collaborateur exige désormais un mot de passe personnel (voir "Mot de passe collaborateur" ci-dessous), qui empêche l'usurpation occasionnelle d'un profil par un collègue, mais ne remplace pas une vraie authentification côté infrastructure — la distinction responsable/collaborateur reste appliquée côté interface, pas par l'API elle-même (`/api/storage/*` ne connaît aucune notion de rôle). Pour une vraie protection, la prochaine étape recommandée est **Cloudflare Access** (Zero Trust, gratuit jusqu'à 50 utilisateurs) : il permet d'exiger une vérification d'e-mail avant que quiconque n'atteigne le site, y compris l'API — se configure entièrement depuis le dashboard Cloudflare (Zero Trust → Access → Applications), sans changement de code.

**Protections en place côté authentification collaborateur/responsable** :
- Au rechargement de la page, la session restaurée depuis `localStorage` n'est jamais utilisée telle quelle : seul son `id` sert à retrouver le membre à jour côté serveur (rôle inclus) — modifier son `localStorage` ne permet donc pas de s'attribuer le rôle "responsable".
- Les mots de passe sont hachés en PBKDF2-SHA256 salé (300 000 itérations pour tout nouveau mot de passe ; les mots de passe existants restent vérifiables à leur nombre d'itérations d'origine et sont mis à niveau au prochain changement), comparés à temps constant.
- `login-member`, `verify-manager-code`, `set-password` et `reset-password` sont limités en tentatives (fenêtre de 15 minutes, par e-mail ou par IP selon l'endpoint) pour décourager le brute-force.

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

## Graphique de performance (assurances)

Dans **Suivi & objectifs**, chaque collaborateur a un graphique linéaire "Performance — assurances vendues" (nombre d'assurances déclarées, pondéré par la quantité), sur sa carte.

Côté **responsable**, ce graphique est **fusionné** : une seule courbe jaune pour le collaborateur et une seule courbe bleu marine pour l'équipe complète ("Équipe DirectSales"), distinguées par une légende (pastille de couleur + libellé) — jamais deux graphiques séparés. Le survol affiche une infobulle unique donnant la valeur des deux séries pour la période pointée. Côté **collaborateur**, seule sa propre courbe est affichée (pas de légende, pas de données d'équipe — la performance globale de l'équipe reste réservée à l'interface responsable).

Quatre bascules — **Jour** (14 derniers jours), **Semaine** (8 dernières semaines), **Mois** (6 derniers mois), **Année** (5 dernières années) — recalculent la ou les séries depuis le journal des ventes déclarées, tous mois confondus (contrairement au reste de l'onglet qui reste centré sur le mois consulté). Un détail chiffré par période (tableau) est disponible sous le graphique, replié par défaut, pour un accès sans souris.

La carte de chaque collaborateur dans Suivi & objectifs se limite, côté responsable, aux chiffres-clés (Assurances/Crédits/Montant) et à ce graphique — le récapitulatif du jour (voir plus bas) n'y apparaît plus, pour rester concentré sur la performance. Un collaborateur continue de voir son propre récapitulatif du jour sur sa carte.

## Sélection d'un collaborateur (vue d'ensemble)

Côté **responsable**, l'onglet Suivi & objectifs n'affiche plus toutes les cartes détaillées de l'équipe en même temps — ça devient vite ingérable au-delà de quelques collaborateurs. Une carte "Vue d'ensemble" liste tout le monde de façon compacte (nom, e-mail, un badge de statut) avec un champ de recherche et un menu déroulant "Choisir un collaborateur" ; un clic sur une ligne (ou une sélection dans le menu) affiche juste en dessous la carte détaillée (objectifs, graphique, saisie des crédits) de la personne choisie — une seule à la fois.

Le badge de statut compare, pour le mois en cours, la progression réelle de chaque objectif fixé (> 0) au rythme qu'on attendrait à ce stade du mois (jours écoulés ÷ jours du mois) :
- **En retard** (rouge) — au moins un objectif fixé est en dessous de ce rythme ;
- **À jour** (teal) — tous les objectifs fixés suivent (ou dépassent) le rythme attendu ;
- **Aucun objectif** (gris) — aucun objectif n'est fixé pour ce collaborateur (rien à évaluer) ;
- pour un mois archivé (déjà clos), le badge n'affiche pas de statut de rythme.

Un compteur en tête de carte ("X en retard · Y à jour · Z sans objectif") donne l'état de toute l'équipe en un coup d'œil, sans avoir à ouvrir chaque profil. Par défaut, le premier collaborateur en retard est présélectionné (à défaut, le premier de la liste) — le plus souvent la personne qu'un responsable veut regarder en premier. La liste (et le menu déroulant) trient toujours les retardataires en premier.

## Ergonomie responsable

Plusieurs raccourcis réduisent le nombre de clics/onglets pour les tâches qu'un responsable fait le plus souvent :

- **Écran d'accueil adapté** — un responsable atterrit directement sur "Suivi & objectifs" à la connexion (au lieu de "Ma saisie", pensé pour un collaborateur).
- **Badges de notification** sur les onglets — un nombre sur "Suivi & objectifs" indique le nombre de collaborateurs en retard, un nombre sur "Équipe" indique les invitations en attente, visibles sans avoir à cliquer.
- **Bandeau "coup d'œil"** — un résumé compact (assurances/crédits/montant réalisés vs objectif global, nombre de retardataires) reste visible sous l'en-tête quel que soit l'onglet actif.
- **Actions rapides sur la carte collaborateur** (vue d'ensemble) — réinitialiser le mot de passe ou ouvrir le Journal de la personne sélectionnée sans changer d'onglet. Pour un collaborateur en retard, un bouton **"Relancer"** copie dans le presse-papier un message pré-rempli résumant ce qu'il reste à réaliser (jamais envoyé automatiquement — c'est au responsable de le coller où il veut : e-mail, WhatsApp, SMS…).
- La navigation vers "Journal" ou "Suivi & objectifs" déclenche systématiquement un rafraîchissement silencieux des données, pour ne pas dépendre uniquement du cycle automatique de 30 secondes en arrivant sur ces onglets.

## Classement

L'onglet **Classement** (visible par tous, responsable comme collaborateurs) liste les collaborateurs du mois en cours, triés par **crédits financés** (le chiffre officiel validé par le responsable) — il se met donc à jour dès qu'un responsable enregistre une saisie de crédits du jour. Les 3 premiers ont un badge de rang coloré (or/argent/bronze) ; seuls le nombre d'**assurances** et le **montant des crédits financés** sont affichés à côté du classement.

## Journal des ventes

L'onglet **Journal** offre une vue structurée des ventes, jour par jour (au lieu d'une simple liste plate) : chaque jour est une section avec un dossier de détail, et le détail des dossiers déclarés ce jour-là. Un collaborateur y voit son propre journal ; le responsable y voit celui de toute l'équipe, avec le nom du vendeur sur chaque ligne, et peut supprimer n'importe quel dossier (pas seulement les siens). Navigation par mois comme dans "Suivi & objectifs". Dans **Ma saisie**, la carte "Mes ventes du jour" ne montre plus que les ventes du jour même (avec un lien direct vers le Journal complet) — pratique juste après avoir déclaré une vente, sans être noyé dans tout l'historique du mois.

Le récapitulatif de chaque jour reprend la présentation du tableau papier utilisé par l'équipe : une grille de puces responsive avec une puce par produit (ALLIN, DIMC, DIM pour les assurances ; PAT, OCA, BPR, MP7, AUG, DIM pour les crédits — PAT et BPR scindés en Papier/eDirect), plutôt qu'un simple total. Zone teal = assurances (nombre), zone ambre = crédits (montant) ; les puces sans activité s'effacent visuellement (fond neutre, tiret) pour que l'œil aille directement à ce qui bouge. Pour les crédits, le nombre de dossiers en instance pour ce type est indiqué entre parenthèses juste devant le nom du produit (ex. « (1) PAT »). La grille s'adapte à toutes les largeurs d'écran, sans défilement horizontal.

Ce même récapitulatif du jour (composant `RecapGrid`, section Assurances optionnelle via une prop `showAssurance`) apparaît aussi :
- dans **Ma saisie**, sous "Mes ventes du jour" — Assurances et crédits (ces derniers renommés **« Vente en instance »**) ;
- dans **Suivi & objectifs**, sur la carte d'un collaborateur pour son propre profil (Assurances + Crédits financés) — absent en revanche de la vue responsable, qui reste centrée sur les chiffres-clés et le graphique de performance (voir plus bas).

## Crédits financés — saisie quotidienne du responsable

Contrairement aux assurances (déclarées par les collaborateurs et comptabilisées automatiquement), les crédits financés sont validés par le **responsable**, au jour le jour, depuis le panneau "Mettre à jour" de chaque collaborateur dans **Suivi & objectifs**. Pour une date donnée (aujourd'hui par défaut, modifiable), le responsable saisit, pour chaque type de crédit (PAT/OCA/BPR/MP7/AUG/DIM), le **nombre** de dossiers financés et le **montant** total financé. Changer la date recharge la saisie déjà enregistrée ce jour-là (pour la corriger) ou un formulaire vide (pour un nouveau jour) ; le panneau reste ouvert après l'enregistrement pour saisir plusieurs jours à la suite.

Le total "Crédits (total)" et le détail par type qu'on voit ailleurs dans l'app (export Excel compris) sont la somme de toutes ces saisies quotidiennes du mois consulté — plus, le cas échéant, un chiffre "historique" antérieur à cette fonctionnalité (jamais perdu, jamais réécrit, simplement additionné une fois pour toutes).

Pour **PAT** et **BPR**, la saisie du jour se scinde en **Papier** et **eDirect** (comme le type de contrat déjà distingué côté collaborateur dans "Ma saisie") : deux paires nombre/montant distinctes, stockées comme deux enregistrements séparés mais additionnées ensemble dans le total du type.

## Comptes

- **Collaborateur** : la création d'un compte se fait uniquement par **invitation** — voir ci-dessous. À l'activation, le collaborateur choisit son propre **mot de passe** (6 caractères minimum) ; il se reconnecte ensuite par e-mail + mot de passe. Ceci empêche qu'un collaborateur se connecte sous l'identité d'un autre en tapant simplement son nom et son e-mail — voir "Mot de passe collaborateur" ci-dessous.
- **Responsable** : nécessite le code d'accès, défini par `MANAGER_CODE` dans `wrangler.toml` (à personnaliser avant mise en production). Contrairement à `APP_SECRET`, ce code est vérifié côté Worker (`POST /api/verify-manager-code`) et n'est **jamais envoyé au navigateur** — sa valeur reste un vrai secret, invisible dans le bundle JS public.

## Mot de passe collaborateur

Chaque collaborateur protège son profil par un mot de passe personnel (6 caractères minimum), choisi au moment de l'activation de son invitation. La connexion se fait ensuite par **e-mail + mot de passe** (`POST /api/login-member`) : le hash du mot de passe (PBKDF2-SHA256 salé, 100 000 itérations) est stocké côté Worker dans une clé KV dédiée (`memberSecrets`), **jamais transmis au navigateur** et explicitement inaccessible via la route générique `/api/storage/:key` (403 sur cette clé précise). Un mot de passe erroné, ou un e-mail sans compte associé, affiche un message d'erreur explicite sans jamais révéler lequel des deux est en cause.

**En cas d'oubli** : le responsable réinitialise le mot de passe d'un collaborateur depuis l'onglet **Équipe** (icône clé à côté de son nom), après avoir saisi le code d'accès responsable. Cette réinitialisation **supprime** simplement le mot de passe existant côté serveur — elle ne touche à aucune autre donnée du collaborateur (ventes déclarées, objectifs, crédits financés, historique). À sa prochaine tentative de connexion, l'application détecte l'absence de mot de passe et invite directement le collaborateur à en créer un nouveau, sans intervention supplémentaire du responsable.

⚠️ Comme pour `APP_SECRET` (voir "Sécurité" ci-dessous), cette protection reste proportionnée au modèle de confiance de l'application : `APP_SECRET` étant public dans le bundle JS, quelqu'un de déterminé pourrait théoriquement appeler `/api/set-password` directement s'il connaît à la fois l'`id` interne d'un compte et une fenêtre où ce compte n'a *pas encore* de mot de passe (juste après une invitation ou une réinitialisation, avant que la personne concernée ne s'en crée un). Ce n'est pas une authentification à l'épreuve d'un attaquant motivé, mais ça ferme la faille pratique visée : un collègue qui se connecte au profil d'un autre en tapant simplement son nom et son e-mail.

## Invitation des collaborateurs

Depuis l'onglet **Équipe**, le responsable génère un lien d'invitation unique pour chaque nouveau collaborateur (nom + e-mail), puis l'envoie lui-même par le canal de son choix (e-mail, WhatsApp, SMS…) — **aucun service tiers d'envoi d'e-mail n'est utilisé**. Le lien (`https://.../?invite=<jeton>`) contient un jeton aléatoire de 24 octets généré via `crypto.getRandomValues`. La personne qui le reçoit clique dessus, vérifie que le nom/e-mail affichés sont bien les siens, puis clique sur "Activer mon compte" pour créer son profil et se connecter directement.

Un lien d'invitation ne peut être utilisé qu'une seule fois (il est marqué `used` après activation) et peut être révoqué à tout moment tant qu'il n'a pas été utilisé. L'auto-inscription libre (n'importe qui créant un compte avec un nom + e-mail arbitraires) a été supprimée : sans invitation valide, un e-mail inconnu ne peut plus se connecter côté collaborateur.
