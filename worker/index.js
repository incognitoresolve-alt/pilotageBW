// Worker Cloudflare : sert le build statique (dist/, via le binding ASSETS)
// et expose une API partagée sur Cloudflare KV. Même contrat d'API que le
// shim client (GET/PUT /api/storage/:key) — voir src/lib/storage.js.
//
// Toute requête vers /api/* doit présenter le header X-App-Secret avec la
// valeur du secret APP_SECRET (défini dans wrangler.toml). Ce n'est pas une
// vraie authentification par utilisateur — la valeur finit dans le bundle JS
// public — mais ça ferme l'accès direct et non authentifié à l'API pour un
// visiteur ou un robot qui découvrirait l'URL sans passer par l'application.

// APP_SECRET / MANAGER_CODE peuvent être liés soit comme une simple
// variable/secret classique (chaîne directement), soit comme un binding
// "Secrets Store" Cloudflare (objet exposant une méthode .get() async) —
// on gère les deux formes.
async function resolveSecret(binding) {
  if (typeof binding === "string") return binding;
  if (binding && typeof binding.get === "function") return await binding.get();
  return "";
}

function unauthorized(serverSecret, clientSecret) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const clientSecret = request.headers.get("X-App-Secret") || "";
      const serverSecret = (await resolveSecret(env.APP_SECRET)) || "";
      if (clientSecret !== serverSecret) {
        return unauthorized(serverSecret, clientSecret);
      }

      const storageMatch = url.pathname.match(/^\/api\/storage\/([^/]+)$/);
      if (storageMatch) {
        const key = decodeURIComponent(storageMatch[1]);

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

      // Vérifie le code d'accès responsable côté serveur : sa vraie
      // valeur n'est ainsi jamais présente dans le bundle JS envoyé au
      // navigateur, contrairement à une comparaison faite côté client.
      if (url.pathname === "/api/verify-manager-code" && request.method === "POST") {
        const managerCode = (await resolveSecret(env.MANAGER_CODE)) || "";
        const body = await request.json().catch(() => ({}));
        const valid = !!managerCode && body.code === managerCode;
        return new Response(JSON.stringify({ valid }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
