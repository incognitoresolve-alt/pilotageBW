import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Shield, CreditCard, Users, LogOut, Plus, Trash2, CheckCircle2,
  Calendar, Settings, ChevronRight, ChevronLeft, Lock, TrendingUp, ClipboardList,
  AlertCircle, Award, X, Download, Euro, History, RotateCcw, Pencil, Link2, Copy,
  RefreshCw, Loader2, BarChart3
} from "lucide-react";
import * as XLSX from "xlsx";
import { verifyManagerCode } from "./lib/storage";

const CREDIT_TYPES = ["PAT", "OCA", "BPR", "MP7", "AUG", "DIM"];
const ASSURANCE_TYPES = ["ALLIN", "DIMC", "DIM"];
// Pour les crédits PAT et BPR uniquement : précise si le contrat est signé
// en papier ou via eDirect.
const CONTRACT_MODES = ["Papier", "eDirect"];
const CONTRACT_MODE_CREDIT_TYPES = ["PAT", "BPR"];

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysLeftInMonth = () => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(0, end.getDate() - now.getDate());
};
const monthLabel = () =>
  new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const monthKeyLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};
const shiftMonthKey = (key, delta) => {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
};
// Libellé de jour pour le journal structuré : "Aujourd'hui" / "Hier" pour
// les deux derniers jours, sinon le jour de semaine complet.
const dayLabel = (dateISO) => {
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  if (dateISO === todayISO()) return "Aujourd'hui";
  if (dateISO === toISODate(yd)) return "Hier";
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// Jeton d'invitation : assez long et aléatoire (Web Crypto) pour ne pas être
// devinable — c'est le lien lui-même qui fait office de preuve d'identité,
// puisqu'il n'est transmis que par le responsable, manuellement, à la bonne
// personne.
const inviteToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const formatEUR = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);

const creditLabel = (e) => `Crédit ${e.creditType}${e.contractMode ? ` (${e.contractMode})` : ""}`;

const emptyFigures = () => ({ assurance: 0, PAT: 0, OCA: 0, BPR: 0, MP7: 0, AUG: 0, DIM: 0 });

// Objectifs par produit (optionnels, en plus des objectifs globaux) :
// nombre pour les types d'assurance, montant € pour les types de crédit.
const emptyObjByType = () => ({
  assurance: Object.fromEntries(ASSURANCE_TYPES.map((t) => [t, 0])),
  credit: Object.fromEntries(CREDIT_TYPES.map((t) => [t, 0])),
});

// --- Découpage temporel pour le graphique de performance (Suivi & objectifs) ---
// Chaque granularité produit une liste fixe de "buckets" (bornes [début,fin]
// en dates ISO "YYYY-MM-DD", comparables directement à entry.date) allant du
// plus ancien au plus récent, le dernier étant toujours la période en cours.
const PERIOD_OPTIONS = [
  { key: "jour", label: "Jour", count: 14 },
  { key: "semaine", label: "Semaine", count: 8 },
  { key: "mois", label: "Mois", count: 6 },
  { key: "annee", label: "Année", count: 5 },
];
const toISODate = (d) => d.toISOString().slice(0, 10);
const startOfWeekMonday = (d) => {
  const s = new Date(d);
  const day = (s.getDay() + 6) % 7; // 0 = lundi
  s.setDate(s.getDate() - day);
  return s;
};
function buildPeriodBuckets(granularity, refDate = new Date()) {
  const { count } = PERIOD_OPTIONS.find((p) => p.key === granularity);
  const buckets = [];
  if (granularity === "jour") {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);
      buckets.push({
        startISO: toISODate(d),
        endISO: toISODate(d),
        label: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        fullLabel: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
      });
    }
  } else if (granularity === "semaine") {
    const thisWeekStart = startOfWeekMonday(refDate);
    for (let i = count - 1; i >= 0; i--) {
      const s = new Date(thisWeekStart);
      s.setDate(s.getDate() - i * 7);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      buckets.push({
        startISO: toISODate(s),
        endISO: toISODate(e),
        label: s.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        fullLabel: `Semaine du ${s.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })}`,
      });
    }
  } else if (granularity === "mois") {
    for (let i = count - 1; i >= 0; i--) {
      const s = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
      buckets.push({
        startISO: toISODate(s),
        endISO: toISODate(e),
        label: s.toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""),
        fullLabel: s.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
      });
    }
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const y = refDate.getFullYear() - i;
      buckets.push({
        startISO: `${y}-01-01`,
        endISO: `${y}-12-31`,
        label: String(y),
        fullLabel: String(y),
      });
    }
  }
  return buckets;
}
// "Performance" = nombre de dossiers vendus (assurances, pondérées par la
// quantité déclarée, + crédits) — une unité de mesure commune quel que soit
// le produit, cohérente avec les compteurs déjà affichés dans "Ma saisie".
function performanceSeries(entries, personId, granularity) {
  const buckets = buildPeriodBuckets(granularity);
  const mine = entries.filter((e) => e.personId === personId);
  return buckets.map((b) => ({
    ...b,
    value: mine.reduce((s, e) => {
      if (e.date < b.startISO || e.date > b.endISO) return s;
      return s + (e.type === "assurance" ? e.quantite || 1 : 1);
    }, 0),
  }));
}

async function loadShared(key, fallback, onError) {
  try {
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : fallback;
  } catch (e) {
    onError?.(e);
    return fallback;
  }
}
async function saveShared(key, value) {
  await window.storage.set(key, JSON.stringify(value), true);
}
async function loadLocal(key, fallback) {
  try {
    const r = await window.storage.get(key, false);
    return r ? JSON.parse(r.value) : fallback;
  } catch {
    return fallback;
  }
}
async function saveLocal(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), false);
  } catch (e) {
    console.error("storage set failed", key, e);
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [figures, setFigures] = useState({}); // { [monthKey]: { [memberId]: {assurance, ...CREDIT_TYPES} } }
  const [deletionHistory, setDeletionHistory] = useState([]); // [{id, kind, deletedAt, deletedBy, data}]
  const [invites, setInvites] = useState([]); // [{id, token, name, email, createdAt, createdBy, used, usedAt}]
  const [session, setSession] = useState(null); // {id, name, email, role}
  const [tab, setTab] = useState("saisie");
  const [toast, setToast] = useState(null);
  // Jeton d'invitation présent dans l'URL (?invite=...), le cas échéant —
  // lu une seule fois au chargement ; effacé de l'URL une fois traité.
  const [inviteParam, setInviteParam] = useState(() =>
    new URLSearchParams(window.location.search).get("invite")
  );
  const clearInviteParam = useCallback(() => {
    setInviteParam(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url);
  }, []);
  // ok: null = vérification initiale pas encore terminée, true/false ensuite
  // — reflète la dernière opération réseau (chargement ou sauvegarde),
  // pour un indicateur permanent au lieu de compter sur le toast (qui
  // disparaît avant qu'on ait pu le lire/capturer).
  const [serverStatus, setServerStatus] = useState({ ok: null, detail: null });

  const mKey = monthKey();

  const notify = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    (async () => {
      let loadError = null;
      const onError = (e) => {
        loadError = e;
      };
      const [m, e, f, h, inv, lastSession] = await Promise.all([
        loadShared("members", [], onError),
        loadShared("entries", [], onError),
        loadShared("figures", {}, onError),
        loadShared("deletionHistory", [], onError),
        loadShared("invites", [], onError),
        loadLocal("last-session", null),
      ]);
      setMembers(m);
      setEntries(e);
      setFigures(f);
      setDeletionHistory(h);
      setInvites(inv);
      if (lastSession && m.find((x) => x.id === lastSession.id)) {
        setSession(lastSession);
      }
      setReady(true);
      if (loadError) {
        setServerStatus({ ok: false, detail: loadError.message });
        notify(`Chargement des données impossible (${loadError.message}) — les chiffres affichés peuvent être incomplets.`, true);
      } else {
        setServerStatus({ ok: true, detail: null });
      }
    })();
  }, []);

  // Les données partagées (membres, ventes, chiffres, invitations) ne sont
  // chargées qu'une fois au démarrage : sans ce rafraîchissement, un
  // responsable qui garde l'onglet ouvert ne voit jamais les ventes qu'un
  // collaborateur déclare pendant ce temps (et inversement). On refait
  // silencieusement un GET en arrière-plan (fallback `null` = "rien de
  // nouveau ou échec, on ne touche pas à l'état actuel") : au retour sur
  // l'onglet, périodiquement, et via le bouton d'actualisation manuelle.
  const refreshShared = useCallback(async ({ silent = true } = {}) => {
    let loadError = null;
    const onError = (e) => {
      loadError = e;
    };
    const [m, e, f, h, inv] = await Promise.all([
      loadShared("members", null, onError),
      loadShared("entries", null, onError),
      loadShared("figures", null, onError),
      loadShared("deletionHistory", null, onError),
      loadShared("invites", null, onError),
    ]);
    if (loadError) {
      setServerStatus({ ok: false, detail: loadError.message });
      if (!silent) notify(`Actualisation impossible (${loadError.message}).`, true);
      return false;
    }
    if (m !== null) setMembers(m);
    if (e !== null) setEntries(e);
    if (f !== null) setFigures(f);
    if (h !== null) setDeletionHistory(h);
    if (inv !== null) setInvites(inv);
    setServerStatus({ ok: true, detail: null });
    if (!silent) notify("Données actualisées.");
    return true;
  }, [notify]);

  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => refreshShared(), 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshShared();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [ready, refreshShared]);

  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshShared({ silent: false });
    setRefreshing(false);
  }, [refreshShared]);

  // Chaque fonction renvoie true si la sauvegarde a réussi, false sinon —
  // les appelants doivent vérifier ce retour avant d'afficher un message
  // de succès. En cas d'échec, on revient aussi à l'état précédent pour
  // que l'écran ne montre jamais comme "enregistrée" une donnée qui ne
  // l'est pas réellement côté serveur.
  const persistMembers = async (next) => {
    const previous = members;
    setMembers(next);
    try {
      await saveShared("members", next);
      setServerStatus({ ok: true, detail: null });
      return true;
    } catch (e) {
      console.error("storage set failed", "members", e);
      setMembers(previous);
      setServerStatus({ ok: false, detail: e.message });
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistEntries = async (next) => {
    const previous = entries;
    setEntries(next);
    try {
      await saveShared("entries", next);
      setServerStatus({ ok: true, detail: null });
      return true;
    } catch (e) {
      console.error("storage set failed", "entries", e);
      setEntries(previous);
      setServerStatus({ ok: false, detail: e.message });
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistFigures = async (next) => {
    const previous = figures;
    setFigures(next);
    try {
      await saveShared("figures", next);
      setServerStatus({ ok: true, detail: null });
      return true;
    } catch (e) {
      console.error("storage set failed", "figures", e);
      setFigures(previous);
      setServerStatus({ ok: false, detail: e.message });
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistDeletionHistory = async (next) => {
    const previous = deletionHistory;
    setDeletionHistory(next);
    try {
      await saveShared("deletionHistory", next);
      setServerStatus({ ok: true, detail: null });
      return true;
    } catch (e) {
      console.error("storage set failed", "deletionHistory", e);
      setDeletionHistory(previous);
      setServerStatus({ ok: false, detail: e.message });
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistInvites = async (next) => {
    const previous = invites;
    setInvites(next);
    try {
      await saveShared("invites", next);
      setServerStatus({ ok: true, detail: null });
      return true;
    } catch (e) {
      console.error("storage set failed", "invites", e);
      setInvites(previous);
      setServerStatus({ ok: false, detail: e.message });
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  // Journalise un élément supprimé (dossier ou membre) avant sa suppression
  // effective, pour garder une trace consultable dans l'onglet Historique.
  const recordDeletion = (kind, data, actor) =>
    persistDeletionHistory([
      { id: uid(), kind, deletedAt: new Date().toISOString(), deletedBy: { id: actor.id, name: actor.name }, data },
      ...deletionHistory,
    ]);

  // Réinsère l'élément supprimé (membre ou dossier) et marque l'entrée de
  // l'historique comme restaurée, sans la faire disparaître (garde la trace).
  const restoreDeletion = async (item) => {
    let ok;
    if (item.kind === "member") {
      ok = await persistMembers([item.data, ...members]);
    } else if (item.kind === "entry") {
      ok = await persistEntries([item.data, ...entries]);
    } else {
      return;
    }
    if (ok) {
      const okHist = await persistDeletionHistory(
        deletionHistory.map((h) =>
          h.id === item.id ? { ...h, restored: true, restoredAt: new Date().toISOString() } : h
        )
      );
      if (okHist) notify("Élément restauré.");
    }
  };

  const login = async (member) => {
    setSession(member);
    await saveLocal("last-session", member);
  };
  const logout = async () => {
    setSession(null);
    await saveLocal("last-session", null);
  };

  if (!ready) {
    return (
      <div style={{ background: THEME.bg }} className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl"
          style={{ background: THEME.navy }}
        >
          <Loader2 size={22} color={THEME.teal} className="animate-spin" />
        </div>
        <div className="text-sm tracking-wide" style={{ color: THEME.navySoft, fontFamily: FONT_BODY }}>
          Chargement…
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: THEME.bg, fontFamily: FONT_BODY, color: THEME.navy }} className="min-h-screen">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        input, select { font-family: ${FONT_BODY}; }
        input:focus, select:focus, button:focus-visible {
          outline: 2px solid ${THEME.teal};
          outline-offset: 1px;
        }
        ::selection { background: ${THEME.tealSoft}; }
        @keyframes scFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .sc-fade-in { animation: scFadeIn 0.22s ease-out; }
        @keyframes scToastIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .sc-toast { animation: scToastIn 0.18s ease-out; }
      `}</style>

      {toast && (
        <div
          className="sc-toast fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
          style={{ background: toast.isError ? THEME.red : THEME.navy, color: "#fff" }}
        >
          {toast.isError ? (
            <AlertCircle size={16} />
          ) : (
            <CheckCircle2 size={16} style={{ color: THEME.teal }} />
          )}
          {toast.msg}
        </div>
      )}

      <ServerStatusBadge status={serverStatus} />

      {!session ? (
        inviteParam ? (
          <AcceptInviteScreen
            token={inviteParam}
            invites={invites}
            members={members}
            onCreateMember={persistMembers}
            onUpdateInvites={persistInvites}
            onLogin={login}
            onCancel={clearInviteParam}
            notify={notify}
          />
        ) : (
          <LoginScreen members={members} onCreateMember={persistMembers} onLogin={login} notify={notify} />
        )
      ) : (
        <MainApp
          session={session}
          onLogout={logout}
          members={members}
          setMembers={persistMembers}
          entries={entries}
          setEntries={persistEntries}
          figures={figures}
          setFigures={persistFigures}
          deletionHistory={deletionHistory}
          recordDeletion={recordDeletion}
          restoreDeletion={restoreDeletion}
          invites={invites}
          setInvites={persistInvites}
          tab={tab}
          setTab={setTab}
          mKey={mKey}
          notify={notify}
          onRefresh={manualRefresh}
          refreshing={refreshing}
        />
      )}
    </div>
  );
}

/* ---------------- THEME ---------------- */
const THEME = {
  bg: "#F3F5F7",
  navy: "#132038",
  navySoft: "#4B5A72",
  teal: "#0E7C72",
  tealSoft: "#D7EDE9",
  amber: "#C08A2E",
  amberSoft: "#F5E7CD",
  red: "#B4384A",
  redSoft: "#F5DCE0",
  card: "#FFFFFF",
  line: "#E3E7EC",
};
// Accent distinct pour l'interface responsable (nav, boutons d'action
// manager) — permet de voir d'un coup d'œil dans quel mode on est,
// sans toucher aux couleurs sémantiques des métriques (teal/ambre).
const MANAGER_ACCENT = "#7A1F3D";
const MANAGER_ACCENT_SOFT = "#F3E1E7";
const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";

/* ---------------- LOGIN ---------------- */
function LoginScreen({ members, onCreateMember, onLogin, notify }) {
  const [mode, setMode] = useState("collab"); // collab | manager
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const submitCollab = async (e) => {
    e.preventDefault();
    setError("");
    const em = email.trim().toLowerCase();
    if (!em || !name.trim()) return setError("Renseignez votre nom et votre e-mail.");
    let existing = members.find((m) => m.email.toLowerCase() === em);
    if (existing) {
      onLogin(existing);
      return;
    }
    setError("Aucun compte trouvé avec cet e-mail. Demandez un lien d'invitation à votre responsable pour créer votre compte.");
  };

  const submitManager = async (e) => {
    e.preventDefault();
    setError("");
    const em = email.trim().toLowerCase();
    if (!em || !name.trim()) return setError("Renseignez votre nom et votre e-mail professionnel.");
    const valid = await verifyManagerCode(code);
    if (!valid) return setError("Code d'accès responsable incorrect (ou connexion au serveur impossible).");
    let existing = members.find((m) => m.email.toLowerCase() === em);
    if (existing) {
      if (existing.role !== "responsable") {
        existing = { ...existing, role: "responsable" };
        await onCreateMember(members.map((m) => (m.id === existing.id ? existing : m)));
      }
      onLogin(existing);
      return;
    }
    const newManager = {
      id: uid(),
      name: name.trim(),
      email: em,
      role: "responsable",
      createdAt: new Date().toISOString(),
    };
    const ok = await onCreateMember([...members, newManager]);
    onLogin(newManager);
    if (ok) notify("Accès responsable activé.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: THEME.navy }}
          >
            <TrendingUp size={26} color={THEME.teal} />
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, color: THEME.navy }} className="text-2xl font-semibold tracking-tight">
            Suivi Commercial
          </h1>
          <p className="text-sm mt-1" style={{ color: THEME.navySoft }}>
            Assurances & crédits — objectifs du mois
          </p>
        </div>

        <div
          className="rounded-2xl overflow-hidden shadow-sm"
          style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}
        >
          <div className="flex" style={{ borderBottom: `1px solid ${THEME.line}` }}>
            <button
              onClick={() => { setMode("collab"); setError(""); }}
              className="flex-1 py-3 text-sm font-medium transition-colors"
              style={{
                color: mode === "collab" ? THEME.teal : THEME.navySoft,
                borderBottom: mode === "collab" ? `2px solid ${THEME.teal}` : "2px solid transparent",
              }}
            >
              Collaborateur
            </button>
            <button
              onClick={() => { setMode("manager"); setError(""); }}
              className="flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
              style={{
                color: mode === "manager" ? MANAGER_ACCENT : THEME.navySoft,
                borderBottom: mode === "manager" ? `2px solid ${MANAGER_ACCENT}` : "2px solid transparent",
              }}
            >
              <Lock size={13} /> Responsable
            </button>
          </div>

          <form onSubmit={mode === "collab" ? submitCollab : submitManager} className="p-6 space-y-4">
            <Field label="Nom complet">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Prénom Nom"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm"
                style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
              />
            </Field>
            <Field label={mode === "collab" ? "Adresse e-mail" : "E-mail professionnel"}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom.nom@monentreprise.be"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm"
                style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
              />
            </Field>
            {mode === "manager" && (
              <Field label="Code d'accès responsable">
                <input
                  type="password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm"
                  style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
                />
              </Field>
            )}
            {error && (
              <div className="text-sm flex items-center gap-1.5" style={{ color: THEME.red }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
              style={{ background: THEME.navy }}
            >
              Entrer <ChevronRight size={15} />
            </button>
          </form>
        </div>
        <p className="text-center text-xs mt-4" style={{ color: THEME.navySoft }}>
          Connexion par identification e-mail. La création d'un compte collaborateur se fait uniquement via un lien d'invitation envoyé par votre responsable.
        </p>
      </div>
    </div>
  );
}

// Indicateur permanent (bas d'écran, toutes pages) de l'état de la
// connexion au serveur — reflète la dernière opération réseau
// (chargement initial ou sauvegarde). Contrairement au toast, ne
// disparaît jamais tout seul : plus besoin de capture d'écran au bon
// moment pour diagnostiquer un problème.
function ServerStatusBadge({ status }) {
  if (status.ok === null) return null; // vérification initiale pas encore terminée
  return (
    <div
      className="fixed bottom-3 left-3 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-sm"
      style={{
        background: status.ok ? "#E3F3EF" : THEME.redSoft,
        color: status.ok ? THEME.teal : THEME.red,
        maxWidth: "min(92vw, 26rem)",
      }}
    >
      <span
        className="inline-block rounded-full flex-shrink-0"
        style={{ width: 7, height: 7, background: status.ok ? THEME.teal : THEME.red }}
      />
      <span className="truncate">
        {status.ok ? "Connexion serveur : OK" : `Connexion serveur : KO${status.detail ? ` — ${status.detail}` : ""}`}
      </span>
    </div>
  );
}

// Écran affiché quand l'URL contient ?invite=<jeton> et qu'aucune session
// n'est active — c'est le seul moyen de créer un compte collaborateur
// depuis la suppression de l'auto-inscription libre.
function AcceptInviteScreen({ token, invites, members, onCreateMember, onUpdateInvites, onLogin, onCancel, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const invite = invites.find((i) => i.token === token);

  if (!invite || invite.used) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-4">
          <AlertCircle size={32} style={{ color: THEME.red }} className="mx-auto" />
          <h1 className="text-lg font-semibold" style={{ fontFamily: FONT_DISPLAY, color: THEME.navy }}>
            Lien d'invitation invalide
          </h1>
          <p className="text-sm" style={{ color: THEME.navySoft }}>
            Ce lien n'existe pas, a déjà été utilisé, ou a été révoqué. Demandez un nouveau lien à votre responsable.
          </p>
          <button onClick={onCancel} className="text-sm font-medium underline" style={{ color: THEME.teal }}>
            Revenir à la connexion normale
          </button>
        </div>
      </div>
    );
  }

  const activate = async () => {
    setBusy(true);
    setError("");
    const em = invite.email.toLowerCase();
    if (members.find((m) => m.email.toLowerCase() === em)) {
      setError("Un compte existe déjà avec cet e-mail — utilisez la connexion normale.");
      setBusy(false);
      return;
    }
    const newMember = {
      id: uid(),
      name: invite.name,
      email: em,
      role: "collaborateur",
      objectifAssurance: 5,
      objectifCredit: 5,
      objectifMontant: 5000,
      createdAt: new Date().toISOString(),
    };
    const okMembers = await onCreateMember([...members, newMember]);
    if (!okMembers) {
      setBusy(false);
      return;
    }
    const okInvites = await onUpdateInvites(
      invites.map((i) => (i.id === invite.id ? { ...i, used: true, usedAt: new Date().toISOString() } : i))
    );
    onCancel();
    await onLogin(newMember);
    if (okInvites) notify("Bienvenue ! Votre compte a été activé.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: THEME.navy }}
          >
            <Users size={26} color={THEME.teal} />
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, color: THEME.navy }} className="text-2xl font-semibold tracking-tight">
            Invitation à rejoindre l'équipe
          </h1>
          <p className="text-sm mt-1" style={{ color: THEME.navySoft }}>
            Suivi Commercial — Assurances & crédits
          </p>
        </div>

        <div
          className="rounded-2xl overflow-hidden shadow-sm p-6 space-y-4"
          style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}
        >
          <div className="text-sm">
            <div className="text-xs font-medium mb-1" style={{ color: THEME.navySoft }}>
              Compte à activer
            </div>
            <div className="font-semibold">{invite.name}</div>
            <div style={{ color: THEME.navySoft }}>{invite.email}</div>
          </div>
          {error && (
            <div className="text-sm flex items-center gap-1.5" style={{ color: THEME.red }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button
            onClick={activate}
            disabled={busy}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: THEME.teal }}
          >
            Activer mon compte <ChevronRight size={15} />
          </button>
          <button onClick={onCancel} className="w-full text-center text-xs underline" style={{ color: THEME.navySoft }}>
            Ce n'est pas moi / revenir à la connexion
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: THEME.navySoft }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/* ---------------- MAIN APP ---------------- */
function MainApp({ session, onLogout, members, setMembers, entries, setEntries, figures, setFigures, deletionHistory, recordDeletion, restoreDeletion, invites, setInvites, tab, setTab, mKey, notify, onRefresh, refreshing }) {
  const isManager = session.role === "responsable";
  const accent = isManager ? MANAGER_ACCENT : THEME.teal;
  const accentSoft = isManager ? MANAGER_ACCENT_SOFT : THEME.tealSoft;

  return (
    <div>
      <header
        className="sticky top-0 z-20 px-5 py-4 flex items-center justify-between"
        style={{ background: isManager ? accent : THEME.card, borderBottom: isManager ? "none" : `1px solid ${THEME.line}` }}
      >
        <div>
          <div
            style={{ fontFamily: FONT_DISPLAY, color: isManager ? "#fff" : THEME.navy }}
            className="text-base font-semibold"
          >
            Suivi Commercial
          </div>
          <div className="text-xs capitalize" style={{ color: isManager ? "rgba(255,255,255,0.75)" : THEME.navySoft }}>
            {monthLabel()}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium" style={{ color: isManager ? "#fff" : THEME.navy }}>
              {session.name}
            </div>
            <div
              className="text-xs font-medium inline-block px-2 py-0.5 rounded-full"
              style={{ color: accent, background: isManager ? "#fff" : accentSoft }}
            >
              {isManager ? "Responsable" : "Collaborateur"}
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg transition-colors disabled:opacity-60"
            style={{ background: isManager ? "rgba(255,255,255,0.15)" : THEME.bg }}
            aria-label="Actualiser les données"
            title="Actualiser les données"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} style={{ color: isManager ? "#fff" : THEME.navySoft }} />
          </button>
          <button
            onClick={onLogout}
            className="p-2 rounded-lg transition-colors"
            style={{ background: isManager ? "rgba(255,255,255,0.15)" : THEME.bg }}
            aria-label="Se déconnecter"
          >
            <LogOut size={16} style={{ color: isManager ? "#fff" : THEME.navySoft }} />
          </button>
        </div>
      </header>

      <nav className="flex gap-1 px-5 pt-4 max-w-5xl mx-auto">
        <TabButton active={tab === "saisie"} onClick={() => setTab("saisie")} icon={ClipboardList} accent={accent}>
          Ma saisie
        </TabButton>
        <TabButton active={tab === "journal"} onClick={() => setTab("journal")} icon={Calendar} accent={accent}>
          Journal
        </TabButton>
        <TabButton active={tab === "suivi"} onClick={() => setTab("suivi")} icon={Award} accent={accent}>
          Suivi & objectifs
        </TabButton>
        {isManager && (
          <TabButton active={tab === "equipe"} onClick={() => setTab("equipe")} icon={Users} accent={accent}>
            Équipe
          </TabButton>
        )}
        {isManager && (
          <TabButton active={tab === "historique"} onClick={() => setTab("historique")} icon={History} accent={accent}>
            Historique
          </TabButton>
        )}
      </nav>

      <main key={tab} className="sc-fade-in max-w-5xl mx-auto px-5 pb-16 pt-5">
        {tab === "saisie" && (
          <SaisieTab
            session={session}
            entries={entries}
            setEntries={setEntries}
            recordDeletion={recordDeletion}
            mKey={mKey}
            notify={notify}
            setTab={setTab}
          />
        )}
        {tab === "journal" && (
          <JournalTab
            session={session}
            entries={entries}
            setEntries={setEntries}
            recordDeletion={recordDeletion}
            isManager={isManager}
            mKey={mKey}
            notify={notify}
          />
        )}
        {tab === "suivi" && (
          <SuiviTab
            session={session}
            members={members}
            setMembers={setMembers}
            entries={entries}
            figures={figures}
            setFigures={setFigures}
            mKey={mKey}
            notify={notify}
            isManager={isManager}
          />
        )}
        {tab === "equipe" && isManager && (
          <EquipeTab
            members={members}
            setMembers={setMembers}
            recordDeletion={recordDeletion}
            session={session}
            notify={notify}
            invites={invites}
            setInvites={setInvites}
          />
        )}
        {tab === "historique" && isManager && (
          <HistoriqueTab deletionHistory={deletionHistory} restoreDeletion={restoreDeletion} />
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children, accent = THEME.teal }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-sm font-medium transition-colors"
      style={{
        color: active ? accent : THEME.navySoft,
        background: active ? THEME.card : "transparent",
        borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
      }}
    >
      <Icon size={15} /> {children}
    </button>
  );
}

/* ---------------- SAISIE TAB ---------------- */
function SaisieTab({ session, entries, setEntries, recordDeletion, mKey, notify, setTab }) {
  const [type, setType] = useState("assurance");
  const [creditType, setCreditType] = useState("PAT");
  const [contractMode, setContractMode] = useState("Papier");
  const [assuranceType, setAssuranceType] = useState("ALLIN");
  const [quantite, setQuantite] = useState("1");
  const [dossier, setDossier] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState(todayISO());
  const [editingEntryId, setEditingEntryId] = useState(null);

  const needsContractMode = type === "credit" && CONTRACT_MODE_CREDIT_TYPES.includes(creditType);

  const myEntries = useMemo(
    () =>
      entries
        .filter((e) => e.personId === session.id && e.date.slice(0, 7) === mKey)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries, session.id, mKey]
  );
  const todayEntries = useMemo(
    () => myEntries.filter((e) => e.date === todayISO()),
    [myEntries]
  );

  const resetForm = () => {
    setEditingEntryId(null);
    setType("assurance");
    setCreditType("PAT");
    setContractMode("Papier");
    setAssuranceType("ALLIN");
    setQuantite("1");
    setDossier("");
    setMontant("");
    setDate(todayISO());
  };

  const startEditEntry = (entry) => {
    setEditingEntryId(entry.id);
    setType(entry.type);
    setCreditType(entry.creditType || "PAT");
    setContractMode(entry.contractMode || "Papier");
    setAssuranceType(entry.assuranceType || "ALLIN");
    setQuantite(String(entry.quantite || 1));
    setDossier(entry.dossier);
    setMontant(entry.montant ? String(entry.montant) : "");
    setDate(entry.date);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!dossier.trim()) return notify("Indiquez le numéro de dossier.");
    const entryData = {
      personId: session.id,
      personName: session.name,
      type,
      creditType: type === "credit" ? creditType : null,
      contractMode: needsContractMode ? contractMode : null,
      assuranceType: type === "assurance" ? assuranceType : null,
      quantite: type === "assurance" ? Number(quantite) || 1 : null,
      dossier: dossier.trim(),
      montant: type === "credit" ? Number(montant) || 0 : 0,
      date,
      updatedAt: new Date().toISOString(),
    };
    const isEditingEntry = !!editingEntryId;
    const next = isEditingEntry
      ? entries.map((en) => (en.id === editingEntryId ? { ...en, ...entryData } : en))
      : [{ id: uid(), createdAt: entryData.updatedAt, ...entryData }, ...entries];
    const ok = await setEntries(next);
    if (ok) {
      resetForm();
      notify(
        isEditingEntry
          ? "Modifications enregistrées."
          : type === "assurance"
          ? `Assurance ${assuranceType} enregistrée.`
          : `Crédit ${creditType}${needsContractMode ? ` (${contractMode})` : ""} enregistré.`
      );
    }
  };

  const remove = async (id) => {
    const entry = entries.find((e) => e.id === id);
    await setEntries(entries.filter((e) => e.id !== id));
    if (entry) await recordDeletion("entry", entry, session);
    if (editingEntryId === id) resetForm();
  };

  const countAssurance = myEntries
    .filter((e) => e.type === "assurance")
    .reduce((s, e) => s + (e.quantite || 1), 0);
  const montantTotal = myEntries.reduce((s, e) => s + (e.montant || 0), 0);
  const countCredit = myEntries.filter((e) => e.type === "credit").length;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          {editingEntryId ? (
            <>
              <Pencil size={15} style={{ color: THEME.teal }} /> Modifier la vente
            </>
          ) : (
            <>
              <Plus size={15} style={{ color: THEME.teal }} /> Nouvelle vente
            </>
          )}
        </h2>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <TypeToggle active={type === "assurance"} onClick={() => setType("assurance")} icon={Shield}>
              Assurance
            </TypeToggle>
            <TypeToggle active={type === "credit"} onClick={() => setType("credit")} icon={CreditCard}>
              Crédit
            </TypeToggle>
          </div>

          {type === "credit" && (
            <Field label="Type de crédit">
              <div className="grid grid-cols-3 gap-1.5">
                {CREDIT_TYPES.map((ct) => (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => setCreditType(ct)}
                    className="py-2 rounded-lg text-xs font-semibold transition-colors"
                    style={{
                      background: creditType === ct ? THEME.navy : THEME.bg,
                      color: creditType === ct ? "#fff" : THEME.navySoft,
                    }}
                  >
                    {ct}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {needsContractMode && (
            <Field label="Type de contrat">
              <div className="grid grid-cols-2 gap-2">
                {CONTRACT_MODES.map((cm) => (
                  <button
                    key={cm}
                    type="button"
                    onClick={() => setContractMode(cm)}
                    className="py-2 rounded-lg text-xs font-semibold transition-colors"
                    style={{
                      background: contractMode === cm ? THEME.navy : THEME.bg,
                      color: contractMode === cm ? "#fff" : THEME.navySoft,
                    }}
                  >
                    {cm}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {type === "assurance" && (
            <Field label="Type d'assurance">
              <div className="grid grid-cols-3 gap-1.5">
                {ASSURANCE_TYPES.map((at) => (
                  <button
                    key={at}
                    type="button"
                    onClick={() => setAssuranceType(at)}
                    className="py-2 rounded-lg text-xs font-semibold transition-colors"
                    style={{
                      background: assuranceType === at ? THEME.navy : THEME.bg,
                      color: assuranceType === at ? "#fff" : THEME.navySoft,
                    }}
                  >
                    {at}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field label="Numéro de dossier">
            <input
              value={dossier}
              onChange={(e) => setDossier(e.target.value)}
              placeholder="Ex: DOS-2026-0472"
              className="w-full px-3.5 py-2.5 rounded-lg text-sm"
              style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
            />
          </Field>

          {type === "assurance" ? (
            <Field label="Nombre d'assurances vendues">
              <input
                type="number"
                min="1"
                step="1"
                value={quantite}
                onChange={(e) => setQuantite(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg text-sm"
                style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
              />
            </Field>
          ) : (
            <Field label="Montant vendu">
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                  placeholder="0,00"
                  className="w-full pl-3.5 pr-8 py-2.5 rounded-lg text-sm"
                  style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
                />
                <span
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: THEME.navySoft }}
                >
                  €
                </span>
              </div>
            </Field>
          )}

          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-sm"
              style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
            />
          </Field>

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: THEME.teal }}
            >
              {editingEntryId ? "Enregistrer les modifications" : "Enregistrer"}
            </button>
            {editingEntryId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: THEME.bg, color: THEME.navySoft }}
              >
                Annuler
              </button>
            )}
          </div>
        </form>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatCard icon={Shield} label="Assurances ce mois" value={countAssurance} color={THEME.teal} />
          <StatCard icon={CreditCard} label="Crédits ce mois" value={countCredit} color={THEME.amber} />
          <div className="col-span-2 rounded-2xl p-4" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
            <span className="block text-xs font-medium mb-2" style={{ color: THEME.navySoft }}>
              Montant total vendu ce mois
            </span>
            <div style={{ fontFamily: FONT_DISPLAY, color: THEME.navy }} className="text-3xl font-semibold">
              {formatEUR(montantTotal)}
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-sm font-semibold">Mes ventes du jour</h2>
            <button
              onClick={() => setTab("journal")}
              className="text-xs font-medium flex items-center gap-1 flex-shrink-0"
              style={{ color: THEME.teal }}
            >
              Voir le journal complet <ChevronRight size={13} />
            </button>
          </div>
          {todayEntries.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: THEME.navySoft }}>
              Aucune vente déclarée aujourd'hui.
            </p>
          ) : (
            <div className="space-y-2">
              {todayEntries.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm"
                  style={{ background: THEME.bg }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {e.type === "assurance" ? (
                      <Shield size={15} style={{ color: THEME.teal, flexShrink: 0 }} />
                    ) : (
                      <CreditCard size={15} style={{ color: THEME.amber, flexShrink: 0 }} />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {e.type === "assurance" ? `Assurance ${e.assuranceType}` : creditLabel(e)} — {e.dossier}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-medium" style={{ color: THEME.navy }}>
                      {e.type === "assurance" ? `× ${e.quantite || 1}` : formatEUR(e.montant)}
                    </span>
                    <button
                      onClick={() => startEditEntry(e)}
                      className="p-1.5 rounded-md flex-shrink-0"
                      aria-label="Modifier"
                    >
                      <Pencil size={14} style={{ color: THEME.navySoft }} />
                    </button>
                    <ConfirmActionButton onConfirm={() => remove(e.id)} label="Supprimer" />
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: THEME.navySoft }}>
            <AlertCircle size={12} /> Ces déclarations servent de journal. Les chiffres officiels sont validés par le responsable.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- JOURNAL TAB ---------------- */
// Vue structurée des ventes, jour par jour : pour un collaborateur, son
// propre journal ; pour le responsable, celui de toute l'équipe (avec le
// nom du vendeur sur chaque ligne). Navigation par mois comme dans "Suivi
// & objectifs", et un sous-total par jour (assurances / crédits / montant)
// pour un coup d'œil rapide sur l'activité d'une journée donnée.
function JournalTab({ session, entries, setEntries, recordDeletion, isManager, mKey, notify }) {
  const [viewMonth, setViewMonth] = useState(mKey);
  const isCurrentMonth = viewMonth === mKey;

  const scoped = useMemo(
    () =>
      entries
        .filter((e) => e.date.slice(0, 7) === viewMonth && (isManager || e.personId === session.id))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1))),
    [entries, viewMonth, isManager, session.id]
  );

  const byDay = useMemo(() => {
    const map = new Map();
    scoped.forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    });
    return [...map.entries()];
  }, [scoped]);

  const remove = async (entry) => {
    const ok = await setEntries(entries.filter((x) => x.id !== entry.id));
    if (ok) {
      await recordDeletion("entry", entry, session);
      notify("Vente supprimée.");
    }
  };

  const dayStats = (dayEntries) => ({
    assurances: dayEntries.filter((e) => e.type === "assurance").reduce((s, e) => s + (e.quantite || 1), 0),
    credits: dayEntries.filter((e) => e.type === "credit").length,
    montant: dayEntries.reduce((s, e) => s + (e.montant || 0), 0),
  });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: THEME.navy, color: "#fff" }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMonth((v) => shiftMonthKey(v, -1))}
            aria-label="Mois précédent"
            className="p-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <ChevronLeft size={15} />
          </button>
          <Calendar size={18} style={{ color: isCurrentMonth ? THEME.teal : "rgba(255,255,255,0.6)" }} />
          <div className="text-sm capitalize">
            {monthKeyLabel(viewMonth)}
            {!isCurrentMonth && (
              <span className="text-xs ml-2" style={{ color: "rgba(255,255,255,0.6)" }}>
                (archivé)
              </span>
            )}
          </div>
          <button
            onClick={() => setViewMonth((v) => shiftMonthKey(v, 1))}
            disabled={isCurrentMonth}
            aria-label="Mois suivant"
            className="p-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.12)", opacity: isCurrentMonth ? 0.4 : 1, cursor: isCurrentMonth ? "default" : "pointer" }}
          >
            <ChevronRight size={15} />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={() => setViewMonth(mKey)}
              className="text-xs underline ml-1"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Revenir au mois en cours
            </button>
          )}
        </div>
        <div className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
          {scoped.length} dossier{scoped.length !== 1 ? "s" : ""} sur {byDay.length} jour{byDay.length !== 1 ? "s" : ""}
        </div>
      </div>

      {byDay.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          <p className="text-sm" style={{ color: THEME.navySoft }}>
            Aucune vente déclarée sur cette période.
          </p>
        </div>
      ) : (
        byDay.map(([date, dayEntries]) => {
          const { assurances, credits, montant } = dayStats(dayEntries);
          return (
            <div key={date} className="rounded-2xl overflow-hidden" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
              <div
                className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
                style={{ borderBottom: `1px solid ${THEME.line}`, background: THEME.bg }}
              >
                <div className="text-sm font-semibold capitalize">{dayLabel(date)}</div>
                <div className="flex items-center gap-3 text-xs" style={{ color: THEME.navySoft }}>
                  {assurances > 0 && (
                    <span className="flex items-center gap-1">
                      <Shield size={12} style={{ color: THEME.teal }} /> {assurances}
                    </span>
                  )}
                  {credits > 0 && (
                    <span className="flex items-center gap-1">
                      <CreditCard size={12} style={{ color: THEME.amber }} /> {credits}
                    </span>
                  )}
                  {montant > 0 && (
                    <span className="font-medium" style={{ color: THEME.navy }}>
                      {formatEUR(montant)}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-3 space-y-2">
                {dayEntries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm gap-2"
                    style={{ background: THEME.bg }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {e.type === "assurance" ? (
                        <Shield size={15} style={{ color: THEME.teal, flexShrink: 0 }} />
                      ) : (
                        <CreditCard size={15} style={{ color: THEME.amber, flexShrink: 0 }} />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {e.type === "assurance" ? `Assurance ${e.assuranceType}` : creditLabel(e)} — {e.dossier}
                        </div>
                        {isManager && (
                          <div className="text-xs truncate" style={{ color: THEME.navySoft }}>
                            {e.personName}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-medium" style={{ color: THEME.navy }}>
                        {e.type === "assurance" ? `× ${e.quantite || 1}` : formatEUR(e.montant)}
                      </span>
                      {(isManager || e.personId === session.id) && (
                        <ConfirmActionButton onConfirm={() => remove(e)} label="Supprimer" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// Bouton d'action à double confirmation, générique : un premier clic
// arme un bouton "Confirmer" (+ annulation) pendant quelques secondes
// au lieu d'agir immédiatement. Utilisé pour les suppressions (icône
// seule, rouge) et pour l'application groupée d'objectifs (bouton
// texte, teal).
function ConfirmActionButton({
  onConfirm,
  label,
  confirmLabel = "Confirmer",
  icon: Icon = Trash2,
  color = THEME.red,
  iconOnly = true,
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          className="px-2 py-1 rounded-md text-xs font-semibold text-white whitespace-nowrap"
          style={{ background: color }}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="p-1.5 rounded-md"
          aria-label="Annuler"
        >
          <X size={14} style={{ color: THEME.navySoft }} />
        </button>
      </div>
    );
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="p-1.5 rounded-md flex-shrink-0"
        aria-label={label}
      >
        <Icon size={14} style={{ color }} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap transition-opacity hover:opacity-90"
      style={{ background: color, color: "#fff" }}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function TypeToggle({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-colors"
      style={{
        background: active ? THEME.tealSoft : THEME.bg,
        color: active ? THEME.teal : THEME.navySoft,
        border: active ? `1px solid ${THEME.teal}` : `1px solid transparent`,
      }}
    >
      <Icon size={15} /> {children}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} style={{ color }} />
        <span className="text-xs font-medium" style={{ color: THEME.navySoft }}>{label}</span>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, color: THEME.navy }} className="text-3xl font-semibold">
        {value}
      </div>
    </div>
  );
}

/* ---------------- SUIVI TAB ---------------- */
function SuiviTab({ session, members, setMembers, entries, figures, setFigures, mKey, notify, isManager }) {
  const collaborators = members.filter((m) => m.role === "collaborateur");
  const [viewMonth, setViewMonth] = useState(mKey);
  const isCurrentMonth = viewMonth === mKey;
  const monthFigures = figures[viewMonth] || {};
  const daysLeft = daysLeftInMonth();

  const [editing, setEditing] = useState(null); // memberId being edited by manager
  const [draft, setDraft] = useState(emptyFigures());
  const [objDraft, setObjDraft] = useState({ objectifAssurance: 0, objectifCredit: 0, objectifMontant: 0 });
  const [objByTypeDraft, setObjByTypeDraft] = useState(emptyObjByType());
  const [generalObj, setGeneralObj] = useState({ objectifAssurance: 5, objectifCredit: 5, objectifMontant: 5000 });

  const applyGeneralObjectives = async () => {
    const updated = members.map((m) =>
      m.role === "collaborateur"
        ? {
            ...m,
            objectifAssurance: Number(generalObj.objectifAssurance) || 0,
            objectifCredit: Number(generalObj.objectifCredit) || 0,
            objectifMontant: Number(generalObj.objectifMontant) || 0,
          }
        : m
    );
    const ok = await setMembers(updated);
    if (ok) notify(`Objectifs généraux appliqués à ${collaborators.length} collaborateur(s).`);
  };

  const startEdit = (member) => {
    setEditing(member.id);
    setDraft(monthFigures[member.id] || emptyFigures());
    setObjDraft({
      objectifAssurance: member.objectifAssurance ?? 5,
      objectifCredit: member.objectifCredit ?? 5,
      objectifMontant: member.objectifMontant ?? 5000,
    });
    setObjByTypeDraft({
      assurance: { ...emptyObjByType().assurance, ...(member.objectifsAssuranceParType || {}) },
      credit: { ...emptyObjByType().credit, ...(member.objectifsCreditParType || {}) },
    });
  };

  const saveEdit = async (member) => {
    const next = { ...figures, [viewMonth]: { ...monthFigures, [member.id]: draft } };
    const okFigures = await setFigures(next);
    const okMembers = await setMembers(
      members.map((m) =>
        m.id === member.id
          ? {
              ...m,
              objectifAssurance: Number(objDraft.objectifAssurance) || 0,
              objectifCredit: Number(objDraft.objectifCredit) || 0,
              objectifMontant: Number(objDraft.objectifMontant) || 0,
              objectifsAssuranceParType: objByTypeDraft.assurance,
              objectifsCreditParType: objByTypeDraft.credit,
            }
          : m
      )
    );
    if (okFigures && okMembers) {
      setEditing(null);
      notify(`Chiffres mis à jour — ${member.name}`);
    }
  };

  const visibleMembers = isManager ? collaborators : collaborators.filter((m) => m.id === session.id);

  const exportExcel = () => {
    const rows = collaborators.map((m) => {
      const f = monthFigures[m.id] || emptyFigures();
      const creditTotal = CREDIT_TYPES.reduce((s, ct) => s + (f[ct] || 0), 0);
      const declared = entries.filter(
        (e) => e.personId === m.id && e.date.slice(0, 7) === viewMonth
      );
      const montantTotal = declared.reduce((s, e) => s + (e.montant || 0), 0);
      const assuranceTotal = declared
        .filter((e) => e.type === "assurance")
        .reduce((s, e) => s + (e.quantite || 1), 0);
      return {
        "Collaborateur": m.name,
        "E-mail": m.email,
        "Assurances": assuranceTotal,
        "Objectif assurances": m.objectifAssurance ?? 5,
        ...Object.fromEntries(CREDIT_TYPES.map((ct) => [ct, f[ct] || 0])),
        "Total crédits": creditTotal,
        "Objectif crédits": m.objectifCredit ?? 5,
        "Montant vendu (journal)": montantTotal,
        "Objectif montant (€)": m.objectifMontant ?? 5000,
        "Dossiers déclarés (journal)": declared.length,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Chiffres du mois");
    XLSX.writeFile(wb, `suivi-commercial-${viewMonth}.xlsx`);
    notify("Export Excel généré.");
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: THEME.navy, color: "#fff" }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMonth((v) => shiftMonthKey(v, -1))}
            aria-label="Mois précédent"
            className="p-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <ChevronLeft size={15} />
          </button>
          <Calendar size={18} style={{ color: isCurrentMonth ? THEME.teal : "rgba(255,255,255,0.6)" }} />
          <div className="text-sm">
            {isCurrentMonth && (
              <>
                <span className="font-semibold">{daysLeft}</span> jour{daysLeft > 1 ? "s" : ""} restant{daysLeft > 1 ? "s" : ""} avant la fin du mois{" — "}
              </>
            )}
            <span className="capitalize">{monthKeyLabel(viewMonth)}</span>
            {!isCurrentMonth && (
              <span className="text-xs ml-2" style={{ color: "rgba(255,255,255,0.6)" }}>
                (archivé)
              </span>
            )}
          </div>
          <button
            onClick={() => setViewMonth((v) => shiftMonthKey(v, 1))}
            disabled={isCurrentMonth}
            aria-label="Mois suivant"
            className="p-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.12)", opacity: isCurrentMonth ? 0.4 : 1, cursor: isCurrentMonth ? "default" : "pointer" }}
          >
            <ChevronRight size={15} />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={() => setViewMonth(mKey)}
              className="text-xs underline ml-1"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Revenir au mois en cours
            </button>
          )}
        </div>
        {isManager && collaborators.length > 0 && (
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-90"
            style={{ background: MANAGER_ACCENT, color: "#fff" }}
          >
            <Download size={14} /> Exporter en Excel
          </button>
        )}
      </div>

      {isManager && collaborators.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          <h2 className="text-sm font-semibold mb-1">Objectifs généraux</h2>
          <p className="text-xs mb-4" style={{ color: THEME.navySoft }}>
            S'applique à tous les collaborateurs ({collaborators.length}) en une fois — les objectifs individuels restent modifiables ensuite via "Mettre à jour" sur chaque collaborateur.
          </p>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <Field label="Objectif assurances (nombre)">
              <input
                type="number"
                min="0"
                value={generalObj.objectifAssurance}
                onChange={(e) => setGeneralObj((o) => ({ ...o, objectifAssurance: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-center"
                style={{ border: `1px solid ${THEME.line}` }}
              />
            </Field>
            <Field label="Objectif crédits (nombre)">
              <input
                type="number"
                min="0"
                value={generalObj.objectifCredit}
                onChange={(e) => setGeneralObj((o) => ({ ...o, objectifCredit: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-center"
                style={{ border: `1px solid ${THEME.line}` }}
              />
            </Field>
            <Field label="Objectif montant (€)">
              <input
                type="number"
                min="0"
                value={generalObj.objectifMontant}
                onChange={(e) => setGeneralObj((o) => ({ ...o, objectifMontant: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-center"
                style={{ border: `1px solid ${THEME.line}` }}
              />
            </Field>
          </div>
          <ConfirmActionButton
            onConfirm={applyGeneralObjectives}
            label={`Appliquer à tous les collaborateurs (${collaborators.length})`}
            confirmLabel="Confirmer"
            icon={Users}
            color={MANAGER_ACCENT}
            iconOnly={false}
          />
        </div>
      )}

      {visibleMembers.length === 0 && (
        <p className="text-sm text-center py-10" style={{ color: THEME.navySoft }}>
          Aucun collaborateur pour l'instant.
        </p>
      )}

      {visibleMembers.map((member) => {
        const f = monthFigures[member.id] || emptyFigures();
        const creditTotal = CREDIT_TYPES.reduce((s, ct) => s + (f[ct] || 0), 0);
        const objA = member.objectifAssurance ?? 5;
        const objC = member.objectifCredit ?? 5;
        const objM = member.objectifMontant ?? 5000;
        const resteC = Math.max(0, objC - creditTotal);
        const declared = entries.filter((e) => e.personId === member.id && e.date.slice(0, 7) === viewMonth);
        // Le montant vendu et le nombre d'assurances vendues viennent
        // directement du journal déclaré (pas d'un chiffre saisi à la
        // main) : ils reflètent en temps réel ce que le collaborateur a
        // déclaré dans "Ma saisie", quel que soit le type d'assurance.
        const montantRealise = declared.reduce((s, e) => s + (e.montant || 0), 0);
        const resteM = Math.max(0, objM - montantRealise);
        const isEditing = editing === member.id;

        // Réalisé par produit, calculé depuis le journal déclaré (jamais
        // saisi à la main) — objectif par produit optionnel, fixé par le
        // responsable dans "Mettre à jour".
        const assuranceRealiseParType = Object.fromEntries(
          ASSURANCE_TYPES.map((at) => [
            at,
            declared.filter((e) => e.type === "assurance" && e.assuranceType === at).reduce((s, e) => s + (e.quantite || 1), 0),
          ])
        );
        const creditRealiseParType = Object.fromEntries(
          CREDIT_TYPES.map((ct) => [
            ct,
            declared.filter((e) => e.type === "credit" && e.creditType === ct).reduce((s, e) => s + (e.montant || 0), 0),
          ])
        );
        const assuranceRealise = ASSURANCE_TYPES.reduce((s, at) => s + (assuranceRealiseParType[at] || 0), 0);
        const resteA = Math.max(0, objA - assuranceRealise);
        const objectifsAssuranceParType = member.objectifsAssuranceParType || {};
        const objectifsCreditParType = member.objectifsCreditParType || {};
        const hasProduitObjectifs =
          ASSURANCE_TYPES.some((at) => objectifsAssuranceParType[at] > 0) ||
          CREDIT_TYPES.some((ct) => objectifsCreditParType[ct] > 0);

        return (
          <div key={member.id} className="rounded-2xl overflow-hidden" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${THEME.line}` }}>
              <div>
                <div className="font-semibold text-sm">{member.name}</div>
                <div className="text-xs" style={{ color: THEME.navySoft }}>{member.email}</div>
              </div>
              {isManager && !isEditing && (
                <button
                  onClick={() => startEdit(member)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={{ background: THEME.bg, color: MANAGER_ACCENT }}
                >
                  Mettre à jour
                </button>
              )}
            </div>

            <div className="p-5 grid sm:grid-cols-3 gap-4">
              <ProgressBlock
                icon={Shield}
                label="Assurances"
                value={assuranceRealise}
                objective={objA}
                reste={resteA}
                color={THEME.teal}
                colorSoft={THEME.tealSoft}
                editing={isEditing}
                onChangeObjective={(v) => setObjDraft((o) => ({ ...o, objectifAssurance: v }))}
                draftObjective={objDraft.objectifAssurance}
                readOnlyValue
                isCurrentMonth={isCurrentMonth}
              />
              <ProgressBlock
                icon={CreditCard}
                label="Crédits (total)"
                value={creditTotal}
                objective={objC}
                reste={resteC}
                color={THEME.amber}
                colorSoft={THEME.amberSoft}
                editing={isEditing}
                onChangeObjective={(v) => setObjDraft((o) => ({ ...o, objectifCredit: v }))}
                draftObjective={objDraft.objectifCredit}
                readOnlyValue
                isCurrentMonth={isCurrentMonth}
              />
              <ProgressBlock
                icon={Euro}
                label="Montant vendu"
                value={montantRealise}
                objective={objM}
                reste={resteM}
                color={THEME.navy}
                colorSoft={THEME.line}
                editing={isEditing}
                onChangeObjective={(v) => setObjDraft((o) => ({ ...o, objectifMontant: v }))}
                draftObjective={objDraft.objectifMontant}
                readOnlyValue
                format={formatEUR}
                isCurrentMonth={isCurrentMonth}
              />
            </div>

            <div className="px-5 pb-5">
              <PerformanceChart entries={entries} member={member} />
            </div>

            {isEditing && (
              <div className="px-5 pb-5">
                <div className="text-xs font-medium mb-2" style={{ color: THEME.navySoft }}>
                  Détail des crédits financés par type
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {CREDIT_TYPES.map((ct) => (
                    <label key={ct} className="block">
                      <span className="block text-xs mb-1 font-semibold" style={{ color: THEME.navySoft }}>{ct}</span>
                      <input
                        type="number"
                        min="0"
                        value={draft[ct] || 0}
                        onChange={(e) => setDraft((d) => ({ ...d, [ct]: Number(e.target.value) || 0 }))}
                        className="w-full px-2 py-2 rounded-lg text-sm text-center"
                        style={{ border: `1px solid ${THEME.line}` }}
                      />
                    </label>
                  ))}
                </div>

                <div className="text-xs font-medium mb-2" style={{ color: THEME.navySoft }}>
                  Objectifs par produit (optionnel)
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {ASSURANCE_TYPES.map((at) => (
                    <label key={at} className="block">
                      <span className="block text-xs mb-1 font-semibold" style={{ color: THEME.navySoft }}>{at} (nb)</span>
                      <input
                        type="number"
                        min="0"
                        value={objByTypeDraft.assurance[at] || 0}
                        onChange={(e) =>
                          setObjByTypeDraft((o) => ({ ...o, assurance: { ...o.assurance, [at]: Number(e.target.value) || 0 } }))
                        }
                        className="w-full px-2 py-2 rounded-lg text-sm text-center"
                        style={{ border: `1px solid ${THEME.line}` }}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {CREDIT_TYPES.map((ct) => (
                    <label key={ct} className="block">
                      <span className="block text-xs mb-1 font-semibold" style={{ color: THEME.navySoft }}>{ct} (€)</span>
                      <input
                        type="number"
                        min="0"
                        value={objByTypeDraft.credit[ct] || 0}
                        onChange={(e) =>
                          setObjByTypeDraft((o) => ({ ...o, credit: { ...o.credit, [ct]: Number(e.target.value) || 0 } }))
                        }
                        className="w-full px-2 py-2 rounded-lg text-sm text-center"
                        style={{ border: `1px solid ${THEME.line}` }}
                      />
                    </label>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(member)}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
                    style={{ background: MANAGER_ACCENT }}
                  >
                    Enregistrer les chiffres
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium"
                    style={{ background: THEME.bg, color: THEME.navySoft }}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            {hasProduitObjectifs && (
              <div className="px-5 pb-5">
                <details>
                  <summary className="text-xs cursor-pointer font-medium" style={{ color: isManager ? MANAGER_ACCENT : THEME.teal }}>
                    Détail des objectifs par produit
                  </summary>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {ASSURANCE_TYPES.map((at) => {
                      const obj = objectifsAssuranceParType[at] || 0;
                      if (!obj) return null;
                      const real = assuranceRealiseParType[at] || 0;
                      const atteint = real >= obj;
                      return (
                        <div key={`a-${at}`} className="text-xs px-2 py-2 rounded-lg" style={{ background: THEME.bg }}>
                          <div className="font-semibold flex items-center gap-1">
                            {at} {atteint && <CheckCircle2 size={11} style={{ color: THEME.teal }} />}
                          </div>
                          <div style={{ color: THEME.navySoft }}>{real} / {obj}</div>
                        </div>
                      );
                    })}
                    {CREDIT_TYPES.map((ct) => {
                      const obj = objectifsCreditParType[ct] || 0;
                      if (!obj) return null;
                      const real = creditRealiseParType[ct] || 0;
                      const atteint = real >= obj;
                      return (
                        <div key={`c-${ct}`} className="text-xs px-2 py-2 rounded-lg" style={{ background: THEME.bg }}>
                          <div className="font-semibold flex items-center gap-1">
                            {ct} {atteint && <CheckCircle2 size={11} style={{ color: THEME.amber }} />}
                          </div>
                          <div style={{ color: THEME.navySoft }}>{formatEUR(real)} / {formatEUR(obj)}</div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}

            {declared.length > 0 && (
              <div className="px-5 pb-5">
                <details>
                  <summary className="text-xs cursor-pointer font-medium" style={{ color: THEME.teal }}>
                    {declared.length} dossier(s) déclaré(s) ce mois — journal
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {declared.map((e) => (
                      <div key={e.id} className="text-xs flex justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: THEME.bg }}>
                        <span>{e.type === "assurance" ? `Assurance ${e.assuranceType}` : creditLabel(e)} — {e.dossier}</span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-medium" style={{ color: THEME.navy }}>
                            {e.type === "assurance" ? `× ${e.quantite || 1}` : formatEUR(e.montant)}
                          </span>
                          <span style={{ color: THEME.navySoft }}>{new Date(e.date).toLocaleDateString("fr-FR")}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProgressBlock({ icon: Icon, label, value, objective, reste, color, colorSoft, editing, onChangeValue, onChangeObjective, draftValue, draftObjective, readOnlyValue, format = (v) => v, isCurrentMonth = true }) {
  const pct = objective > 0 ? Math.min(100, Math.round((value / objective) * 100)) : 0;
  // Sans objectif fixé (0), "reste" tombe toujours à 0 : ne pas afficher un
  // "Objectif atteint" trompeur quand il n'y a en réalité aucun objectif.
  const atteint = objective > 0 && reste === 0;
  return (
    <div className="rounded-xl p-4" style={{ background: THEME.bg }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: THEME.navySoft }}>
          <Icon size={14} style={{ color }} /> {label}
        </div>
        {atteint && <CheckCircle2 size={15} style={{ color }} />}
      </div>

      {editing ? (
        <div className="flex items-center gap-2 mb-2">
          {!readOnlyValue && (
            <input
              type="number"
              min="0"
              value={draftValue ?? value}
              onChange={(e) => onChangeValue(Number(e.target.value) || 0)}
              className="w-16 px-2 py-1.5 rounded-lg text-sm text-center"
              style={{ border: `1px solid ${THEME.line}` }}
            />
          )}
          {readOnlyValue && <span style={{ fontFamily: FONT_DISPLAY }} className="text-xl font-semibold">{format(value)}</span>}
          <span className="text-xs" style={{ color: THEME.navySoft }}>/ objectif</span>
          <input
            type="number"
            min="0"
            value={draftObjective}
            onChange={(e) => onChangeObjective(Number(e.target.value) || 0)}
            className="w-20 px-2 py-1.5 rounded-lg text-sm text-center"
            style={{ border: `1px solid ${THEME.line}` }}
          />
        </div>
      ) : (
        <div className="flex items-baseline gap-1 mb-2 flex-wrap">
          <span style={{ fontFamily: FONT_DISPLAY, color: THEME.navy }} className="text-2xl font-semibold">{format(value)}</span>
          <span className="text-sm" style={{ color: THEME.navySoft }}>/ {format(objective)}</span>
        </div>
      )}

      <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: colorSoft }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-xs font-medium" style={{ color: atteint ? color : THEME.navySoft }}>
        {atteint
          ? "Objectif atteint"
          : objective > 0
          ? isCurrentMonth
            ? `Reste ${format(reste)} avant la fin du mois`
            : `Manquant : ${format(reste)}`
          : "Aucun objectif fixé"}
      </div>
    </div>
  );
}

// Graphique linéaire de performance (dossiers vendus) d'un collaborateur —
// bascule Jour/Semaine/Mois/Année, survol avec repère + infobulle, et un
// détail sous forme de tableau (accessible sans passer par la souris).
function PerformanceChart({ entries, member, color = THEME.teal }) {
  const [granularity, setGranularity] = useState("mois");
  const [hoverIdx, setHoverIdx] = useState(null);

  const series = useMemo(
    () => performanceSeries(entries, member.id, granularity),
    [entries, member.id, granularity]
  );

  const W = 600;
  const H = 168;
  const padL = 22;
  const padR = 22;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = series.length;
  const maxVal = Math.max(1, ...series.map((b) => b.value));

  const points = series.map((b, i) => ({
    x: n > 1 ? padL + (i * plotW) / (n - 1) : padL + plotW / 2,
    y: padT + plotH - (b.value / maxVal) * plotH,
    ...b,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[n - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L ${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const total = series.reduce((s, b) => s + b.value, 0);
  const last = points[n - 1];
  const active = hoverIdx !== null ? points[hoverIdx] : null;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(frac * (n - 1)));
  };

  // Un point sur deux (ou moins) reçoit une étiquette d'axe pour éviter le
  // chevauchement quand il y a beaucoup de périodes (ex. 14 jours).
  const labelEvery = n > 8 ? 2 : 1;

  return (
    <div className="rounded-xl p-4" style={{ background: THEME.bg }}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: THEME.navySoft }}>
          <BarChart3 size={14} style={{ color }} /> Performance — dossiers vendus
        </div>
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: THEME.card }}>
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setGranularity(p.key);
                setHoverIdx(null);
              }}
              className="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
              style={{
                background: granularity === p.key ? THEME.navy : "transparent",
                color: granularity === p.key ? "#fff" : THEME.navySoft,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "auto" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label={`Évolution du nombre de dossiers vendus par ${member.name}, par ${granularity}`}
        >
          <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={THEME.line} strokeWidth="1" />
          <path d={areaPath} fill={color} opacity="0.1" stroke="none" />
          <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {active && (
            <line x1={active.x} y1={padT} x2={active.x} y2={padT + plotH} stroke={THEME.navySoft} strokeWidth="1" opacity="0.35" />
          )}
          <circle cx={last.x} cy={last.y} r="5" fill={color} stroke={THEME.bg} strokeWidth="2" />
          {active && active !== last && (
            <circle cx={active.x} cy={active.y} r="5" fill={color} stroke={THEME.bg} strokeWidth="2" />
          )}

          {points.map((p, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text
                key={p.startISO}
                x={p.x}
                y={H - 6}
                fontSize="9"
                textAnchor="middle"
                fill={THEME.navySoft}
              >
                {p.label}
              </text>
            ) : null
          )}
        </svg>

        {active && (
          <div
            className="absolute top-0 px-2.5 py-1.5 rounded-lg text-xs shadow-md pointer-events-none"
            style={{
              left: `${Math.min(92, Math.max(8, (active.x / W) * 100))}%`,
              transform: "translateX(-50%)",
              background: THEME.navy,
              color: "#fff",
              whiteSpace: "nowrap",
            }}
          >
            <div className="font-semibold" style={{ fontFamily: FONT_DISPLAY }}>{active.value}</div>
            <div style={{ color: "rgba(255,255,255,0.7)" }}>{active.fullLabel}</div>
          </div>
        )}
      </div>

      <div className="text-xs mt-1" style={{ color: THEME.navySoft }}>
        Total sur la période : <strong style={{ color: THEME.navy }}>{total}</strong>
      </div>
      <PerformanceTable series={series} />
    </div>
  );
}

// Version tabulaire des mêmes données, repliée par défaut — équivalent
// accessible du graphique (lecteur d'écran, sans survol nécessaire).
function PerformanceTable({ series }) {
  return (
    <details className="mt-1">
      <summary className="text-xs cursor-pointer font-medium" style={{ color: THEME.navySoft }}>
        Détail chiffré par période
      </summary>
      <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-1.5">
        {series.map((b) => (
          <div key={b.startISO} className="text-xs px-2 py-1.5 rounded-lg text-center" style={{ background: THEME.card }}>
            <div className="font-semibold" style={{ color: THEME.navy }}>{b.value}</div>
            <div style={{ color: THEME.navySoft }}>{b.label}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

/* ---------------- EQUIPE TAB (manager only) ---------------- */
function EquipeTab({ members, setMembers, recordDeletion, session, notify, invites, setInvites }) {
  const collaborators = members.filter((m) => m.role === "collaborateur");
  const managers = members.filter((m) => m.role === "responsable");
  const pendingInvites = invites.filter((i) => !i.used);

  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const removeMember = async (id) => {
    const member = members.find((m) => m.id === id);
    const ok = await setMembers(members.filter((m) => m.id !== id));
    if (ok) {
      if (member) await recordDeletion("member", member, session);
      notify("Membre retiré.");
    }
  };

  const createInvite = async (e) => {
    e.preventDefault();
    setInviteError("");
    const em = inviteEmail.trim().toLowerCase();
    if (!em || !inviteName.trim()) return setInviteError("Renseignez le nom et l'e-mail du collaborateur à inviter.");
    if (members.find((m) => m.email.toLowerCase() === em)) return setInviteError("Un compte existe déjà avec cet e-mail.");
    if (pendingInvites.find((i) => i.email.toLowerCase() === em)) return setInviteError("Une invitation est déjà en attente pour cet e-mail.");
    const invite = {
      id: uid(),
      token: inviteToken(),
      name: inviteName.trim(),
      email: em,
      createdAt: new Date().toISOString(),
      createdBy: { id: session.id, name: session.name },
      used: false,
      usedAt: null,
    };
    const ok = await setInvites([invite, ...invites]);
    if (ok) {
      setInviteName("");
      setInviteEmail("");
      notify("Invitation créée. Copiez le lien et envoyez-le au collaborateur.");
    }
  };

  const revokeInvite = async (id) => {
    const ok = await setInvites(invites.filter((i) => i.id !== id));
    if (ok) notify("Invitation révoquée.");
  };

  const linkFor = (token) => `${window.location.origin}${window.location.pathname}?invite=${token}`;

  const copyLink = async (invite) => {
    const link = linkFor(invite.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((c) => (c === invite.id ? null : c)), 2000);
      notify("Lien copié dans le presse-papier.");
    } catch {
      notify(`Copie automatique impossible — lien : ${link}`, true);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Link2 size={15} style={{ color: MANAGER_ACCENT }} /> Inviter un collaborateur
        </h2>
        <p className="text-xs mb-3" style={{ color: THEME.navySoft }}>
          Générez un lien unique et envoyez-le vous-même (e-mail, WhatsApp, SMS…) à la personne concernée. Elle l'utilise pour activer son compte — aucun service tiers n'est impliqué.
        </p>
        <form onSubmit={createInvite} className="flex flex-wrap gap-2 items-end mb-2">
          <div className="flex-1 min-w-[10rem]">
            <label className="block text-xs font-medium mb-1" style={{ color: THEME.navySoft }}>
              Nom complet
            </label>
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Prénom Nom"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
            />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-xs font-medium mb-1" style={{ color: THEME.navySoft }}>
              E-mail
            </label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="prenom.nom@monentreprise.be"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5"
            style={{ background: MANAGER_ACCENT }}
          >
            <Plus size={15} /> Générer le lien
          </button>
        </form>
        {inviteError && (
          <div className="text-sm flex items-center gap-1.5 mb-2" style={{ color: THEME.red }}>
            <AlertCircle size={14} /> {inviteError}
          </div>
        )}
        {pendingInvites.length > 0 && (
          <div className="space-y-2 mt-3">
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm gap-2"
                style={{ background: THEME.bg }}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{inv.name}</div>
                  <div className="text-xs truncate" style={{ color: THEME.navySoft }}>
                    {inv.email}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => copyLink(inv)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                    style={{
                      background: copiedId === inv.id ? THEME.tealSoft : MANAGER_ACCENT_SOFT,
                      color: copiedId === inv.id ? THEME.teal : MANAGER_ACCENT,
                    }}
                  >
                    <Copy size={12} /> {copiedId === inv.id ? "Copié !" : "Copier le lien"}
                  </button>
                  <ConfirmActionButton onConfirm={() => revokeInvite(inv.id)} label="Révoquer" iconOnly={false} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Users size={15} style={{ color: MANAGER_ACCENT }} /> Collaborateurs ({collaborators.length})
        </h2>
        {collaborators.length === 0 ? (
          <p className="text-sm py-4" style={{ color: THEME.navySoft }}>
            Aucun collaborateur n'a encore créé de compte. Ils apparaîtront ici dès leur première connexion.
          </p>
        ) : (
          <div className="space-y-2">
            {collaborators.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm" style={{ background: THEME.bg }}>
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs" style={{ color: THEME.navySoft }}>{m.email}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: THEME.navySoft }}>
                    Obj. {m.objectifAssurance ?? 5} assur. / {m.objectifCredit ?? 5} créd. / {formatEUR(m.objectifMontant ?? 5000)}
                  </span>
                  <ConfirmActionButton onConfirm={() => removeMember(m.id)} label="Retirer" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Lock size={15} style={{ color: THEME.navy }} /> Responsables ({managers.length})
        </h2>
        <div className="space-y-2">
          {managers.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm" style={{ background: THEME.bg }}>
              <div>
                <div className="font-medium">{m.name}</div>
                <div className="text-xs" style={{ color: THEME.navySoft }}>{m.email}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs flex items-center gap-1.5" style={{ color: THEME.navySoft }}>
        <Settings size={12} /> Les objectifs individuels se règlent depuis l'onglet "Suivi & objectifs", en cliquant sur "Mettre à jour".
      </p>
    </div>
  );
}

/* ---------------- HISTORIQUE TAB (manager only) ---------------- */
function HistoriqueTab({ deletionHistory, restoreDeletion }) {
  const sorted = [...deletionHistory].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));

  const describe = (item) => {
    const { kind, data } = item;
    if (kind === "entry") {
      const label =
        data.type === "assurance"
          ? `Assurance ${data.assuranceType}${data.quantite ? ` (× ${data.quantite})` : ""}`
          : `${creditLabel(data)} — ${formatEUR(data.montant)}`;
      return `${label} — ${data.dossier} (${data.personName})`;
    }
    if (kind === "member") {
      return `${data.role === "responsable" ? "Responsable" : "Collaborateur"} — ${data.name} (${data.email})`;
    }
    return "Élément supprimé";
  };

  const iconFor = (item) => {
    if (item.kind === "member") return Users;
    return item.data.type === "assurance" ? Shield : CreditCard;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: THEME.navy, color: "#fff" }}>
        <History size={18} style={{ color: MANAGER_ACCENT }} />
        <div className="text-sm">
          <span className="font-semibold">{deletionHistory.length}</span> suppression{deletionHistory.length !== 1 ? "s" : ""} enregistrée{deletionHistory.length !== 1 ? "s" : ""} au total
        </div>
      </div>

      <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
        <h2 className="text-sm font-semibold mb-3">Éléments supprimés</h2>
        {sorted.length === 0 ? (
          <p className="text-sm py-10 text-center" style={{ color: THEME.navySoft }}>
            Aucune suppression enregistrée pour l'instant.
          </p>
        ) : (
          <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
            {sorted.map((item) => {
              const Icon = iconFor(item);
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-sm"
                  style={{ background: THEME.bg }}
                >
                  <Icon size={15} style={{ color: THEME.red, flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{describe(item)}</div>
                    <div className="text-xs" style={{ color: THEME.navySoft }}>
                      Supprimé par {item.deletedBy?.name || "?"} le {new Date(item.deletedAt).toLocaleString("fr-FR")}
                    </div>
                    {item.restored && (
                      <div className="text-xs font-medium mt-1" style={{ color: MANAGER_ACCENT }}>
                        Restauré le {new Date(item.restoredAt).toLocaleString("fr-FR")}
                      </div>
                    )}
                  </div>
                  {!item.restored && (
                    <ConfirmActionButton
                      onConfirm={() => restoreDeletion(item)}
                      label="Restaurer"
                      confirmLabel="Confirmer"
                      icon={RotateCcw}
                      color={MANAGER_ACCENT}
                      iconOnly={false}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
