// Shim for the `window.storage` key/value API the app was originally
// prototyped against. There is no backend here, so both the "shared"
// and "local" namespaces are persisted to the browser's localStorage —
// data stays on the device it was entered on, it is not synced between
// users. Swap this module for a real backend client to get true
// multi-device sharing.
const PREFIX = "suivi-commercial";

function fullKey(key, shared) {
  return `${PREFIX}:${shared ? "shared" : "local"}:${key}`;
}

async function get(key, shared) {
  const raw = window.localStorage.getItem(fullKey(key, shared));
  return raw === null ? null : { value: raw };
}

async function set(key, value, shared) {
  window.localStorage.setItem(fullKey(key, shared), value);
}

if (typeof window !== "undefined" && !window.storage) {
  window.storage = { get, set };
}
