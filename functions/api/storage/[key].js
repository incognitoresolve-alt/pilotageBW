// Cloudflare Pages Function : stockage clé/valeur partagé (membres, ventes,
// chiffres) dans Cloudflare KV. Remplace le backend Express local — même
// contrat d'API (GET/PUT /api/storage/:key), donc aucun changement côté
// frontend (src/lib/storage.js).

export async function onRequestGet({ params, env }) {
  const value = await env.STORAGE_KV.get(params.key);
  if (value === null) {
    return new Response(null, { status: 404 });
  }
  return new Response(JSON.stringify({ value }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPut({ params, env, request }) {
  const body = await request.json();
  await env.STORAGE_KV.put(params.key, body.value);
  return new Response(null, { status: 204 });
}
