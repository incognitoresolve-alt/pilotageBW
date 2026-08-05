// Shim for the `window.storage` key/value API the app was originally
// prototyped against. "Shared" data (members, entries, figures) is read
// from and written to the backend in worker/, so it's the same for
// every user. "Local" data (the last-used session, for auto-login on
// this device) stays in the browser's localStorage — it's a per-device
// convenience, not something that should sync.
const PREFIX = "suivi-commercial";
const API_BASE = "/api/storage";

// Doit correspondre au secret APP_SECRET configuré côté Worker
// (wrangler secret put APP_SECRET). Voir README > Sécurité.
const APP_SECRET = import.meta.env.VITE_APP_SECRET || "";

function localKey(key) {
  return `${PREFIX}:local:${key}`;
}

async function describeFailure(res) {
  try {
    const body = await res.json();
    if (body && typeof body.serverSecretLength === "number") {
      return `${res.status}: secret serveur=${body.serverSecretConfigured ? body.serverSecretLength + " car." : "absent"}, secret envoyé=${body.clientSecretLength} car.`;
    }
  } catch {
    // pas de corps JSON exploitable, on retombe sur le statut brut
  }
  return String(res.status);
}

async function get(key, shared) {
  if (shared) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
      headers: { "X-App-Secret": APP_SECRET },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${key} failed: ${await describeFailure(res)}`);
    return res.json();
  }
  const raw = window.localStorage.getItem(localKey(key));
  return raw === null ? null : { value: raw };
}

async function set(key, value, shared) {
  if (shared) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-App-Secret": APP_SECRET,
      },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`PUT ${key} failed: ${await describeFailure(res)}`);
    return;
  }
  window.localStorage.setItem(localKey(key), value);
}

if (typeof window !== "undefined" && !window.storage) {
  window.storage = { get, set };
}
