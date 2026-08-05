// Worker Cloudflare : sert le build statique (dist/, via le binding ASSETS)
// et expose l'API clé/valeur partagée (membres, ventes, chiffres) sur
// Cloudflare KV. Même contrat d'API que le shim client
// (GET/PUT /api/storage/:key) — voir src/lib/storage.js.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/storage\/([^/]+)$/);

    if (match) {
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
