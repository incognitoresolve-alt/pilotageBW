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
// Nombre d'itérations utilisé pour tout NOUVEAU hash (création de mot de
// passe ou changement). Les hash existants restent vérifiables avec le
// nombre d'itérations enregistré à l'époque (voir `secret.iterations` ci-
// dessous) : on ne casse jamais un mot de passe déjà en place en relevant
// cette valeur, chaque mot de passe est simplement "mis à niveau" la
// prochaine fois qu'il est défini/changé.
const PBKDF2_ITERATIONS_CURRENT = 300000;
// Valeur utilisée avant l'introduction de `secret.iterations` — sert de
// repli pour les hash existants qui n'ont pas ce champ.
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
        if (secrets[memberId]) {
          const { ok, limited } = await checkManagerCode(env, request, body.managerCode);
          if (limited) return tooManyAttempts();
          if (!ok) return jsonResponse({ error: "manager_code_required" }, 403);
        } else {
          // Pas encore de mot de passe pour ce compte (invitation tout
          // juste activée, ou réinitialisation en attente) : quiconque
          // connaît le memberId peut le revendiquer sans code responsable
          // — c'est le fonctionnement voulu, mais on limite quand même le
          // rythme des tentatives pour ne pas laisser un script "courir"
          // après les comptes fraîchement réinitialisés.
          const claimBucket = `claim:${memberId}`;
          if (await isRateLimited(env, claimBucket, 5)) return tooManyAttempts();
          await recordFailedAttempt(env, claimBucket);
        }
        const salt = randomSaltHex();
        const hash = await hashPassword(password, salt);
        secrets[memberId] = { salt, hash, iterations: PBKDF2_ITERATIONS_CURRENT, updatedAt: new Date().toISOString() };
        await saveSecrets(env, secrets);
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

    return env.ASSETS.fetch(request);
  },
};
