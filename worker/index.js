// Worker Cloudflare : sert le build statique (dist/, via le binding ASSETS)
// et expose l'API clé/valeur partagée (membres, ventes, chiffres) sur
// Cloudflare KV. Même contrat d'API que le shim client
// (GET/PUT /api/storage/:key) — voir src/lib/storage.js.
//
// Toute requête vers /api/storage/* doit présenter le header
// X-App-Secret avec la valeur du secret APP_SECRET (configuré côté
// Worker via `wrangler secret put APP_SECRET`). Ce n'est pas une vraie
// authentification par utilisateur — la valeur finit dans le bundle JS
// public — mais ça ferme l'accès direct et non authentifié à l'API
// pour un visiteur ou un robot qui découvrirait l'URL sans passer par
// l'application.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/storage\/([^/]+)$/);

    if (match) {
      const clientSecret = request.headers.get("X-App-Secret") || "";
      const serverSecret = env.APP_SECRET || "";
      if (clientSecret !== serverSecret) {
        // Diagnostic minimal (longueurs uniquement, jamais les valeurs) pour
        // distinguer "APP_SECRET absent côté Worker" de "VITE_APP_SECRET
        // absent/différent côté build" sans avoir à comparer des captures
        // d'écran de secrets à la main.
        return new Response(
          JSON.stringify({
            error: "unauthorized",
            serverSecretConfigured: serverSecret.length > 0,
            serverSecretLength: serverSecret.length,
            clientSecretLength: clientSecret.length,
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      const key = decodeURIComponent(match[1]);

      if (request.method === "GET") {
        const value = await env.STORAGE_KV.get(key);
        if (value === null) return new Response(null, { status: 404 });
        return new Response(JSON.stringify({ value }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (request.method === "PUT") {
        const body = await request.json();
        await env.STORAGE_KV.put(key, body.value);
        return new Response(null, { status: 204 });
      }

      return new Response("Method not allowed", { status: 405 });
    }

    return env.ASSETS.fetch(request);
  },
};
