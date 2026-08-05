# Suivi Commercial

Application de suivi commercial (assurances & crédits) pour une équipe : saisie des dossiers, suivi des objectifs mensuels, gestion d'équipe.

## Démarrage

```bash
npm install
npm run dev
```

L'application est disponible sur http://localhost:5173.

## Build de production

```bash
npm run build
npm run preview
```

## Stack

- React + Vite
- Tailwind CSS
- lucide-react (icônes)

## Persistance des données

Le prototype d'origine s'appuyait sur une API `window.storage` fournie par son environnement de conception. Ce projet inclut un shim (`src/lib/storage.js`) qui redirige cette API vers le `localStorage` du navigateur, afin que l'application fonctionne de manière autonome.

**Limite importante** : les données (membres, ventes, chiffres) sont stockées localement dans le navigateur de chaque utilisateur — elles ne sont pas synchronisées entre plusieurs appareils ou utilisateurs. Pour un partage réel entre collaborateurs et responsable, il faut brancher un backend (ex. Supabase, Firebase, une API maison) à la place de ce shim.

## Comptes

- **Collaborateur** : nom + e-mail suffisent pour créer un compte.
- **Responsable** : nécessite le code d'accès (`OVB2026`, modifiable dans `src/App.jsx`).
