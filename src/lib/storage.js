// Shim for the `window.storage` key/value API the app was originally
// prototyped against. "Shared" data (members, entries, figures) is read
// from and written to the backend in worker/, so it's the same for
// every user. "Local" data (the last-used session, for auto-login on
// this device) stays in the browser's localStorage — it's a per-device
// convenience, not something that should sync.
const PREFIX = "suivi-commercial";
const API_BASE = "/api/storage";
const SITE_TOKEN_KEY = `${PREFIX}:local:site-token`;

function localKey(key) {
  return `${PREFIX}:local:${key}`;
}

// --- Verrou d'accès au site ------------------------------------------------
// Le code d'accès (SITE_ACCESS_CODE côté Worker) n'est jamais envoyé au
// navigateur : unlockSite() l'échange contre un jeton de session opaque,
// signé côté serveur — voir worker/index.js > /api/unlock. C'est ce jeton
// (pas le code) qui est stocké ici et joint à chaque appel API ensuite.
function readStoredToken() {
  try {
    const raw = window.localStorage.getItem(SITE_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt) return null;
    // Vérification locale indicative uniquement (évite d'envoyer un jeton
    // qu'on sait déjà expiré) — le Worker reste seul juge de la validité
    // réelle (signature HMAC), voir verifySessionToken.
    if (parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
function storeToken(token, expiresAt) {
  window.localStorage.setItem(SITE_TOKEN_KEY, JSON.stringify({ token, expiresAt }));
}
export function hasSiteToken() {
  return !!readStoredToken();
}
export function clearSiteToken() {
  window.localStorage.removeItem(SITE_TOKEN_KEY);
}

// Échange le code d'accès contre un jeton de session, stocké localement
// (par appareil, comme "last-session"). Retourne { ok:true } ou
// { ok:false, error } ("invalid_code" | "too_many_attempts" | "network: ...").
export async function unlockSite(code) {
  try {
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
    storeToken(body.token, body.expiresAt);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `network: ${e.message}` };
  }
}

function sessionHeaders(extra) {
  const stored = readStoredToken();
  return { ...extra, "X-Session-Token": stored?.token || "" };
}

// true si une erreur vient d'un jeton de session absent/expiré/invalide
// (code "session_required" renvoyé par le Worker sur toute route /api/*
// autre que /api/unlock — voir verifySessionToken) : sert à App.jsx pour
// effacer le jeton local et réafficher l'écran de verrouillage au lieu
// d'un message d'erreur réseau générique.
export function isSessionError(e) {
  return !!e && typeof e.message === "string" && e.message.includes("session_required");
}

async function describeFailure(res) {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
  } catch {
    // pas de corps JSON exploitable, on retombe sur le statut brut
  }
  return String(res.status);
}

async function get(key, shared) {
  if (shared) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
      headers: sessionHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${key} failed: ${await describeFailure(res)}`);
    return res.json();
  }
  const raw = window.localStorage.getItem(localKey(key));
  return raw === null ? null : { value: raw };
}

// `expectedVersion`, si fourni, active la concurrence optimiste côté
// Worker : la requête échoue avec un conflit (plutôt que d'écraser une
// écriture faite ailleurs entre-temps) si la version a changé depuis la
// dernière lecture — voir worker/index.js et App.jsx > persistCollection.
async function set(key, value, shared, expectedVersion) {
  if (shared) {
    const payload = typeof expectedVersion === "number" ? { value, expectedVersion } : { value };
    const res = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: sessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(`PUT ${key} failed: conflict`);
      err.conflict = true;
      err.serverValue = body.value;
      err.serverVersion = body.version;
      throw err;
    }
    if (!res.ok) throw new Error(`PUT ${key} failed: ${await describeFailure(res)}`);
    const body = await res.json().catch(() => ({}));
    return body.version;
  }
  window.localStorage.setItem(localKey(key), value);
}

if (typeof window !== "undefined" && !window.storage) {
  window.storage = { get, set };
}

// Vérifie le code d'accès responsable côté serveur (Worker) : sa vraie
// valeur n'est jamais envoyée au navigateur, contrairement à une
// comparaison faite directement dans le code client (voir worker/index.js).
export async function verifyManagerCode(code) {
  try {
    const res = await fetch("/api/verify-manager-code", {
      method: "POST",
      headers: sessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ code }),
    });
    if (res.status === 429) return { valid: false, limited: true };
    if (!res.ok) return { valid: false, limited: false };
    const body = await res.json();
    return { valid: !!body.valid, limited: false };
  } catch {
    return { valid: false, limited: false };
  }
}

function apiPost(path, payload) {
  return fetch(path, {
    method: "POST",
    headers: sessionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

// Construit un message d'erreur précis à partir d'une réponse en échec :
// code d'erreur renvoyé par le Worker (`body.error`), complété par le
// détail diagnostique du filet de sécurité (`body.detail`, voir
// worker/index.js > handleApi) quand il est présent — pour voir
// exactement où le problème se situe au lieu d'un message générique.
async function describeApiFailure(res) {
  const body = await res.json().catch(() => ({}));
  const reason = body.error || `HTTP ${res.status}`;
  return body.detail ? `${reason} — ${body.detail}` : reason;
}

// Connexion collaborateur par e-mail + mot de passe. Le hash n'est jamais
// transmis au navigateur — voir worker/index.js > /api/login-member.
// Retourne { ok, member } si les identifiants sont valides, { needsPassword,
// member } si aucun mot de passe n'est encore défini pour ce compte (juste
// après activation ou après une réinitialisation par le responsable), ou
// { error } sinon ("not_found" | "invalid_password" | "too_many_attempts" |
// tout code renvoyé par le Worker, y compris via le filet de sécurité).
export async function loginMember(email, password) {
  try {
    const res = await apiPost("/api/login-member", { email, password });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !body.error) return { error: `HTTP ${res.status}` };
    return body;
  } catch (e) {
    return { error: `network: ${e.message}` };
  }
}

// Définit (première fois) ou remplace (avec managerCode) le mot de passe
// d'un collaborateur. Lève une erreur si le serveur refuse.
export async function setMemberPassword(memberId, password, managerCode) {
  const res = await apiPost("/api/set-password", { memberId, password, managerCode });
  if (!res.ok) throw new Error(await describeApiFailure(res));
}

// Réinitialisation par le responsable : supprime le mot de passe existant
// (le collaborateur pourra s'en redéfinir un à sa prochaine connexion) sans
// toucher à ses données.
export async function resetMemberPassword(memberId, managerCode) {
  const res = await apiPost("/api/reset-password", { memberId, managerCode });
  if (!res.ok) throw new Error(await describeApiFailure(res));
}

// --- Sauvegardes automatiques ----------------------------------------------
// Chaque écriture sur une collection partagée (members, entries,
// creditRecords...) en conserve une copie horodatée côté Worker, conservée
// 60 jours — voir worker/index.js > writeBackup. Ces deux fonctions
// permettent de lister les sauvegardes disponibles pour une collection et
// d'en récupérer une précise, pour un rétablissement manuel (voir App.jsx
// > panneau "Sauvegardes").

// Renvoie la liste des horodatages (ms epoch) des sauvegardes disponibles
// pour cette collection, du plus récent au plus ancien.
export async function listBackups(key) {
  const res = await fetch(`/api/backups/${encodeURIComponent(key)}`, {
    headers: sessionHeaders(),
  });
  if (!res.ok) throw new Error(`GET backups ${key} failed: ${await describeFailure(res)}`);
  const body = await res.json();
  return body.timestamps || [];
}

// Récupère le contenu (déjà parsé) d'une sauvegarde précise.
export async function getBackup(key, timestamp) {
  const res = await fetch(`/api/backups/${encodeURIComponent(key)}/${timestamp}`, {
    headers: sessionHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET backup ${key}/${timestamp} failed: ${await describeFailure(res)}`);
  const body = await res.json();
  return JSON.parse(body.value);
}
