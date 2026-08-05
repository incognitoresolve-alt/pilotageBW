import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Shield, CreditCard, Users, LogOut, Plus, Trash2, CheckCircle2,
  Calendar, Settings, ChevronRight, Lock, TrendingUp, ClipboardList,
  AlertCircle, Award, X, Download, Euro, History
} from "lucide-react";
import * as XLSX from "xlsx";

const CREDIT_TYPES = ["PAT", "OCA", "BPR", "MP7", "AUG", "DIM"];
const ASSURANCE_TYPES = ["ALLIN", "DIMC", "DIM"];
// Pour les crédits PAT et BPR uniquement : précise si le contrat est signé
// en papier ou via eDirect.
const CONTRACT_MODES = ["Papier", "eDirect"];
const CONTRACT_MODE_CREDIT_TYPES = ["PAT", "BPR"];
const MANAGER_CODE = "RESPONSABLE2026";

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysLeftInMonth = () => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(0, end.getDate() - now.getDate());
};
const monthLabel = () =>
  new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const formatEUR = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);

const creditLabel = (e) => `Crédit ${e.creditType}${e.contractMode ? ` (${e.contractMode})` : ""}`;

const emptyFigures = () => ({ assurance: 0, PAT: 0, OCA: 0, BPR: 0, MP7: 0, AUG: 0, DIM: 0 });

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
  const [session, setSession] = useState(null); // {id, name, email, role}
  const [tab, setTab] = useState("saisie");
  const [toast, setToast] = useState(null);

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
      const [m, e, f, h, lastSession] = await Promise.all([
        loadShared("members", [], onError),
        loadShared("entries", [], onError),
        loadShared("figures", {}, onError),
        loadShared("deletionHistory", [], onError),
        loadLocal("last-session", null),
      ]);
      setMembers(m);
      setEntries(e);
      setFigures(f);
      setDeletionHistory(h);
      if (lastSession && m.find((x) => x.id === lastSession.id)) {
        setSession(lastSession);
      }
      setReady(true);
      if (loadError) {
        notify(`Chargement des données impossible (${loadError.message}) — les chiffres affichés peuvent être incomplets.`, true);
      }
    })();
  }, []);

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
      return true;
    } catch (e) {
      console.error("storage set failed", "members", e);
      setMembers(previous);
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistEntries = async (next) => {
    const previous = entries;
    setEntries(next);
    try {
      await saveShared("entries", next);
      return true;
    } catch (e) {
      console.error("storage set failed", "entries", e);
      setEntries(previous);
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistFigures = async (next) => {
    const previous = figures;
    setFigures(next);
    try {
      await saveShared("figures", next);
      return true;
    } catch (e) {
      console.error("storage set failed", "figures", e);
      setFigures(previous);
      notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      return false;
    }
  };
  const persistDeletionHistory = async (next) => {
    const previous = deletionHistory;
    setDeletionHistory(next);
    try {
      await saveShared("deletionHistory", next);
      return true;
    } catch (e) {
      console.error("storage set failed", "deletionHistory", e);
      setDeletionHistory(previous);
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
      <div style={{ background: THEME.bg }} className="min-h-screen flex items-center justify-center">
        <div className="text-sm tracking-wide" style={{ color: THEME.navy, fontFamily: FONT_BODY }}>
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
      `}</style>

      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
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

      {!session ? (
        <LoginScreen members={members} onCreateMember={persistMembers} onLogin={login} notify={notify} />
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
          tab={tab}
          setTab={setTab}
          mKey={mKey}
          notify={notify}
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
const MANAGER_ACCENT = "#6B4FA0";
const MANAGER_ACCENT_SOFT = "#EAE3F5";
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
    const newMember = {
      id: uid(),
      name: name.trim(),
      email: em,
      role: "collaborateur",
      objectifAssurance: 5,
      objectifCredit: 5,
      objectifMontant: 5000,
      createdAt: new Date().toISOString(),
    };
    const ok = await onCreateMember([...members, newMember]);
    onLogin(newMember);
    if (ok) notify("Bienvenue ! Compte créé.");
  };

  const submitManager = async (e) => {
    e.preventDefault();
    setError("");
    const em = email.trim().toLowerCase();
    if (!em || !name.trim()) return setError("Renseignez votre nom et votre e-mail professionnel.");
    if (code !== MANAGER_CODE) return setError("Code d'accès responsable incorrect.");
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
          Connexion par identification e-mail. Le code responsable protège la mise à jour des chiffres officiels.
        </p>
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
function MainApp({ session, onLogout, members, setMembers, entries, setEntries, figures, setFigures, deletionHistory, recordDeletion, tab, setTab, mKey, notify }) {
  const isManager = session.role === "responsable";
  const accent = isManager ? MANAGER_ACCENT : THEME.teal;
  const accentSoft = isManager ? MANAGER_ACCENT_SOFT : THEME.tealSoft;

  return (
    <div>
      <header
        className="sticky top-0 z-20 px-5 py-4 flex items-center justify-between"
        style={{ background: THEME.card, borderBottom: `3px solid ${accent}` }}
      >
        <div>
          <div style={{ fontFamily: FONT_DISPLAY }} className="text-base font-semibold" >
            Suivi Commercial
          </div>
          <div className="text-xs capitalize" style={{ color: THEME.navySoft }}>{monthLabel()}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium">{session.name}</div>
            <div
              className="text-xs font-medium inline-block px-2 py-0.5 rounded-full"
              style={{ color: accent, background: accentSoft }}
            >
              {isManager ? "Responsable" : "Collaborateur"}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="p-2 rounded-lg transition-colors"
            style={{ background: THEME.bg }}
            aria-label="Se déconnecter"
          >
            <LogOut size={16} style={{ color: THEME.navySoft }} />
          </button>
        </div>
      </header>

      <nav className="flex gap-1 px-5 pt-4 max-w-5xl mx-auto">
        <TabButton active={tab === "saisie"} onClick={() => setTab("saisie")} icon={ClipboardList} accent={accent}>
          Ma saisie
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

      <main className="max-w-5xl mx-auto px-5 pb-16 pt-5">
        {tab === "saisie" && (
          <SaisieTab
            session={session}
            entries={entries}
            setEntries={setEntries}
            recordDeletion={recordDeletion}
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
          <EquipeTab members={members} setMembers={setMembers} recordDeletion={recordDeletion} session={session} notify={notify} />
        )}
        {tab === "historique" && isManager && (
          <HistoriqueTab deletionHistory={deletionHistory} />
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
function SaisieTab({ session, entries, setEntries, recordDeletion, mKey, notify }) {
  const [type, setType] = useState("assurance");
  const [creditType, setCreditType] = useState("PAT");
  const [contractMode, setContractMode] = useState("Papier");
  const [assuranceType, setAssuranceType] = useState("ALLIN");
  const [quantite, setQuantite] = useState("1");
  const [dossier, setDossier] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState(todayISO());

  const needsContractMode = type === "credit" && CONTRACT_MODE_CREDIT_TYPES.includes(creditType);

  const myEntries = useMemo(
    () =>
      entries
        .filter((e) => e.personId === session.id && e.date.slice(0, 7) === mKey)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries, session.id, mKey]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!dossier.trim()) return notify("Indiquez le numéro de dossier.");
    const entry = {
      id: uid(),
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
      createdAt: new Date().toISOString(),
    };
    const ok = await setEntries([entry, ...entries]);
    if (ok) {
      setDossier("");
      setMontant("");
      setQuantite("1");
      notify(
        type === "assurance"
          ? `Assurance ${assuranceType} enregistrée.`
          : `Crédit ${creditType}${needsContractMode ? ` (${contractMode})` : ""} enregistré.`
      );
    }
  };

  const remove = async (id) => {
    const entry = entries.find((e) => e.id === id);
    await setEntries(entries.filter((e) => e.id !== id));
    if (entry) await recordDeletion("entry", entry, session);
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
          <Plus size={15} style={{ color: THEME.teal }} /> Nouvelle vente
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

          <button
            type="submit"
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: THEME.teal }}
          >
            Enregistrer
          </button>
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
          <h2 className="text-sm font-semibold mb-3">Mes dossiers déclarés — {monthLabel()}</h2>
          {myEntries.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: THEME.navySoft }}>
              Aucune vente déclarée ce mois-ci.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {myEntries.map((e) => (
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
                      <div className="text-xs" style={{ color: THEME.navySoft }}>
                        {new Date(e.date).toLocaleDateString("fr-FR")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-medium" style={{ color: THEME.navy }}>
                      {e.type === "assurance" ? `× ${e.quantite || 1}` : formatEUR(e.montant)}
                    </span>
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
  const monthFigures = figures[mKey] || {};
  const daysLeft = daysLeftInMonth();

  const [editing, setEditing] = useState(null); // memberId being edited by manager
  const [draft, setDraft] = useState(emptyFigures());
  const [objDraft, setObjDraft] = useState({ objectifAssurance: 0, objectifCredit: 0, objectifMontant: 0 });
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
  };

  const saveEdit = async (member) => {
    const next = { ...figures, [mKey]: { ...monthFigures, [member.id]: draft } };
    const okFigures = await setFigures(next);
    const okMembers = await setMembers(
      members.map((m) =>
        m.id === member.id
          ? {
              ...m,
              objectifAssurance: Number(objDraft.objectifAssurance) || 0,
              objectifCredit: Number(objDraft.objectifCredit) || 0,
              objectifMontant: Number(objDraft.objectifMontant) || 0,
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
        (e) => e.personId === m.id && e.date.slice(0, 7) === mKey
      );
      const montantTotal = declared.reduce((s, e) => s + (e.montant || 0), 0);
      return {
        "Collaborateur": m.name,
        "E-mail": m.email,
        "Assurances": f.assurance || 0,
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
    XLSX.writeFile(wb, `suivi-commercial-${mKey}.xlsx`);
    notify("Export Excel généré.");
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: THEME.navy, color: "#fff" }}>
        <div className="flex items-center gap-3">
          <Calendar size={18} style={{ color: THEME.teal }} />
          <div className="text-sm">
            <span className="font-semibold">{daysLeft}</span> jour{daysLeft > 1 ? "s" : ""} restant{daysLeft > 1 ? "s" : ""} avant la fin du mois
            {" — "}
            <span className="capitalize">{monthLabel()}</span>
          </div>
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
        const resteA = Math.max(0, objA - (f.assurance || 0));
        const resteC = Math.max(0, objC - creditTotal);
        const declared = entries.filter((e) => e.personId === member.id && e.date.slice(0, 7) === mKey);
        // Le montant vendu vient directement du journal déclaré (pas des
        // chiffres officiels saisis à la main) : il reflète en temps réel
        // ce que le collaborateur a déclaré.
        const montantRealise = declared.reduce((s, e) => s + (e.montant || 0), 0);
        const resteM = Math.max(0, objM - montantRealise);
        const isEditing = editing === member.id;

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
                value={f.assurance || 0}
                objective={objA}
                reste={resteA}
                color={THEME.teal}
                colorSoft={THEME.tealSoft}
                editing={isEditing}
                onChangeValue={(v) => setDraft((d) => ({ ...d, assurance: v }))}
                onChangeObjective={(v) => setObjDraft((o) => ({ ...o, objectifAssurance: v }))}
                draftValue={draft.assurance}
                draftObjective={objDraft.objectifAssurance}
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
              />
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

function ProgressBlock({ icon: Icon, label, value, objective, reste, color, colorSoft, editing, onChangeValue, onChangeObjective, draftValue, draftObjective, readOnlyValue, format = (v) => v }) {
  const pct = objective > 0 ? Math.min(100, Math.round((value / objective) * 100)) : 0;
  const atteint = reste === 0;
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
        {atteint ? "Objectif atteint" : `Reste ${format(reste)} avant la fin du mois`}
      </div>
    </div>
  );
}

/* ---------------- EQUIPE TAB (manager only) ---------------- */
function EquipeTab({ members, setMembers, recordDeletion, session, notify }) {
  const collaborators = members.filter((m) => m.role === "collaborateur");
  const managers = members.filter((m) => m.role === "responsable");

  const removeMember = async (id) => {
    const member = members.find((m) => m.id === id);
    const ok = await setMembers(members.filter((m) => m.id !== id));
    if (ok) {
      if (member) await recordDeletion("member", member, session);
      notify("Membre retiré.");
    }
  };

  return (
    <div className="space-y-5">
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
function HistoriqueTab({ deletionHistory }) {
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
