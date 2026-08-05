# Suivi Commercial

Application de suivi commercial (assurances & crédits) pour une équipe : saisie des dossiers, suivi des objectifs mensuels, gestion d'équipe, export Excel mensuel.

## Démarrage (développement)

Deux processus : le backend (API + stockage) et le frontend (Vite).

```bash
npm install

# terminal 1 — backend, sur le port 4000
npm run server

# terminal 2 — frontend, sur le port 5173 (proxy /api vers le backend)
npm run dev
```

L'application est disponible sur http://localhost:5173.

## Build & lancement en production

Un seul process Node sert à la fois l'API et les fichiers statiques buildés :

```bash
npm run build
npm run server
# ou : npm start (build + server en une commande)
```

L'application est alors disponible sur http://localhost:4000 (port configurable via la variable d'environnement `PORT`).

## Stack

- React + Vite
- Tailwind CSS
- lucide-react (icônes)
- Express (backend minimal)
- xlsx / SheetJS (export Excel)

## Backend

Le backend (`server/index.js`) est volontairement minimal : un serveur Express qui expose une API clé/valeur (`GET/PUT /api/storage/:key`) et persiste les données dans un fichier JSON (`server/data.json`, créé automatiquement, jamais commité). C'est là que sont stockés les membres, les ventes déclarées et les chiffres officiels du mois — partagés par tous les utilisateurs, quel que soit leur navigateur ou appareil.

Le "dernier compte connecté" (pour l'auto-login) reste dans le `localStorage` du navigateur : c'est une préférence locale à l'appareil, elle n'a pas besoin d'être partagée.

**Limites** : stockage fichier (pas de vraie base de données, pas de gestion de concurrence avancée), pas d'authentification par mot de passe (le code responsable protège seulement la mise à jour des chiffres officiels), pas de sauvegardes automatiques. Suffisant pour une petite équipe ; pour aller plus loin, remplacer `server/index.js` par une vraie base (Postgres/SQLite) ou un service managé (Supabase, Firebase...).

**Déploiement** : `server/data.json` doit être sur un disque persistant (pas un environnement éphémère/serverless qui réinitialise le système de fichiers à chaque déploiement), sans quoi les données seraient perdues.

## Export Excel

Dans l'onglet **Suivi & objectifs**, le responsable dispose d'un bouton **Exporter en Excel** qui télécharge un fichier `.xlsx` (`suivi-commercial-AAAA-MM.xlsx`) avec, pour chaque collaborateur : assurances réalisées/objectif, détail des crédits par type (PAT/OCA/BPR/MP7), total crédits/objectif, et nombre de dossiers déclarés dans le journal. Pratique à générer en fin de mois pour archiver les chiffres officiels de toute l'équipe.

## Comptes

- **Collaborateur** : nom + e-mail suffisent pour créer un compte.
- **Responsable** : nécessite le code d'accès (`OVB2026`, modifiable dans `src/App.jsx`).
