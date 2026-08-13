// Worker Cloudflare : sert le build statique (dist/, via le binding ASSETS)
// et expose une API partagée sur Cloudflare KV. Même contrat d'API que le
// shim client (GET/PUT /api/storage/:key) — voir src/lib/storage.js.
//
// Toute requête vers /api/* (sauf /api/unlock lui-même) doit présenter le
// header X-Session-Token avec un jeton signé obtenu via POST /api/unlock
// (code d'accès, voir SITE_ACCESS_CODE plus bas). Contrairement à l'ancien
// mécanisme (X-App-Secret comparé à une valeur AUSSI présente dans le
// bundle JS public, donc pas vraiment secrète), le code d'accès n'est
// JAMAIS envoyé au navigateur : seul un jeton opaque et limité dans le
// temps l'est, après vérification côté Worker — voir issueSessionToken /
// verifySessionToken. Ce n'est toujours pas une authentification par
// utilisateur (le jeton est partagé par toute l'équipe, comme le code),
// mais le secret lui-même reste invisible même en inspectant le bundle.

// SITE_ACCESS_CODE / MANAGER_CODE / SESSION_SECRET peuvent être liés soit
// comme une simple variable/secret classique (chaîne directement), soit
// comme un binding "Secrets Store" Cloudflare (objet exposant une méthode
// .get() async) — on gère les deux formes. Les trois doivent être définis
// via `wrangler secret put <NOM>` (jamais dans wrangler.toml : un secret
// mis dans [vars] finit committé en clair dans le dépôt Git).
async function resolveSecret(binding) {
  if (typeof binding === "string") return binding;
  if (binding && typeof binding.get === "function") return await binding.get();
  return "";
}

// --- Limitation des tentatives (anti brute-force) --------------------------
// Compteur simple en KV, par "seau" (email, IP...), qui expire tout seul —
// pas de purge à gérer. Ce n'est pas un rate-limiter distribué précis (KV
// est en cohérence éventuelle), mais ça suffit à décourager un script qui
// tente des centaines de mots de passe/codes d'affilée, ce qu'aucun endpoint
// d'authentification ne freinait jusqu'ici.
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

async function isRateLimited(env, bucket, maxAttempts) {
  const raw = await env.STORAGE_KV.get(`rateLimit:${bucket}`);
  const state = raw ? JSON.parse(raw) : { count: 0 };
  return state.count >= maxAttempts;
}
async function recordFailedAttempt(env, bucket) {
  const key = `rateLimit:${bucket}`;
  const raw = await env.STORAGE_KV.get(key);
  const state = raw ? JSON.parse(raw) : { count: 0 };
  state.count += 1;
  await env.STORAGE_KV.put(key, JSON.stringify(state), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
}
async function clearRateLimit(env, bucket) {
  await env.STORAGE_KV.delete(`rateLimit:${bucket}`);
}
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
function tooManyAttempts() {
  return jsonResponse({ error: "too_many_attempts" }, 429);
}

// Vérification centralisée du code responsable : comparaison à temps
// constant (comme pour les mots de passe) et limitée en tentatives par IP,
// utilisée par les 3 endpoints qui en dépendent (vérification directe,
// remplacement de mot de passe, réinitialisation) pour ne pas dupliquer —
// et risquer d'oublier — cette protection à un seul des trois endroits.
async function checkManagerCode(env, request, providedCode) {
  const ip = clientIp(request);
  const bucket = `managerCode:${ip}`;
  if (await isRateLimited(env, bucket, 10)) return { ok: false, limited: true };
  const managerCode = (await resolveSecret(env.MANAGER_CODE)) || "";
  const valid = !!managerCode && timingSafeEqual(String(providedCode || ""), managerCode);
  if (!valid) await recordFailedAttempt(env, bucket);
  else await clearRateLimit(env, bucket);
  return { ok: valid, limited: false };
}

// --- Verrou d'accès au site (code partagé, jeton de session signé) -------
// Le code (SITE_ACCESS_CODE) n'est vérifié que côté Worker, jamais envoyé
// au client. En échange d'un code correct, /api/unlock délivre un jeton
// opaque "<expiration>.<signature HMAC>" — c'est ce jeton, pas le code,
// que le navigateur envoie ensuite sur chaque appel /api/* (X-Session-Token).
// Un jeton révèle seulement une date d'expiration ; sans SESSION_SECRET
// (jamais transmis), impossible d'en forger un valide. Faire tourner
// SESSION_SECRET invalide instantanément tous les jetons déjà distribués.
const SESSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(sig));
}

async function issueSessionToken(env) {
  const secret = (await resolveSecret(env.SESSION_SECRET)) || "";
  const expiresAt = Date.now() + SESSION_TOKEN_TTL_MS;
  const sig = await hmacHex(secret, String(expiresAt));
  return { token: `${expiresAt}.${sig}`, expiresAt };
}

async function verifySessionToken(env, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [expStr, sig] = token.split(".");
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const secret = (await resolveSecret(env.SESSION_SECRET)) || "";
  if (!secret) return false;
  const expected = await hmacHex(secret, expStr);
  return sig.length === expected.length && timingSafeEqual(sig, expected);
}

// --- Mots de passe collaborateurs -----------------------------------------
// Stockés séparément de "members" (clé KV réservée "memberSecrets", jamais
// accessible via la route générique /api/storage/:key — voir plus bas) sous
// forme de hash PBKDF2-SHA256 salé, jamais en clair. Le contrat :
//   - aucun secret enregistré pour un memberId  → n'importe qui peut en
//     définir un (POST /api/set-password sans managerCode) : c'est le cas
//     juste après l'activation d'une invitation (le compte vient d'être
//     créé, personne d'autre ne le connaît encore) et juste après une
//     réinitialisation par le responsable (le secret a été supprimé).
//   - un secret existe déjà → le remplacer exige managerCode (réinitialisation
//     par le responsable) ; POST /api/reset-password supprime simplement le
//     secret existant, sans jamais toucher aux données du membre (ventes,
//     objectifs, crédits financés) : rien n'est perdu.
// ⚠️ Le runtime Cloudflare Workers plafonne PBKDF2 à 100 000 itérations
// (crypto.subtle.deriveBits refuse tout nombre supérieur — confirmé en
// production : "Pbkdf2 failed: iteration counts above 100000 are not
// supported"). L'émulation locale (wrangler dev / Miniflare) n'applique
// PAS cette limite, donc une valeur trop haute passe les tests locaux mais
// casse en production — ne jamais dépasser 100 000 ici sans revérifier
// contre le déploiement réel, pas seulement `wrangler dev`.
const PBKDF2_ITERATIONS_CURRENT = 100000;
// Valeur utilisée avant l'introduction de `secret.iterations` — sert de
// repli pour les hash existants qui n'ont pas ce champ. Identique à
// PBKDF2_ITERATIONS_CURRENT pour l'instant (voir avertissement ci-dessus),
// gardée séparée pour permettre une vraie hausse si Cloudflare relève un
// jour cette limite.
const PBKDF2_ITERATIONS_LEGACY = 100000;

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS_CURRENT) {
  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}
function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
// Comparaison à temps constant (évite qu'un attaquant déduise le hash
// correct en mesurant le temps de réponse caractère par caractère).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function loadSecrets(env) {
  const raw = await env.STORAGE_KV.get("memberSecrets");
  return raw ? JSON.parse(raw) : {};
}
async function saveSecrets(env, secrets) {
  await env.STORAGE_KV.put("memberSecrets", JSON.stringify(secrets));
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // Filet de sécurité : toute exception non prévue (échec KV, erreur
      // crypto, etc.) renvoie un diagnostic JSON exploitable au lieu de la
      // page d'erreur générique de Cloudflare — sans ça, le client ne
      // reçoit pas de JSON valide et l'erreur affichée à l'écran perd
      // toute information utile (voir describeFailure / apiPost côté
      // client, qui remontent `error`/`detail` dans le message affiché).
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return jsonResponse({ error: "server_error", detail: String(e?.message || e) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  // Seule route accessible sans jeton de session : c'est elle qui en
  // délivre un, en échange du code d'accès (jamais renvoyé au client,
  // quel que soit le résultat — voir verifySessionToken).
  if (url.pathname === "/api/unlock" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const bucket = `unlock:${clientIp(request)}`;
    if (await isRateLimited(env, bucket, 10)) return tooManyAttempts();
    const siteCode = (await resolveSecret(env.SITE_ACCESS_CODE)) || "";
    const provided = String(body.code || "");
    const valid = !!siteCode && timingSafeEqual(provided, siteCode);
    if (!valid) {
      await recordFailedAttempt(env, bucket);
      return jsonResponse({ error: "invalid_code" }, 401);
    }
    await clearRateLimit(env, bucket);
    const { token, expiresAt } = await issueSessionToken(env);
    return jsonResponse({ token, expiresAt });
  }

  {
      const sessionToken = request.headers.get("X-Session-Token") || "";
      if (!(await verifySessionToken(env, sessionToken))) {
        return jsonResponse({ error: "session_required" }, 401);
      }

      const storageMatch = url.pathname.match(/^\/api\/storage\/([^/]+)$/);
      if (storageMatch) {
        const key = decodeURIComponent(storageMatch[1]);

        // Clé réservée : les hash de mots de passe ne transitent jamais par
        // la route générique, seulement par les routes dédiées ci-dessous
        // (qui ne renvoient jamais le hash lui-même au client).
        if (key === "memberSecrets") {
          return new Response("Forbidden", { status: 403 });
        }

        if (request.method === "GET") {
          const { value, metadata } = await env.STORAGE_KV.getWithMetadata(key);
          if (value === null) return new Response(null, { status: 404 });
          return new Response(JSON.stringify({ value, version: metadata?.version || 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (request.method === "PUT") {
          const body = await request.json();
          // Concurrence optimiste : si l'appelant précise la version qu'il
          // pensait modifier (`expectedVersion`), on refuse l'écriture si
          // la valeur a changé côté serveur entre-temps plutôt que
          // d'écraser silencieusement le travail de quelqu'un d'autre —
          // l'appelant reçoit la valeur/version actuelles pour se
          // rafraîchir et rejouer sa modification. Un appelant qui ne
          // précise pas `expectedVersion` (ancien client, ou écriture
          // volontairement inconditionnelle) garde l'ancien comportement.
          if (typeof body.expectedVersion === "number") {
            const current = await env.STORAGE_KV.getWithMetadata(key);
            const currentVersion = current.value === null ? 0 : current.metadata?.version || 0;
            if (currentVersion !== body.expectedVersion) {
              return jsonResponse({ error: "conflict", value: current.value, version: currentVersion }, 409);
            }
            const nextVersion = currentVersion + 1;
            await env.STORAGE_KV.put(key, body.value, { metadata: { version: nextVersion } });
            return jsonResponse({ version: nextVersion }, 200);
          }
          await env.STORAGE_KV.put(key, body.value, { metadata: { version: Date.now() } });
          return new Response(null, { status: 204 });
        }

        return new Response("Method not allowed", { status: 405 });
      }

      // Vérifie le code d'accès responsable côté serveur : sa vraie
      // valeur n'est ainsi jamais présente dans le bundle JS envoyé au
      // navigateur, contrairement à une comparaison faite côté client.
      if (url.pathname === "/api/verify-manager-code" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { ok, limited } = await checkManagerCode(env, request, body.code);
        if (limited) return tooManyAttempts();
        return new Response(JSON.stringify({ valid: ok }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Définit (ou remplace) le mot de passe d'un collaborateur. Autorisé
      // sans code responsable uniquement si ce compte n'a *aucun* mot de
      // passe enregistré (juste après activation d'une invitation, ou juste
      // après une réinitialisation par le responsable) ; sinon il faut
      // prouver l'identité "responsable" via managerCode.
      if (url.pathname === "/api/set-password" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const memberId = String(body.memberId || "");
        const password = String(body.password || "");
        if (!memberId || password.length < 6) {
          return jsonResponse({ error: "invalid_input" }, 400);
        }
        const secrets = await loadSecrets(env);
        const isClaim = !secrets[memberId];
        const claimBucket = `claim:${memberId}`;
        if (!isClaim) {
          const { ok, limited } = await checkManagerCode(env, request, body.managerCode);
          if (limited) return tooManyAttempts();
          if (!ok) return jsonResponse({ error: "manager_code_required" }, 403);
        } else {
          // Pas encore de mot de passe pour ce compte (invitation tout
          // juste activée, ou réinitialisation en attente) : quiconque
          // connaît le memberId peut le revendiquer sans code responsable
          // — c'est le fonctionnement voulu, mais on limite quand même le
          // rythme des tentatives pour ne pas laisser un script "courir"
          // après les comptes fraîchement réinitialisés. Le compteur est
          // remis à zéro dès qu'une revendication réussit (voir plus bas) :
          // un cycle légitime réinitialisation-par-le-responsable → nouvelle
          // revendication ne s'accumule donc jamais d'une fois sur l'autre —
          // seuls des essais rapprochés ET infructueux sur la MÊME fenêtre
          // peuvent épuiser la limite.
          if (await isRateLimited(env, claimBucket, 5)) return tooManyAttempts();
          await recordFailedAttempt(env, claimBucket);
        }
        const salt = randomSaltHex();
        const hash = await hashPassword(password, salt);
        secrets[memberId] = { salt, hash, iterations: PBKDF2_ITERATIONS_CURRENT, updatedAt: new Date().toISOString() };
        await saveSecrets(env, secrets);
        if (isClaim) await clearRateLimit(env, claimBucket);
        return new Response(null, { status: 204 });
      }

      // Réinitialisation par le responsable : supprime le mot de passe
      // existant (managerCode obligatoire) sans jamais toucher aux données
      // du membre (ventes, objectifs, crédits financés) — le collaborateur
      // pourra ensuite s'en définir un nouveau à sa prochaine connexion.
      if (url.pathname === "/api/reset-password" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { ok, limited } = await checkManagerCode(env, request, body.managerCode);
        if (limited) return tooManyAttempts();
        if (!ok) return jsonResponse({ error: "manager_code_required" }, 403);
        const memberId = String(body.memberId || "");
        if (!memberId) return jsonResponse({ error: "invalid_input" }, 400);
        const secrets = await loadSecrets(env);
        delete secrets[memberId];
        await saveSecrets(env, secrets);
        return new Response(null, { status: 204 });
      }

      // Connexion par e-mail + mot de passe. Ne renvoie jamais le hash au
      // client — seulement le membre (si les identifiants sont valides) ou
      // un statut indiquant qu'aucun mot de passe n'est encore défini
      // (compte tout juste réinitialisé par le responsable, à réclamer).
      if (url.pathname === "/api/login-member" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!email) return jsonResponse({ error: "invalid_input" }, 400);
        const loginBucket = `login:${email}`;
        if (await isRateLimited(env, loginBucket, 10)) return tooManyAttempts();
        const membersRaw = await env.STORAGE_KV.get("members");
        const members = membersRaw ? JSON.parse(membersRaw) : [];
        const member = members.find((m) => (m.email || "").toLowerCase() === email);
        if (!member) return jsonResponse({ error: "not_found" }, 404);
        const secrets = await loadSecrets(env);
        const secret = secrets[member.id];
        if (!secret) return jsonResponse({ needsPassword: true, member });
        const candidateHash = await hashPassword(password, secret.salt, secret.iterations || PBKDF2_ITERATIONS_LEGACY);
        if (!timingSafeEqual(candidateHash, secret.hash)) {
          await recordFailedAttempt(env, loginBucket);
          return jsonResponse({ error: "invalid_password" }, 401);
        }
        await clearRateLimit(env, loginBucket);
        return jsonResponse({ ok: true, member });
      }

      return new Response("Not found", { status: 404 });
  }
}
