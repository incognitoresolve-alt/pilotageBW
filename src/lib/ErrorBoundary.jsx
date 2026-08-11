import React from "react";

// Filet de sécurité pour toute exception JS non attrapée dans l'arbre React
// (bug, donnée serveur inattendue...). Sans ça, l'app entière plante en
// écran blanc silencieux — ici on affiche au moins un message clair avec
// un bouton pour recharger, et on journalise l'erreur en console pour le
// diagnostic. Ne remplace pas une gestion d'erreur ciblée dans les
// composants (déjà en place ailleurs pour les échecs réseau) : c'est un
// dernier filet, pas la première ligne de défense.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Erreur non gérée dans l'application :", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{ background: "#F7F4EC", minHeight: "100vh" }}
        className="flex items-center justify-center px-4"
      >
        <div className="w-full max-w-md text-center space-y-4">
          <div
            style={{ color: "#8C2A3A" }}
            className="text-sm font-semibold uppercase tracking-wide"
          >
            Une erreur inattendue est survenue
          </div>
          <p style={{ color: "#0F1B33" }} className="text-sm">
            L'application a rencontré un problème et ne peut pas continuer normalement.
            Vos données enregistrées ne sont pas perdues — rechargez la page pour réessayer.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#0F1B33", color: "#fff" }}
            className="px-4 py-2 rounded-lg text-sm font-medium"
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
