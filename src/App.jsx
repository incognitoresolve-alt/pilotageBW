import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Shield, CreditCard, Users, LogOut, Plus, Trash2, CheckCircle2,
  Calendar, Settings, ChevronRight, ChevronLeft, Lock, TrendingUp, ClipboardList,
  AlertCircle, Award, X, Download, Euro, History, RotateCcw, Pencil, Link2, Copy,
  RefreshCw, Loader2, BarChart3, Trophy, KeyRound, Eye, EyeOff
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  verifyManagerCode, loginMember, setMemberPassword, resetMemberPassword,
  hasSiteToken, unlockSite, clearSiteToken, isSessionError,
} from "./lib/storage";

const PASSWORD_MIN_LEN = 6;

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
// Saisie quotidienne du responsable : pour chaque type de crédit, le nombre
// de dossiers financés et le montant total financé ce jour-là. Pour PAT et
// BPR, la saisie se scinde en Papier / eDirect (comme dans "Ma saisie").
const emptyCreditTypeEntry = () => ({ nombre: 0, montant: 0 });
const emptyCreditDraft = () =>
  Object.fromEntries(
    CREDIT_TYPES.map((t) => [
      t,
      CONTRACT_MODE_CREDIT_TYPES.includes(t)
        ? Object.fromEntries(CONTRACT_MODES.map((m) => [m, emptyCreditTypeEntry()]))
        : emptyCreditTypeEntry(),
    ])
  );

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
// quantité déclarée) — personId=null agrège tous les collaborateurs (vue
// département).
function performanceSeries(entries, personId, granularity) {
  const buckets = buildPeriodBuckets(granularity);
  const scoped = personId ? entries.filter((e) => e.personId === personId) : entries;
  return buckets.map((b) => ({
    ...b,
    value: scoped.reduce((s, e) => {
      if (e.type !== "assurance") return s;
      if (e.date < b.startISO || e.date > b.endISO) return s;
      return s + (e.quantite || 1);
    }, 0),
  }));
}
// Même principe que performanceSeries, mais pour les crédits financés
// (montant en €, depuis creditRecords — le chiffre officiel validé par le
// responsable, pas les entrées auto-déclarées) — personId=null agrège
// toute l'équipe (memberId sur un creditRecord, pas personId).
function creditPerformanceSeries(creditRecords, personId, granularity) {
  const buckets = buildPeriodBuckets(granularity);
  const scoped = personId ? creditRecords.filter((r) => r.memberId === personId) : creditRecords;
  return buckets.map((b) => ({
    ...b,
    value: scoped.reduce((s, r) => {
      if (r.date < b.startISO || r.date > b.endISO) return s;
      return s + (r.montant || 0);
    }, 0),
  }));
}

// Crédits réalisés par type pour un collaborateur sur un mois donné :
// somme des saisies quotidiennes du responsable (creditRecords) sur ce
// mois, plus l'éventuel chiffre "historique" saisi avant l'introduction
// de la saisie au jour le jour (figures[mois][membre][type]) — jamais
// perdu, jamais réécrit, simplement additionné une fois pour toutes.
function creditRealiseParTypeFor(legacyFigures, creditRecords, memberId, monthKey) {
  const monthRecords = creditRecords.filter((r) => r.memberId === memberId && r.date.slice(0, 7) === monthKey);
  return Object.fromEntries(
    CREDIT_TYPES.map((ct) => [
      ct,
      (legacyFigures[ct] || 0) + monthRecords.filter((r) => r.creditType === ct).reduce((s, r) => s + (r.montant || 0), 0),
    ])
  );
}
function creditCountParTypeFor(creditRecords, memberId, monthKey) {
  const monthRecords = creditRecords.filter((r) => r.memberId === memberId && r.date.slice(0, 7) === monthKey);
  return Object.fromEntries(
    CREDIT_TYPES.map((ct) => [ct, monthRecords.filter((r) => r.creditType === ct).reduce((s, r) => s + (r.nombre || 0), 0)])
  );
}

// Objectif applicable à un membre pour un mois donné : les objectifs d'un
// collaborateur (globaux + par produit) sont désormais historisés par mois
// (member.objectifsHistory[monthKey]) à chaque sauvegarde depuis "Suivi &
// objectifs" — sans ça, consulter un mois archivé appliquait l'objectif
// ACTUEL plutôt que celui réellement fixé à l'époque, faussant
// rétroactivement le jugement porté sur les mois passés ("reste", statut
// "à jour"/"en retard", "Objectif atteint" par produit). Résolution : le
// snapshot le plus récent dont la clé est <= viewMonth (comparaison de
// chaînes "AAAA-MM", triable lexicalement) ; à défaut (mois antérieur au
// tout premier snapshot jamais enregistré, ou fonctionnalité pas encore
// utilisée pour ce membre), repli sur les champs "courants" du membre —
// jamais rien perdu, comportement identique à avant pour les mois déjà
// hors de portée de l'historique.
function resolveObjectivesForMonth(member, viewMonth) {
  const hist = member.objectifsHistory || {};
  const keys = Object.keys(hist).filter((k) => k <= viewMonth).sort();
  const snap = keys.length ? hist[keys[keys.length - 1]] : null;
  return {
    objA: snap ? snap.objectifAssurance ?? 5 : member.objectifAssurance ?? 5,
    objC: snap ? snap.objectifCredit ?? 5 : member.objectifCredit ?? 5,
    objM: snap ? snap.objectifMontant ?? 5000 : member.objectifMontant ?? 5000,
    objectifsAssuranceParType: (snap ? snap.objectifsAssuranceParType : member.objectifsAssuranceParType) || {},
    objectifsCreditParType: (snap ? snap.objectifsCreditParType : member.objectifsCreditParType) || {},
  };
}

// Calcule tous les chiffres du mois pour un collaborateur (réalisé et
// objectifs, tous produits confondus) — factorisé pour être utilisé à la
// fois par la vue d'ensemble compacte (statut de rythme) et par la carte
// détaillée d'un collaborateur, sans dupliquer la logique.
function computeMemberMetrics(member, entries, monthFigures, creditRecords, viewMonth) {
  const f = monthFigures[member.id] || emptyFigures();
  const { objA, objC, objM, objectifsAssuranceParType, objectifsCreditParType } = resolveObjectivesForMonth(member, viewMonth);
  const declared = entries.filter((e) => e.personId === member.id && e.date.slice(0, 7) === viewMonth);
  const todayForMember = entries.filter((e) => e.personId === member.id && e.date === todayISO());
  const assuranceRealiseParType = Object.fromEntries(
    ASSURANCE_TYPES.map((at) => [
      at,
      declared.filter((e) => e.type === "assurance" && e.assuranceType === at).reduce((s, e) => s + (e.quantite || 1), 0),
    ])
  );
  const creditRealiseParType = creditRealiseParTypeFor(f, creditRecords, member.id, viewMonth);
  const creditCountParType = creditCountParTypeFor(creditRecords, member.id, viewMonth);
  const creditTotal = CREDIT_TYPES.reduce((s, ct) => s + (creditRealiseParType[ct] || 0), 0);
  const creditCountTotal = CREDIT_TYPES.reduce((s, ct) => s + (creditCountParType[ct] || 0), 0);
  // objC ("Objectif crédits (nombre)") est un nombre de dossiers, pas un
  // montant — le comparer à creditTotal (somme en €) produisait un "reste"
  // toujours à 0 dès qu'un montant significatif était saisi, quel que soit
  // le nombre réel de dossiers financés. Comparaison nombre contre nombre.
  const resteC = Math.max(0, objC - creditCountTotal);
  // "Montant vendu" reflète le montant OFFICIEL des crédits financés
  // (creditTotal, validé par le responsable via "Crédits financés — saisie
  // du jour"), pas les ventes de crédit auto-déclarées par le collaborateur
  // dans "Ma saisie" : cohérent avec "Crédits (total)" et le Classement, qui
  // utilisent déjà exclusivement creditRecords comme source officielle (voir
  // README > Crédits financés). Les entrées "Ma saisie" de type crédit
  // restent visibles dans le Journal pour le suivi personnel du
  // collaborateur, mais ne comptent plus en double vers cet objectif.
  const montantRealise = creditTotal;
  const resteM = Math.max(0, objM - montantRealise);
  const assuranceRealise = ASSURANCE_TYPES.reduce((s, at) => s + (assuranceRealiseParType[at] || 0), 0);
  const resteA = Math.max(0, objA - assuranceRealise);
  const hasProduitObjectifs =
    ASSURANCE_TYPES.some((at) => objectifsAssuranceParType[at] > 0) ||
    CREDIT_TYPES.some((ct) => objectifsCreditParType[ct] > 0);
  return {
    objA, objC, objM, declared, todayForMember, montantRealise, resteM,
    assuranceRealiseParType, creditRealiseParType, creditCountParType,
    creditTotal, creditCountTotal, resteC, assuranceRealise, resteA,
    objectifsAssuranceParType, objectifsCreditParType, hasProduitObjectifs,
  };
}

// Statut "au rythme" pour le mois en cours : compare la progression réelle
// de chaque objectif fixé (> 0) à la progression qu'on attendrait à ce
// stade du mois si l'activité était linéaire (jours écoulés / jours du
// mois). "En retard" dès qu'au moins un objectif fixé est sous ce rythme ;
// "Aucun objectif" si rien n'est fixé ; "À jour" sinon. Uniquement calculé
// pour le mois en cours — un mois archivé est déjà clos, la notion de
// "retard" n'a plus de sens.
function memberPaceStatus(metrics, isCurrentMonth) {
  if (!isCurrentMonth) return { key: "archive", label: "Mois archivé" };
  const { objA, objC, objM, assuranceRealise, creditCountTotal, montantRealise } = metrics;
  const objectifs = [
    { obj: objA, real: assuranceRealise },
    { obj: objC, real: creditCountTotal }, // objC est un nombre de dossiers, pas un montant — voir resteC ci-dessus
    { obj: objM, real: montantRealise },
  ].filter((o) => o.obj > 0);
  if (objectifs.length === 0) return { key: "neutre", label: "Aucun objectif" };
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsedFraction = Math.min(1, now.getDate() / daysInMonth);
  const late = objectifs.some((o) => o.real < o.obj * elapsedFraction);
  return late ? { key: "retard", label: "En retard" } : { key: "a_jour", label: "À jour" };
}

// Répartition d'un lot de ventes déclarées (entries) par produit — nombre
// pour les assurances, montant pour les crédits, PAT/BPR scindés en
// Papier/eDirect. Utilisé par RecapGrid (Journal, Ma saisie, Suivi &
// objectifs) pour un rendu cohérent partout dans l'app.
function entriesBreakdown(scopedEntries) {
  const assurance = Object.fromEntries(
    ASSURANCE_TYPES.map((at) => [
      at,
      scopedEntries.filter((e) => e.type === "assurance" && e.assuranceType === at).reduce((s, e) => s + (e.quantite || 1), 0),
    ])
  );
  const credit = {};
  const creditCount = {};
  CREDIT_TYPES.forEach((ct) => {
    const matches = scopedEntries.filter((e) => e.type === "credit" && e.creditType === ct);
    if (CONTRACT_MODE_CREDIT_TYPES.includes(ct)) {
      credit[ct] = Object.fromEntries(
        CONTRACT_MODES.map((mode) => [mode, matches.filter((e) => e.contractMode === mode).reduce((s, e) => s + (e.montant || 0), 0)])
      );
      creditCount[ct] = Object.fromEntries(
        CONTRACT_MODES.map((mode) => [mode, matches.filter((e) => e.contractMode === mode).length])
      );
    } else {
      credit[ct] = matches.reduce((s, e) => s + (e.montant || 0), 0);
      creditCount[ct] = matches.length;
    }
  });
  return { assurance, credit, creditCount };
}

// Renvoie { value, version } — `version` sert de base à la concurrence
// optimiste dans saveShared (voir plus bas) : un nombre à chaque fois
// qu'une écriture réussit côté Worker (voir worker/index.js).
async function loadShared(key, fallback, onError) {
  try {
    const r = await window.storage.get(key, true);
    return { value: r ? JSON.parse(r.value) : fallback, version: r ? r.version : 0 };
  } catch (e) {
    onError?.(e);
    // version = undefined : saveShared n'enverra pas expectedVersion, donc
    // pas de vérification de conflit tant qu'on n'a pas pu observer une
    // version fiable — mieux vaut permettre l'écriture (comportement
    // d'avant) que bloquer l'app sur un échec de chargement transitoire.
    return { value: fallback, version: undefined };
  }
}
// Écriture avec concurrence optimiste : si `expectedVersion` est fourni et
// ne correspond plus à la version actuelle côté serveur (quelqu'un d'autre
// a écrit entre-temps), le Worker refuse (409) plutôt que d'écraser
// silencieusement ce changement — voir worker/index.js. Renvoie la nouvelle
// version en cas de succès, à conserver pour la prochaine écriture.
async function saveShared(key, value, expectedVersion) {
  return window.storage.set(key, JSON.stringify(value), true, expectedVersion);
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
  // Verrou d'accès au site (code d'accès partagé, jamais envoyé au
  // navigateur — voir src/lib/storage.js > unlockSite). Tant que ce n'est
  // pas vrai, aucune donnée n'est chargée : seul <SiteAccessGate/> est
  // rendu. hasSiteToken() ne fait qu'une vérification locale indicative
  // (présence + expiration côté client) — le Worker reste seul juge de la
  // validité réelle du jeton à chaque appel.
  const [unlocked, setUnlocked] = useState(() => hasSiteToken());
  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [figures, setFigures] = useState({}); // { [monthKey]: { [memberId]: {assurance, ...CREDIT_TYPES} } }
  const [deletionHistory, setDeletionHistory] = useState([]); // [{id, kind, deletedAt, deletedBy, data}]
  const [invites, setInvites] = useState([]); // [{id, token, name, email, createdAt, createdBy, used, usedAt}]
  // Crédits financés officiellement validés par le responsable, saisis au
  // jour le jour (nombre + montant par type) plutôt qu'en un seul chiffre
  // mensuel écrasé à chaque mise à jour — voir CreditRecordsForm.
  const [creditRecords, setCreditRecords] = useState([]); // [{id, memberId, date, creditType, nombre, montant, recordedBy, recordedAt}]
  // Dernière version connue de chaque collection partagée (voir
  // loadShared/saveShared) — sert de base à la détection de conflit avant
  // chaque écriture, pour ne jamais écraser silencieusement une
  // modification faite ailleurs entre-temps (voir README > Robustesse).
  const [versions, setVersions] = useState({});
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
    if (!unlocked) return;
    (async () => {
      let loadError = null;
      const onError = (e) => {
        loadError = e;
      };
      const [mRes, eRes, fRes, hRes, invRes, crRes, lastSession] = await Promise.all([
        loadShared("members", [], onError),
        loadShared("entries", [], onError),
        loadShared("figures", {}, onError),
        loadShared("deletionHistory", [], onError),
        loadShared("invites", [], onError),
        loadShared("creditRecords", [], onError),
        loadLocal("last-session", null),
      ]);
      setMembers(mRes.value);
      setEntries(eRes.value);
      setFigures(fRes.value);
      setCreditRecords(crRes.value);
      setDeletionHistory(hRes.value);
      setInvites(invRes.value);
      setVersions({
        members: mRes.version,
        entries: eRes.version,
        figures: fRes.version,
        deletionHistory: hRes.version,
        invites: invRes.version,
        creditRecords: crRes.version,
      });
      // On ne fait jamais confiance à l'objet stocké localement tel quel :
      // seul son `id` sert de clé, le reste (notamment `role`) est
      // toujours repris du membre tel qu'il existe côté serveur au moment
      // du chargement. Sans ça, modifier son propre localStorage suffirait
      // à s'attribuer le rôle "responsable" (voir README > Sécurité).
      if (lastSession) {
        const freshMember = mRes.value.find((x) => x.id === lastSession.id);
        if (freshMember) {
          setSession(freshMember);
          setTab(freshMember.role === "responsable" ? "suivi" : "saisie");
        }
      }
      setReady(true);
      if (loadError) {
        if (isSessionError(loadError)) {
          // Le jeton stocké localement a expiré (ou a été invalidé côté
          // Worker, ex. rotation de SESSION_SECRET) entre le chargement de
          // la page et cette requête — effacer et réafficher le verrou
          // plutôt qu'un message d'erreur qui ne se résoudrait jamais.
          clearSiteToken();
          setUnlocked(false);
        } else {
          setServerStatus({ ok: false, detail: loadError.message });
          notify(`Chargement des données impossible (${loadError.message}) — les chiffres affichés peuvent être incomplets.`, true);
        }
      } else {
        setServerStatus({ ok: true, detail: null });
      }
    })();
  }, [unlocked]);

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
    const [mRes, eRes, fRes, hRes, invRes, crRes] = await Promise.all([
      loadShared("members", null, onError),
      loadShared("entries", null, onError),
      loadShared("figures", null, onError),
      loadShared("deletionHistory", null, onError),
      loadShared("invites", null, onError),
      loadShared("creditRecords", null, onError),
    ]);
    if (loadError) {
      if (isSessionError(loadError)) {
        clearSiteToken();
        setUnlocked(false);
        return false;
      }
      setServerStatus({ ok: false, detail: loadError.message });
      if (!silent) notify(`Actualisation impossible (${loadError.message}).`, true);
      return false;
    }
    if (mRes.value !== null) setMembers(mRes.value);
    if (eRes.value !== null) setEntries(eRes.value);
    if (fRes.value !== null) setFigures(fRes.value);
    if (hRes.value !== null) setDeletionHistory(hRes.value);
    if (invRes.value !== null) setInvites(invRes.value);
    if (crRes.value !== null) setCreditRecords(crRes.value);
    setVersions((v) => ({
      members: mRes.version ?? v.members,
      entries: eRes.version ?? v.entries,
      figures: fRes.version ?? v.figures,
      deletionHistory: hRes.version ?? v.deletionHistory,
      invites: invRes.version ?? v.invites,
      creditRecords: crRes.version ?? v.creditRecords,
    }));
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

  // "Journal" et "Suivi & objectifs" sont les deux onglets où le
  // responsable regarde des données déclarées par d'autres (l'équipe) :
  // sans ça, il faudrait attendre jusqu'à 30s (le cycle silencieux
  // automatique) après l'ouverture de l'onglet pour voir une vente très
  // récente. On déclenche donc un rafraîchissement silencieux à chaque
  // fois qu'on y navigue, en plus des rafraîchissements automatiques
  // existants (intervalle, retour sur l'onglet, bouton manuel).
  const changeTab = useCallback((next) => {
    setTab(next);
    if (next === "journal" || next === "suivi") refreshShared({ silent: true });
  }, [refreshShared]);

  // Sauvegarde générique pour toutes les collections partagées : bascule
  // l'état local immédiatement (optimiste), écrit en ligne en précisant la
  // dernière version connue (concurrence optimiste — voir loadShared plus
  // haut, sauf si `strict: false`, voir ci-dessous), et revient à l'état
  // précédent en cas d'échec pour que l'écran ne montre jamais comme
  // "enregistrée" une donnée qui ne l'est pas réellement côté serveur.
  // Renvoie true si la sauvegarde a réussi.
  //
  // Cas particulier : conflit (quelqu'un d'autre a écrit sur la même
  // collection entre-temps) — on ne réessaie pas silencieusement en
  // écrasant son travail, on prévient l'utilisateur et on rafraîchit en
  // arrière-plan pour qu'un nouvel essai reparte d'une base à jour.
  const persistCollection = async (key, next, previous, setState, { strict = true } = {}) => {
    setState(next);
    try {
      const newVersion = await saveShared(key, next, strict ? versions[key] : undefined);
      setVersions((v) => ({ ...v, [key]: newVersion }));
      setServerStatus({ ok: true, detail: null });
      return true;
    } catch (e) {
      console.error("storage set failed", key, e);
      setState(previous);
      if (isSessionError(e)) {
        clearSiteToken();
        setUnlocked(false);
        notify("Session expirée — ressaisissez le code d'accès.", true);
        return false;
      }
      setServerStatus({ ok: false, detail: e.message });
      if (e.conflict) {
        notify("Ces données ont été modifiées ailleurs entre-temps — actualisation en cours, réessayez.", true);
        refreshShared({ silent: true });
      } else {
        notify(`Échec de la sauvegarde en ligne (${e.message}) — vérifiez votre connexion et réessayez.`, true);
      }
      return false;
    }
  };
  const persistMembers = (next) => persistCollection("members", next, members, setMembers);
  const persistEntries = (next) => persistCollection("entries", next, entries, setEntries);
  // "invites" et "deletionHistory" restent en écriture inconditionnelle
  // (`strict: false`) : deux écritures quasi simultanées y sont courantes
  // par construction (le responsable qui génère un lien pendant qu'une
  // autre invitation s'active ailleurs ; deux suppressions coup sur coup
  // par des utilisateurs différents) et sans grande conséquence en cas de
  // perte rare (on régénère un lien, ou une ligne d'audit manque) — la
  // détection de conflit stricte bloquerait inutilement ce cas fréquent et
  // bénin. `members`/`entries`/`creditRecords` gardent la protection
  // stricte : y perdre une modification concurrente est plus coûteux.
  const persistDeletionHistory = (next) => persistCollection("deletionHistory", next, deletionHistory, setDeletionHistory, { strict: false });
  const persistInvites = (next) => persistCollection("invites", next, invites, setInvites, { strict: false });
  const persistCreditRecords = (next) => persistCollection("creditRecords", next, creditRecords, setCreditRecords);
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
    // Un responsable a rarement ses propres ventes à déclarer : l'atterrir
    // sur "Suivi & objectifs" (vue d'ensemble de l'équipe) plutôt que sur
    // "Ma saisie" lui évite un clic systématique à chaque connexion.
    setTab(member.role === "responsable" ? "suivi" : "saisie");
    await saveLocal("last-session", member);
  };
  const logout = async () => {
    setSession(null);
    await saveLocal("last-session", null);
  };

  if (!unlocked) {
    return <SiteAccessGate onUnlock={() => setUnlocked(true)} />;
  }

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
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { background: ${THEME.bg}; }
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
        /* Élévation premium à deux couches, appliquée à toutes les cartes
           (tout élément rounded-2xl) plutôt qu'un aplat bordure-seule. */
        .rounded-2xl { box-shadow: ${SHADOW_CARD}; }
        .sc-btn { transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease; }
        .sc-btn:hover { transform: translateY(-1px); }
        .sc-btn:active { transform: translateY(0); }
        /* Bandeau d'onglets défilable horizontalement sur mobile (au lieu de
           déborder hors de l'écran) — scrollbar masquée, le défilement au
           doigt reste possible (overflow-x-auto sur le <nav>). */
        .sc-scroll-x { scrollbar-width: none; -ms-overflow-style: none; }
        .sc-scroll-x::-webkit-scrollbar { display: none; }
      `}</style>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="sc-toast fixed top-4 right-4 left-4 sm:left-auto z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-start gap-2 sm:max-w-md"
          style={{ background: toast.isError ? THEME.red : THEME.navy, color: "#fff" }}
        >
          {toast.isError ? (
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" style={{ color: THEME.teal }} />
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
          deletionHistory={deletionHistory}
          recordDeletion={recordDeletion}
          restoreDeletion={restoreDeletion}
          invites={invites}
          setInvites={persistInvites}
          creditRecords={creditRecords}
          setCreditRecords={persistCreditRecords}
          tab={tab}
          setTab={changeTab}
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
// Palette "navy & laiton" (banque privée) : bleu marine très profond,
// laiton/or discret, bourgogne pour le responsable, sur fond crème neutre
// — cartes en légère élévation (voir SHADOW_CARD) plutôt que des aplats
// pastel façon SaaS générique.
const THEME = {
  bg: "#F7F4EC",
  navy: "#0F1B33",
  navySoft: "#4A5568",
  teal: "#1F5C4B",
  tealSoft: "#DCEAE5",
  amber: "#A67C27",
  amberSoft: "#F0E3C4",
  yellow: "#BF9440",
  yellowSoft: "#F3E9D6",
  red: "#8C2A3A",
  redSoft: "#F3DEE2",
  card: "#FFFFFF",
  line: "#E3DECF",
};
// Accent distinct pour l'interface responsable (nav, boutons d'action
// manager) — permet de voir d'un coup d'œil dans quel mode on est,
// sans toucher aux couleurs sémantiques des métriques (teal/ambre).
const MANAGER_ACCENT = "#6E1B34";
const MANAGER_ACCENT_SOFT = "#F1E0E4";
// Fraunces (serif éditorial à graisse variable) pour les titres et les
// grands chiffres — signature visuelle distincte des polices "Space
// Grotesk / Sora" omniprésentes dans les interfaces générées par IA ;
// Inter reste en corps de texte pour sa neutralité et sa lisibilité.
const FONT_DISPLAY = "'Fraunces', serif";
const FONT_BODY = "'Inter', sans-serif";
// Élévation à deux couches (ombre proche nette + ombre ambiante diffuse,
// teintée navy plutôt que neutre) appliquée globalement à toutes les
// cartes (tout élément rounded-2xl — voir la règle injectée dans le
// <style> global) — donne une profondeur discrète sans alourdir le tracé
// des bordures.
const SHADOW_CARD = "0 1px 2px rgba(15,27,51,0.05), 0 10px 28px -8px rgba(15,27,51,0.16)";

/* ---------------- VERROU D'ACCÈS AU SITE ---------------- */
// Premier écran rencontré, avant même la connexion collaborateur/
// responsable : demande le code d'accès partagé de l'équipe, vérifié
// côté Worker (POST /api/unlock) — voir src/lib/storage.js. Le code lui-
// même n'est jamais renvoyé au navigateur, contrairement à l'ancien
// mécanisme (APP_SECRET) qui finissait dans le bundle JS public.
function SiteAccessGate({ onUnlock }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!code) return setError("Renseignez le code d'accès.");
    setBusy(true);
    const result = await unlockSite(code);
    setBusy(false);
    if (result.ok) return onUnlock();
    if (result.error === "invalid_code") return setError("Code d'accès incorrect.");
    if (result.error === "too_many_attempts") return setError("Trop de tentatives — réessayez dans quelques minutes.");
    setError(`Connexion impossible (${result.error}) — vérifiez votre connexion et réessayez.`);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: `radial-gradient(circle at 50% -10%, ${THEME.tealSoft} 0%, ${THEME.bg} 55%)`, fontFamily: FONT_BODY }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: `linear-gradient(155deg, ${THEME.navy}, #0B2E24)` }}
          >
            <Lock size={24} color={THEME.teal} />
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, color: THEME.navy, letterSpacing: "-0.01em" }} className="text-3xl font-semibold">
            Suivi Commercial
          </h1>
          <p className="text-sm mt-1.5" style={{ color: THEME.navySoft }}>
            Accès réservé à l'équipe — code requis
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl p-6 space-y-4"
          style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}
        >
          <Field label="Code d'accès">
            <PasswordInput value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </Field>
          {error && (
            <div className="text-sm flex items-center gap-1.5" style={{ color: THEME.red }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="sc-btn w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: THEME.navy, boxShadow: "0 8px 20px -6px rgba(20,28,46,0.5)" }}
          >
            {busy && <Loader2 size={15} className="animate-spin" />} Entrer <ChevronRight size={15} />
          </button>
        </form>
        <p className="text-center text-xs mt-4" style={{ color: THEME.navySoft }}>
          Demandez ce code à votre responsable si vous ne l'avez pas.
        </p>
      </div>
    </div>
  );
}

/* ---------------- LOGIN ---------------- */
function LoginScreen({ members, onCreateMember, onLogin, notify }) {
  const [mode, setMode] = useState("collab"); // collab | manager
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Rempli quand le compte n'a encore aucun mot de passe (juste après une
  // réinitialisation par le responsable, ou premier passage après
  // l'introduction de cette fonctionnalité) — bascule le formulaire vers
  // "créez votre mot de passe" au lieu de la connexion normale.
  const [claimMember, setClaimMember] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const submitCollab = async (e) => {
    e.preventDefault();
    setError("");
    const em = email.trim().toLowerCase();
    if (!em || !password) return setError("Renseignez votre e-mail et votre mot de passe.");
    setBusy(true);
    const result = await loginMember(em, password);
    setBusy(false);
    if (result.error === "not_found") {
      return setError("Aucun compte trouvé avec cet e-mail. Demandez un lien d'invitation à votre responsable pour créer votre compte.");
    }
    if (result.needsPassword) {
      setClaimMember(result.member);
      return;
    }
    if (result.error === "invalid_password") {
      return setError("Mot de passe incorrect.");
    }
    if (result.error === "too_many_attempts") {
      return setError("Trop de tentatives — réessayez dans quelques minutes.");
    }
    if (result.ok) {
      onLogin(result.member);
      return;
    }
    setError(`Connexion impossible (${result.error || "raison inconnue"}) — vérifiez votre connexion et réessayez.`);
  };

  const submitClaim = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < PASSWORD_MIN_LEN) return setError(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LEN} caractères.`);
    if (newPassword !== newPassword2) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    try {
      await setMemberPassword(claimMember.id, newPassword);
      onLogin(claimMember);
    } catch (e) {
      setError(
        e.message === "too_many_attempts"
          ? "Trop de tentatives — réessayez dans quelques minutes."
          : `Impossible d'enregistrer le mot de passe (${e.message}) — réessayez.`
      );
    }
    setBusy(false);
  };

  const submitManager = async (e) => {
    e.preventDefault();
    if (busy) return; // évite un double envoi (double-clic, réseau lent)
    setError("");
    const em = email.trim().toLowerCase();
    if (!em || !name.trim()) return setError("Renseignez votre nom et votre e-mail professionnel.");
    setBusy(true);
    const { valid, limited } = await verifyManagerCode(code);
    if (limited) {
      setBusy(false);
      return setError("Trop de tentatives — réessayez dans quelques minutes.");
    }
    if (!valid) {
      setBusy(false);
      return setError("Code d'accès responsable incorrect (ou connexion au serveur impossible).");
    }
    let existing = members.find((m) => m.email.toLowerCase() === em);
    if (existing) {
      if (existing.role !== "responsable") {
        existing = { ...existing, role: "responsable" };
        const ok = await onCreateMember(members.map((m) => (m.id === existing.id ? existing : m)));
        if (!ok) {
          setBusy(false);
          return setError("Échec de la mise à jour du compte — vérifiez votre connexion et réessayez.");
        }
      }
      setBusy(false);
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
    setBusy(false);
    if (!ok) return setError("Échec de la création du compte — vérifiez votre connexion et réessayez.");
    onLogin(newManager);
    notify("Accès responsable activé.");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: `radial-gradient(circle at 50% -10%, ${THEME.tealSoft} 0%, ${THEME.bg} 55%)` }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: `linear-gradient(155deg, ${THEME.navy}, #0B2E24)` }}
          >
            <TrendingUp size={26} color={THEME.teal} />
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, color: THEME.navy, letterSpacing: "-0.01em" }} className="text-3xl font-semibold">
            Suivi Commercial
          </h1>
          <p className="text-sm mt-1.5" style={{ color: THEME.navySoft }}>
            Assurances & crédits — objectifs du mois
          </p>
        </div>

        <div
          className="rounded-2xl overflow-hidden shadow-sm"
          style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}
        >
          <div className="flex" style={{ borderBottom: `1px solid ${THEME.line}` }}>
            <button
              onClick={() => { setMode("collab"); setError(""); setClaimMember(null); }}
              className="flex-1 py-3 text-sm font-medium transition-colors"
              style={{
                color: mode === "collab" ? THEME.teal : THEME.navySoft,
                borderBottom: mode === "collab" ? `2px solid ${THEME.teal}` : "2px solid transparent",
              }}
            >
              Collaborateur
            </button>
            <button
              onClick={() => { setMode("manager"); setError(""); setClaimMember(null); }}
              className="flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
              style={{
                color: mode === "manager" ? MANAGER_ACCENT : THEME.navySoft,
                borderBottom: mode === "manager" ? `2px solid ${MANAGER_ACCENT}` : "2px solid transparent",
              }}
            >
              <Lock size={13} /> Responsable
            </button>
          </div>

          {mode === "collab" && claimMember ? (
            <form onSubmit={submitClaim} className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg" style={{ background: THEME.tealSoft, color: THEME.teal }}>
                <KeyRound size={15} className="flex-shrink-0" />
                <span>Aucun mot de passe n'est encore défini pour <strong>{claimMember.name}</strong>. Créez-en un pour continuer.</span>
              </div>
              <Field label="Nouveau mot de passe">
                <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Confirmer le mot de passe">
                <PasswordInput value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} autoComplete="new-password" />
              </Field>
              {error && (
                <div className="text-sm flex items-center gap-1.5" style={{ color: THEME.red }}>
                  <AlertCircle size={14} /> {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="sc-btn w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: THEME.teal, boxShadow: "0 8px 20px -6px rgba(11,107,96,0.45)" }}
              >
                Créer le mot de passe <ChevronRight size={15} />
              </button>
              <button type="button" onClick={() => { setClaimMember(null); setError(""); }} className="w-full text-center text-xs underline" style={{ color: THEME.navySoft }}>
                Ce n'est pas moi / revenir à la connexion
              </button>
            </form>
          ) : (
            <form onSubmit={mode === "collab" ? submitCollab : submitManager} className="p-6 space-y-4">
              {mode === "manager" && (
                <Field label="Nom complet">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Prénom Nom"
                    className="w-full px-3.5 py-2.5 rounded-lg text-sm"
                    style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
                  />
                </Field>
              )}
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
              {mode === "collab" && (
                <Field label="Mot de passe">
                  <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </Field>
              )}
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
                disabled={busy}
                className="sc-btn w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: THEME.navy, boxShadow: "0 8px 20px -6px rgba(20,28,46,0.5)" }}
              >
                Entrer <ChevronRight size={15} />
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-xs mt-4" style={{ color: THEME.navySoft }}>
          {mode === "collab"
            ? "La création d'un compte collaborateur se fait uniquement via un lien d'invitation envoyé par votre responsable."
            : "Connexion par identification e-mail et code d'accès responsable."}
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
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const invite = invites.find((i) => i.token === token);

  if (!invite || invite.used) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: `radial-gradient(circle at 50% -10%, ${THEME.redSoft} 0%, ${THEME.bg} 55%)` }}
      >
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

  const activate = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < PASSWORD_MIN_LEN) return setError(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LEN} caractères.`);
    if (password !== password2) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
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
    try {
      await setMemberPassword(newMember.id, password);
    } catch {
      setError("Compte créé, mais l'enregistrement du mot de passe a échoué — réessayez de vous connecter pour en définir un.");
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
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: `radial-gradient(circle at 50% -10%, ${THEME.tealSoft} 0%, ${THEME.bg} 55%)` }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: `linear-gradient(155deg, ${THEME.navy}, #0B2E24)` }}
          >
            <Users size={26} color={THEME.teal} />
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, color: THEME.navy, letterSpacing: "-0.01em" }} className="text-3xl font-semibold">
            Invitation à rejoindre l'équipe
          </h1>
          <p className="text-sm mt-1.5" style={{ color: THEME.navySoft }}>
            Suivi Commercial — Assurances & crédits
          </p>
        </div>

        <form
          onSubmit={activate}
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
          <Field label="Créez votre mot de passe">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirmez le mot de passe">
            <PasswordInput value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </Field>
          <p className="text-xs" style={{ color: THEME.navySoft }}>
            Ce mot de passe protège votre profil : lui seul (avec votre responsable en cas d'oubli) permettra d'y accéder.
          </p>
          {error && (
            <div className="text-sm flex items-center gap-1.5" style={{ color: THEME.red }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="sc-btn w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: THEME.teal, boxShadow: "0 8px 20px -6px rgba(11,107,96,0.45)" }}
          >
            Activer mon compte <ChevronRight size={15} />
          </button>
          <button type="button" onClick={onCancel} className="w-full text-center text-xs underline" style={{ color: THEME.navySoft }}>
            Ce n'est pas moi / revenir à la connexion
          </button>
        </form>
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

// Champ mot de passe avec bouton afficher/masquer — utilisé partout où un
// mot de passe se saisit (connexion, activation d'invitation, réinitialisation).
function PasswordInput({ value, onChange, placeholder = "••••••••", autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full pl-3.5 pr-10 py-2.5 rounded-lg text-sm"
        style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-0 top-0 bottom-0 px-3 flex items-center"
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
      >
        {visible ? <EyeOff size={15} style={{ color: THEME.navySoft }} /> : <Eye size={15} style={{ color: THEME.navySoft }} />}
      </button>
    </div>
  );
}

/* ---------------- MAIN APP ---------------- */
function MainApp({ session, onLogout, members, setMembers, entries, setEntries, figures, deletionHistory, recordDeletion, restoreDeletion, invites, setInvites, creditRecords, setCreditRecords, tab, setTab, mKey, notify, onRefresh, refreshing }) {
  const isManager = session.role === "responsable";
  const accent = isManager ? MANAGER_ACCENT : THEME.teal;
  const accentSoft = isManager ? MANAGER_ACCENT_SOFT : THEME.tealSoft;

  // Résumé "coup d'œil" pour le responsable : agrège la progression de
  // toute l'équipe sur le mois en cours, visible dans un bandeau persistant
  // quel que soit l'onglet actif (pas seulement dans "Suivi & objectifs").
  // Réutilise les mêmes helpers (computeMemberMetrics/memberPaceStatus) que
  // SuiviTab pour rester rigoureusement cohérent avec le détail par
  // collaborateur.
  const teamOverview = useMemo(() => {
    if (!isManager) return null;
    const collaborators = members.filter((m) => m.role === "collaborateur");
    if (collaborators.length === 0) return null;
    const monthFigures = figures[mKey] || {};
    // creditObjectif ("nombre") se compare à creditCountTotal (nombre de
    // dossiers), pas à une somme en euros — voir computeMemberMetrics/
    // memberPaceStatus pour le même correctif appliqué au calcul du statut.
    let assuranceRealise = 0, assuranceObjectif = 0, creditCountTotal = 0, creditObjectif = 0, montantRealise = 0, lateCount = 0;
    collaborators.forEach((m) => {
      const metrics = computeMemberMetrics(m, entries, monthFigures, creditRecords, mKey);
      assuranceRealise += metrics.assuranceRealise;
      assuranceObjectif += metrics.objA;
      creditCountTotal += metrics.creditCountTotal;
      creditObjectif += metrics.objC;
      montantRealise += metrics.montantRealise;
      if (memberPaceStatus(metrics, true).key === "retard") lateCount += 1;
    });
    return { assuranceRealise, assuranceObjectif, creditCountTotal, creditObjectif, montantRealise, lateCount };
  }, [isManager, members, entries, figures, creditRecords, mKey]);
  const pendingInvitesCount = useMemo(() => invites.filter((i) => !i.used).length, [invites]);

  // Mode focus : quand le responsable édite un collaborateur dans "Suivi &
  // objectifs", le bandeau "coup d'œil" et les onglets de navigation se
  // regroupent dans une barre flottante compacte (nom du collaborateur +
  // sortie), pour concentrer l'écran sur la saisie plutôt que sur la
  // navigation. Remonté ici (plutôt que gardé local à SuiviTab) pour que
  // MainApp puisse aussi masquer sa propre nav le temps de l'édition.
  const [editingMemberId, setEditingMemberId] = useState(null);
  useEffect(() => {
    if (tab !== "suivi") setEditingMemberId(null);
  }, [tab]);
  const focusMode = tab === "suivi" && !!editingMemberId;
  const editingMember = focusMode ? members.find((m) => m.id === editingMemberId) : null;

  return (
    <div>
      <header
        className="sticky top-0 z-20 px-5 py-4 flex items-center justify-between"
        style={{
          background: isManager ? `linear-gradient(135deg, ${accent}, #4E1226)` : THEME.card,
          borderBottom: isManager ? "none" : `1px solid ${THEME.line}`,
          boxShadow: isManager ? "0 4px 20px -8px rgba(20,10,15,0.45)" : "0 1px 0 rgba(35,26,12,0.05)",
        }}
      >
        <div>
          <div
            style={{ fontFamily: FONT_DISPLAY, color: isManager ? "#fff" : THEME.navy, letterSpacing: "-0.01em" }}
            className="text-lg font-semibold"
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

      {focusMode ? (
        // Mode focus (édition d'un collaborateur) : la nav, le bandeau
        // "coup d'œil" et les panneaux "Objectifs généraux"/"Vue
        // d'ensemble" (masqués côté SuiviTab) se regroupent ici dans une
        // barre compacte et collante — l'écran reste concentré sur la
        // saisie, avec juste un rappel du contexte et une sortie rapide.
        <div
          className="sticky top-[65px] z-10 px-5 py-2.5 flex items-center justify-between gap-3 max-w-5xl mx-auto w-full"
          style={{ background: MANAGER_ACCENT_SOFT, borderBottom: `1px solid ${MANAGER_ACCENT}30` }}
        >
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Pencil size={14} style={{ color: MANAGER_ACCENT, flexShrink: 0 }} />
            <span className="font-semibold truncate" style={{ color: MANAGER_ACCENT }}>
              Édition — {editingMember?.name}
            </span>
          </div>
          <button
            onClick={() => setEditingMemberId(null)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
            style={{ background: MANAGER_ACCENT, color: "#fff" }}
          >
            <X size={13} /> Fermer
          </button>
        </div>
      ) : (
        <>
          {teamOverview && (
            <div
              className="px-5 py-2.5 flex items-center gap-x-5 gap-y-1 flex-wrap text-xs max-w-5xl mx-auto"
              style={{ color: THEME.navySoft }}
              title="Cumul de toute l'équipe — la somme des objectifs individuels de chaque collaborateur, pas la même valeur que le champ 'Objectifs généraux' ci-dessous (qui s'applique par personne)"
            >
              {teamOverview.lateCount > 0 && (
                <span className="font-semibold flex items-center gap-1" style={{ color: THEME.red }}>
                  <AlertCircle size={12} /> {teamOverview.lateCount} en retard
                </span>
              )}
              <span>
                <span className="font-semibold" style={{ color: THEME.navy }}>{teamOverview.assuranceRealise}</span> assur. / obj. {teamOverview.assuranceObjectif} <span className="opacity-60">(cumul équipe)</span>
              </span>
              <span>
                <span className="font-semibold" style={{ color: THEME.navy }}>{teamOverview.creditCountTotal}</span> créd. / obj. {teamOverview.creditObjectif} <span className="opacity-60">(cumul équipe)</span>
              </span>
              <span>
                <span className="font-semibold" style={{ color: THEME.navy }}>{formatEUR(teamOverview.montantRealise)}</span> vendus ce mois
              </span>
            </div>
          )}

          <nav className="flex gap-1 px-5 pt-4 max-w-5xl mx-auto overflow-x-auto sc-scroll-x">
            <TabButton active={tab === "saisie"} onClick={() => setTab("saisie")} icon={ClipboardList} accent={accent}>
              Ma saisie
            </TabButton>
            <TabButton active={tab === "journal"} onClick={() => setTab("journal")} icon={Calendar} accent={accent}>
              Journal
            </TabButton>
            <TabButton active={tab === "suivi"} onClick={() => setTab("suivi")} icon={Award} accent={accent} badge={teamOverview?.lateCount || 0}>
              Suivi & objectifs
            </TabButton>
            <TabButton active={tab === "classement"} onClick={() => setTab("classement")} icon={Trophy} accent={accent}>
              Classement
            </TabButton>
            {isManager && (
              <TabButton active={tab === "equipe"} onClick={() => setTab("equipe")} icon={Users} accent={accent} badge={pendingInvitesCount}>
                Équipe
              </TabButton>
            )}
            {isManager && (
              <TabButton active={tab === "historique"} onClick={() => setTab("historique")} icon={History} accent={accent}>
                Historique
              </TabButton>
            )}
          </nav>
        </>
      )}

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
            creditRecords={creditRecords}
            setCreditRecords={setCreditRecords}
            setTab={setTab}
            mKey={mKey}
            notify={notify}
            isManager={isManager}
            editing={editingMemberId}
            setEditing={setEditingMemberId}
          />
        )}
        {tab === "classement" && (
          <ClassementTab members={members} entries={entries} figures={figures} creditRecords={creditRecords} mKey={mKey} />
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

function TabButton({ active, onClick, icon: Icon, children, accent = THEME.teal, badge = 0 }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap"
      style={{
        color: active ? accent : hover ? THEME.navy : THEME.navySoft,
        background: active ? THEME.card : hover ? "rgba(20,15,5,0.035)" : "transparent",
        borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
      }}
    >
      <Icon size={15} /> {children}
      {badge > 0 && (
        <span
          className="text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded-full"
          style={{ background: THEME.red, color: "#fff" }}
        >
          {badge}
        </span>
      )}
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
  const [submitting, setSubmitting] = useState(false);
  const [showTodaySales, setShowTodaySales] = useState(false);

  const needsContractMode = type === "credit" && CONTRACT_MODE_CREDIT_TYPES.includes(creditType);

  // Avertissement non bloquant (pas de contrainte d'unicité côté serveur) :
  // un numéro de dossier identique existe déjà, tous collaborateurs et
  // mois confondus — le plus souvent une faute de frappe ou une saisie en
  // double, à vérifier avant de valider quand même.
  const duplicateDossier = useMemo(() => {
    const key = dossier.trim().toLowerCase();
    if (!key) return null;
    return entries.find((e) => e.id !== editingEntryId && e.dossier.trim().toLowerCase() === key) || null;
  }, [dossier, entries, editingEntryId]);

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
    if (submitting) return; // évite un double envoi (double-clic, réseau lent)
    if (!dossier.trim()) return notify("Indiquez le numéro de dossier.", true);
    if (type === "assurance" && (!Number.isFinite(Number(quantite)) || Number(quantite) <= 0)) {
      return notify("Le nombre d'assurances vendues doit être supérieur à 0.", true);
    }
    if (type === "credit" && (!Number.isFinite(Number(montant)) || Number(montant) <= 0)) {
      return notify("Indiquez un montant supérieur à 0.", true);
    }
    // Une vente ne peut être déclarée que dans le mois en cours (pas dans le
    // futur, ni dans un mois déjà archivé) — un chiffre déjà clos ne doit
    // plus pouvoir être modifié rétroactivement en douce. Le sélecteur de
    // date pose déjà min/max ; cette vérification couvre une saisie clavier
    // qui contournerait ces bornes.
    if (date < `${mKey}-01` || date > todayISO()) {
      return notify("La date doit être comprise dans le mois en cours.", true);
    }
    setSubmitting(true);
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
    setSubmitting(false);
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            {duplicateDossier && (
              <p className="text-xs mt-1.5 flex items-start gap-1.5" style={{ color: THEME.amber }}>
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                Ce numéro de dossier existe déjà — déclaré par {duplicateDossier.personName} le{" "}
                {new Date(duplicateDossier.date + "T00:00:00").toLocaleDateString("fr-FR")}. Vérifiez qu'il ne s'agit pas d'un doublon avant d'enregistrer.
              </p>
            )}
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
              min={`${mKey}-01`}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-sm"
              style={{ border: `1px solid ${THEME.line}`, background: "#FAFBFC" }}
            />
          </Field>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="sc-btn flex-1 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-60"
              style={{ background: THEME.teal }}
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
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
            <button
              type="button"
              onClick={() => setShowTodaySales((v) => !v)}
              className="flex items-center gap-1.5 min-w-0"
            >
              <ChevronRight size={14} style={{ color: THEME.navySoft, transform: showTodaySales ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
              <h2 className="text-sm font-semibold">Mes ventes du jour</h2>
              {todayEntries.length > 0 && (
                <span
                  className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: THEME.bg, color: THEME.navySoft }}
                >
                  {todayEntries.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab("journal")}
              className="text-xs font-medium flex items-center gap-1 flex-shrink-0"
              style={{ color: THEME.teal }}
            >
              Voir le journal complet <ChevronRight size={13} />
            </button>
          </div>
          {showTodaySales && (
            <>
              <div className="mb-4">
                <RecapGrid entries={todayEntries} showAssurance creditTitle="Vente en instance" />
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
                          className="p-2 rounded-md flex-shrink-0"
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
            </>
          )}
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
          return (
            <div key={date} className="rounded-2xl overflow-hidden" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
              <div
                className="px-5 py-4"
                style={{ borderBottom: `1px solid ${THEME.line}`, background: THEME.bg }}
              >
                <div className="text-sm font-semibold capitalize mb-3">{dayLabel(date)}</div>
                <RecapGrid entries={dayEntries} />
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

// Récapitulatif d'un lot de ventes (un jour, "aujourd'hui"…) en grille de
// puces responsive — une puce par produit, PAT/BPR scindés en
// Papier/eDirect — reprenant la logique du tableau papier de l'équipe,
// sans les contraintes d'un vrai tableau (pas de défilement horizontal,
// s'adapte à toutes les largeurs d'écran). Les puces sans activité
// s'effacent visuellement (fond neutre, valeur en tiret) pour que l'œil
// aille droit à ce qui bouge.
function RecapGrid({ entries, showAssurance = true, creditTitle = "Crédits financés" }) {
  const breakdown = entriesBreakdown(entries);
  const assuranceChips = ASSURANCE_TYPES.map((at) => ({ key: at, label: at, value: breakdown.assurance[at], format: (v) => v }));
  const creditChips = CREDIT_TYPES.flatMap((ct) =>
    CONTRACT_MODE_CREDIT_TYPES.includes(ct)
      ? CONTRACT_MODES.map((mode) => ({
          key: `${ct}-${mode}`,
          label: ct,
          sublabel: mode,
          value: breakdown.credit[ct][mode],
          count: breakdown.creditCount[ct][mode],
          format: formatEUR,
        }))
      : [{ key: ct, label: ct, value: breakdown.credit[ct], count: breakdown.creditCount[ct], format: formatEUR }]
  );

  return (
    <div className="space-y-3">
      {showAssurance && (
        <RecapSection title="Assurances" chips={assuranceChips} tint={THEME.tealSoft} accent={THEME.teal} cols="grid-cols-3" />
      )}
      <RecapSection title={creditTitle} chips={creditChips} tint={THEME.amberSoft} accent={THEME.amber} cols="grid-cols-2 sm:grid-cols-4" />
    </div>
  );
}

function RecapSection({ title, chips, tint, accent, cols }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: accent }}>
        {title}
      </div>
      <div className={`grid ${cols} gap-1.5`}>
        {chips.map((c) => (
          <div
            key={c.key}
            className="rounded-lg px-2 py-1.5 text-center transition-colors"
            style={{ background: c.value > 0 ? tint : THEME.bg }}
          >
            <div className="text-[10px] font-medium leading-tight" style={{ color: THEME.navySoft }}>
              <div className="truncate">
                {c.count > 0 && (
                  <span className="font-semibold" style={{ color: accent }}>({c.count}) </span>
                )}
                {c.label}
              </div>
              {c.sublabel && <div className="truncate" style={{ opacity: 0.75 }}>{c.sublabel}</div>}
            </div>
            <div
              className="text-sm font-semibold mt-0.5"
              style={{ fontFamily: FONT_DISPLAY, color: c.value > 0 ? THEME.navy : THEME.line, fontVariantNumeric: "tabular-nums" }}
            >
              {c.value > 0 ? c.format(c.value) : "–"}
            </div>
          </div>
        ))}
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
  disabled = false,
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
          disabled={disabled}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          className="px-2 py-1 rounded-md text-xs font-semibold text-white whitespace-nowrap disabled:opacity-60"
          style={{ background: color }}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="p-2 rounded-md"
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
        disabled={disabled}
        onClick={() => setArmed(true)}
        className="p-2 rounded-md flex-shrink-0 disabled:opacity-60"
        aria-label={label}
      >
        <Icon size={14} style={{ color }} />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setArmed(true)}
      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-60"
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
function SuiviTab({ session, members, setMembers, entries, figures, creditRecords, setCreditRecords, mKey, notify, isManager, setTab, editing, setEditing }) {
  const collaborators = members.filter((m) => m.role === "collaborateur");
  const [viewMonth, setViewMonth] = useState(mKey);
  const isCurrentMonth = viewMonth === mKey;
  const monthFigures = figures[viewMonth] || {};
  const daysLeft = daysLeftInMonth();

  // `editing` (memberId en cours d'édition, ou null) et son setter viennent
  // de MainApp : remontés pour que la nav/le bandeau puissent aussi se
  // regrouper dans la barre flottante pendant l'édition (voir MainApp >
  // focusMode) — SuiviTab n'a plus besoin de son propre état local ici.
  const [objDraft, setObjDraft] = useState({ objectifAssurance: 0, objectifCredit: 0, objectifMontant: 0 });
  const [objByTypeDraft, setObjByTypeDraft] = useState(emptyObjByType());
  const [generalObj, setGeneralObj] = useState({ objectifAssurance: 5, objectifCredit: 5, objectifMontant: 5000 });
  const [creditDate, setCreditDate] = useState(todayISO());
  const [creditDraft, setCreditDraft] = useState(emptyCreditDraft());
  // Sélection du collaborateur affiché en détail (vue responsable) — un
  // menu déroulant + une liste compacte avec statut de rythme remplacent
  // l'affichage de toutes les cartes en même temps, pour rester utilisable
  // avec une grande équipe (50 collaborateurs et plus).
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberSearch, setMemberSearch] = useState("");
  // Un seul indicateur "en cours d'enregistrement" pour les 3 actions
  // d'écriture ci-dessous (objectifs généraux, objectifs individuels,
  // crédits du jour) — désactive le bouton concerné le temps de l'appel
  // réseau pour éviter un double envoi (double-clic, réseau lent).
  const [saving, setSaving] = useState(false);

  const applyGeneralObjectives = async () => {
    if (saving) return;
    setSaving(true);
    const updated = members.map((m) => {
      if (m.role !== "collaborateur") return m;
      const objectifAssurance = Number(generalObj.objectifAssurance) || 0;
      const objectifCredit = Number(generalObj.objectifCredit) || 0;
      const objectifMontant = Number(generalObj.objectifMontant) || 0;
      return {
        ...m,
        objectifAssurance,
        objectifCredit,
        objectifMontant,
        // Historise l'objectif appliqué au mois en cours (mKey, jamais
        // viewMonth) — voir resolveObjectivesForMonth : sans ça, ce
        // changement s'appliquerait rétroactivement à tous les mois déjà
        // archivés consultés depuis "Suivi & objectifs".
        objectifsHistory: {
          ...(m.objectifsHistory || {}),
          [mKey]: {
            ...(m.objectifsHistory?.[mKey] || {}),
            objectifAssurance,
            objectifCredit,
            objectifMontant,
          },
        },
      };
    });
    const ok = await setMembers(updated);
    if (ok) notify(`Objectifs généraux appliqués à ${collaborators.length} collaborateur(s).`);
    setSaving(false);
  };

  // Recharge la saisie du jour (nombre + montant par type de crédit, et par
  // mode de contrat Papier/eDirect pour PAT/BPR) déjà enregistrée pour ce
  // collaborateur à cette date, s'il y en a une — pour corriger une
  // journée sans créer de doublon.
  const loadCreditDraftFor = (memberId, date) => {
    const draft = emptyCreditDraft();
    creditRecords
      .filter((r) => r.memberId === memberId && r.date === date)
      .forEach((r) => {
        const entry = { nombre: r.nombre, montant: r.montant };
        if (CONTRACT_MODE_CREDIT_TYPES.includes(r.creditType) && r.contractMode) {
          draft[r.creditType][r.contractMode] = entry;
        } else {
          draft[r.creditType] = entry;
        }
      });
    return draft;
  };

  const startEdit = (member) => {
    setEditing(member.id);
    // On édite toujours l'objectif du mois EN COURS (mKey), jamais celui
    // d'un mois archivé consulté via viewMonth — resolveObjectivesForMonth
    // renvoie le snapshot le plus récent applicable à mKey, ou les champs
    // "courants" du membre à défaut (voir sa définition).
    const current = resolveObjectivesForMonth(member, mKey);
    setObjDraft({
      objectifAssurance: current.objA,
      objectifCredit: current.objC,
      objectifMontant: current.objM,
    });
    setObjByTypeDraft({
      assurance: { ...emptyObjByType().assurance, ...current.objectifsAssuranceParType },
      credit: { ...emptyObjByType().credit, ...current.objectifsCreditParType },
    });
    const d = todayISO();
    setCreditDate(d);
    setCreditDraft(loadCreditDraftFor(member.id, d));
  };

  const changeCreditDate = (member, date) => {
    setCreditDate(date);
    setCreditDraft(loadCreditDraftFor(member.id, date));
  };

  const saveEdit = async (member) => {
    if (saving) return;
    setSaving(true);
    const objectifAssurance = Number(objDraft.objectifAssurance) || 0;
    const objectifCredit = Number(objDraft.objectifCredit) || 0;
    const objectifMontant = Number(objDraft.objectifMontant) || 0;
    const ok = await setMembers(
      members.map((m) =>
        m.id === member.id
          ? {
              ...m,
              objectifAssurance,
              objectifCredit,
              objectifMontant,
              objectifsAssuranceParType: objByTypeDraft.assurance,
              objectifsCreditParType: objByTypeDraft.credit,
              // Historise l'objectif appliqué au mois en cours (mKey) — voir
              // resolveObjectivesForMonth / applyGeneralObjectives : un mois
              // déjà archivé garde le statut évalué avec l'objectif qui
              // était réellement en vigueur à l'époque.
              objectifsHistory: {
                ...(m.objectifsHistory || {}),
                [mKey]: {
                  objectifAssurance,
                  objectifCredit,
                  objectifMontant,
                  objectifsAssuranceParType: objByTypeDraft.assurance,
                  objectifsCreditParType: objByTypeDraft.credit,
                },
              },
            }
          : m
      )
    );
    if (ok) {
      setEditing(null);
      notify(`Objectifs mis à jour — ${member.name}`);
    }
    setSaving(false);
  };

  // Remplace (upsert) la saisie de crédits financés du jour choisi pour ce
  // collaborateur : les enregistrements existants pour ce jour sont
  // écrasés par la nouvelle saisie (une entrée à 0/0 est simplement
  // retirée). PAT et BPR produisent jusqu'à 2 enregistrements (Papier +
  // eDirect), les autres types un seul.
  const saveCreditRecords = async (member) => {
    if (saving) return;
    // Un chiffre déjà clos ne doit plus pouvoir être modifié rétroactivement
    // en douce — le sélecteur de date pose déjà min/max (mois en cours),
    // cette vérification couvre une saisie clavier qui les contournerait.
    if (creditDate < `${mKey}-01` || creditDate > todayISO()) {
      notify("La date doit être comprise dans le mois en cours.", true);
      return;
    }
    setSaving(true);
    const others = creditRecords.filter((r) => !(r.memberId === member.id && r.date === creditDate));
    const baseRecord = {
      id: undefined,
      memberId: member.id,
      date: creditDate,
      recordedBy: { id: session.id, name: session.name },
      recordedAt: new Date().toISOString(),
    };
    const additions = [];
    CREDIT_TYPES.forEach((ct) => {
      if (CONTRACT_MODE_CREDIT_TYPES.includes(ct)) {
        CONTRACT_MODES.forEach((mode) => {
          const entry = creditDraft[ct][mode];
          if ((entry.nombre || 0) > 0 || (entry.montant || 0) > 0) {
            additions.push({
              ...baseRecord,
              id: uid(),
              creditType: ct,
              contractMode: mode,
              nombre: Number(entry.nombre) || 0,
              montant: Number(entry.montant) || 0,
            });
          }
        });
      } else {
        const entry = creditDraft[ct];
        if ((entry.nombre || 0) > 0 || (entry.montant || 0) > 0) {
          additions.push({
            ...baseRecord,
            id: uid(),
            creditType: ct,
            contractMode: null,
            nombre: Number(entry.nombre) || 0,
            montant: Number(entry.montant) || 0,
          });
        }
      }
    });
    const ok = await setCreditRecords([...additions, ...others]);
    if (ok) notify(`Crédits enregistrés pour le ${new Date(creditDate + "T00:00:00").toLocaleDateString("fr-FR")} — ${member.name}`);
    setSaving(false);
  };

  const visibleMembers = isManager ? collaborators : collaborators.filter((m) => m.id === session.id);

  // File de validation quotidienne : agrège, pour toute l'équipe, ce que
  // chaque collaborateur a déclaré AUJOURD'HUI (assurances + crédits en
  // instance) — pour ne plus avoir à ouvrir chaque fiche une à une afin de
  // repérer qui a de l'activité à traiter. Uniquement pertinent sur le
  // mois en cours (une déclaration "aujourd'hui" n'a pas de sens en
  // consultant un mois archivé).
  const todayPending = useMemo(() => {
    if (!isManager || !isCurrentMonth) return [];
    const today = todayISO();
    const todays = entries.filter((e) => e.date === today);
    return collaborators
      .map((m) => {
        const mine = todays.filter((e) => e.personId === m.id);
        if (mine.length === 0) return null;
        const assuranceCount = mine
          .filter((e) => e.type === "assurance")
          .reduce((s, e) => s + (e.quantite || 1), 0);
        const creditEntries = mine.filter((e) => e.type === "credit");
        return {
          member: m,
          assuranceCount,
          creditCount: creditEntries.length,
          creditMontant: creditEntries.reduce((s, e) => s + (e.montant || 0), 0),
        };
      })
      .filter(Boolean);
  }, [isManager, isCurrentMonth, entries, collaborators]);

  // Résumés légers (statut de rythme) pour tous les collaborateurs — sert à
  // la fois la liste compacte "vue d'ensemble" et le menu déroulant, sans
  // jamais avoir à rendre les cartes détaillées de tout le monde à la fois.
  const summaries = useMemo(
    () =>
      collaborators.map((m) => {
        const metrics = computeMemberMetrics(m, entries, monthFigures, creditRecords, viewMonth);
        return { member: m, metrics, status: memberPaceStatus(metrics, isCurrentMonth) };
      }),
    [collaborators, entries, monthFigures, creditRecords, viewMonth, isCurrentMonth]
  );
  const statusCounts = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({ ...acc, [s.status.key]: (acc[s.status.key] || 0) + 1 }),
        { retard: 0, a_jour: 0, neutre: 0 }
      ),
    [summaries]
  );
  const filteredSummaries = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const list = q
      ? summaries.filter((s) => s.member.name.toLowerCase().includes(q) || s.member.email.toLowerCase().includes(q))
      : summaries;
    const order = { retard: 0, a_jour: 1, archive: 1, neutre: 2 };
    return [...list].sort(
      (a, b) => (order[a.status.key] ?? 3) - (order[b.status.key] ?? 3) || a.member.name.localeCompare(b.member.name)
    );
  }, [summaries, memberSearch]);

  // Sélectionne par défaut le premier collaborateur en retard (le plus
  // pertinent à traiter), sinon le premier de la liste — et re-sélectionne
  // automatiquement si le collaborateur choisi disparaît (retiré de
  // l'équipe).
  useEffect(() => {
    if (!isManager) return;
    if (collaborators.length === 0) {
      if (selectedMemberId !== null) setSelectedMemberId(null);
      return;
    }
    if (collaborators.some((m) => m.id === selectedMemberId)) return;
    const firstLate = summaries.find((s) => s.status.key === "retard");
    setSelectedMemberId((firstLate || summaries[0])?.member.id ?? null);
  }, [isManager, collaborators, summaries, selectedMemberId]);

  const selectedMember = collaborators.find((m) => m.id === selectedMemberId) || null;

  const exportExcel = () => {
    const rows = collaborators.map((m) => {
      const f = monthFigures[m.id] || emptyFigures();
      const creditParType = creditRealiseParTypeFor(f, creditRecords, m.id, viewMonth);
      const creditCountParType = creditCountParTypeFor(creditRecords, m.id, viewMonth);
      const creditTotal = CREDIT_TYPES.reduce((s, ct) => s + (creditParType[ct] || 0), 0);
      const declared = entries.filter(
        (e) => e.personId === m.id && e.date.slice(0, 7) === viewMonth
      );
      const montantTotal = declared.reduce((s, e) => s + (e.montant || 0), 0);
      const assuranceTotal = declared
        .filter((e) => e.type === "assurance")
        .reduce((s, e) => s + (e.quantite || 1), 0);
      // Objectif tel qu'il était réellement fixé pour le mois exporté (pas
      // l'objectif courant) — voir resolveObjectivesForMonth.
      const { objA, objC, objM } = resolveObjectivesForMonth(m, viewMonth);
      return {
        "Collaborateur": m.name,
        "E-mail": m.email,
        "Assurances": assuranceTotal,
        "Objectif assurances": objA,
        ...Object.fromEntries(CREDIT_TYPES.map((ct) => [`${ct} (montant €)`, creditParType[ct] || 0])),
        ...Object.fromEntries(CREDIT_TYPES.map((ct) => [`${ct} (nombre)`, creditCountParType[ct] || 0])),
        "Total crédits (montant €)": creditTotal,
        "Objectif crédits": objC,
        "Montant vendu (journal assurances)": montantTotal,
        "Objectif montant (€)": objM,
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
      {/* Masqués pendant l'édition d'un collaborateur (regroupés dans la
          barre flottante de MainApp à la place — voir focusMode) : la
          navigation par mois / export, "Objectifs généraux" et "Vue
          d'ensemble" n'apportent rien pendant qu'on remplit une fiche. */}
      {!editing && (
      <>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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
            disabled={saving}
          />
        </div>
      )}

      {isManager && isCurrentMonth && collaborators.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <ClipboardList size={15} style={{ color: MANAGER_ACCENT }} /> Aujourd'hui — à valider
            </h2>
            {todayPending.length > 0 && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: MANAGER_ACCENT_SOFT, color: MANAGER_ACCENT }}>
                {todayPending.length} collaborateur{todayPending.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs mb-3" style={{ color: THEME.navySoft }}>
            Ce que l'équipe a déclaré aujourd'hui, tous collaborateurs confondus — pour ne pas avoir à ouvrir chaque fiche une à une.
          </p>
          {todayPending.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: THEME.navySoft }}>
              Aucune vente déclarée aujourd'hui pour l'équipe.
            </p>
          ) : (
            <div className="space-y-1.5">
              {todayPending.map(({ member, assuranceCount, creditCount, creditMontant }) => (
                <button
                  key={member.id}
                  onClick={() => setSelectedMemberId(member.id)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors hover:brightness-[0.98]"
                  style={{ background: THEME.bg }}
                >
                  <span className="font-medium truncate">{member.name}</span>
                  <span className="flex items-center gap-2 flex-shrink-0 text-xs">
                    {assuranceCount > 0 && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: THEME.tealSoft, color: THEME.teal }}>
                        <Shield size={11} /> {assuranceCount}
                      </span>
                    )}
                    {creditCount > 0 && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: THEME.amberSoft, color: THEME.amber }}>
                        <CreditCard size={11} /> {creditCount} · {formatEUR(creditMontant)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isManager && collaborators.length > 0 && (
        // Pendant l'édition d'un collaborateur (isEditing), cette section se
        // condense (moins de padding, description/recherche/liste masquées,
        // seul le sélecteur reste) pour laisser un maximum d'espace à la
        // zone de saisie ci-dessous.
        <div className={editing ? "rounded-2xl p-3" : "rounded-2xl p-5"} style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h2 className="text-sm font-semibold">
              Vue d'ensemble — {collaborators.length} collaborateur{collaborators.length > 1 ? "s" : ""}
            </h2>
            {isCurrentMonth && (
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {statusCounts.retard > 0 && (
                  <span className="font-semibold px-2 py-1 rounded-full" style={{ background: THEME.redSoft, color: THEME.red }}>
                    {statusCounts.retard} en retard
                  </span>
                )}
                {statusCounts.a_jour > 0 && (
                  <span className="font-medium px-2 py-1 rounded-full" style={{ background: THEME.tealSoft, color: THEME.teal }}>
                    {statusCounts.a_jour} à jour
                  </span>
                )}
                {statusCounts.neutre > 0 && (
                  <span className="font-medium px-2 py-1 rounded-full" style={{ background: THEME.line, color: THEME.navySoft }}>
                    {statusCounts.neutre} sans objectif
                  </span>
                )}
              </div>
            )}
          </div>
          {!editing && (
            <p className="text-xs mb-3" style={{ color: THEME.navySoft }}>
              Choisissez un collaborateur pour afficher son détail (objectifs, graphique, saisie des crédits) — la liste reste lisible même avec une grande équipe.
            </p>
          )}
          <div className={`flex flex-col sm:flex-row gap-2 ${editing ? "mt-2" : "mb-3"}`}>
            {!editing && (
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Rechercher un nom ou un e-mail…"
                aria-label="Rechercher un collaborateur"
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                style={{ border: `1px solid ${THEME.line}` }}
              />
            )}
            <select
              value={selectedMemberId || ""}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              aria-label="Choisir un collaborateur"
              className={`px-3 py-2 rounded-lg text-sm flex-shrink-0 ${editing ? "w-full" : "sm:w-64"}`}
              style={{ border: `1px solid ${THEME.line}`, background: THEME.card }}
            >
              <option value="" disabled>Choisir un collaborateur</option>
              {summaries.map((s) => (
                <option key={s.member.id} value={s.member.id}>
                  {s.member.name}
                  {isCurrentMonth && s.status.key !== "neutre" ? ` — ${s.status.label}` : ""}
                </option>
              ))}
            </select>
          </div>
          {!editing && (
            filteredSummaries.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: THEME.navySoft }}>
                Aucun collaborateur ne correspond à la recherche.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-0.5">
                {filteredSummaries.map((s) => {
                  const active = s.member.id === selectedMemberId;
                  return (
                    <button
                      key={s.member.id}
                      type="button"
                      onClick={() => setSelectedMemberId(s.member.id)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-colors"
                      style={{
                        background: THEME.bg,
                        borderLeft: active ? `3px solid ${MANAGER_ACCENT}` : "3px solid transparent",
                      }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.member.name}</div>
                        <div className="text-xs truncate" style={{ color: THEME.navySoft }}>{s.member.email}</div>
                      </div>
                      <StatusBadge status={s.status} />
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
      </>
      )}

      {isManager ? (
        collaborators.length === 0 ? (
          <p className="text-sm text-center py-10" style={{ color: THEME.navySoft }}>
            Aucun collaborateur pour l'instant.
          </p>
        ) : (
          selectedMember && (
            <MemberDetailCard
              key={selectedMember.id}
              member={selectedMember}
              session={session}
              isManager={isManager}
              mKey={mKey}
              viewMonth={viewMonth}
              isCurrentMonth={isCurrentMonth}
              entries={entries}
              monthFigures={monthFigures}
              creditRecords={creditRecords}
              editingId={editing}
              setEditing={setEditing}
              objDraft={objDraft}
              setObjDraft={setObjDraft}
              objByTypeDraft={objByTypeDraft}
              setObjByTypeDraft={setObjByTypeDraft}
              creditDate={creditDate}
              creditDraft={creditDraft}
              setCreditDraft={setCreditDraft}
              startEdit={startEdit}
              changeCreditDate={changeCreditDate}
              saveEdit={saveEdit}
              saveCreditRecords={saveCreditRecords}
              saving={saving}
              notify={notify}
              setTab={setTab}
            />
          )
        )
      ) : visibleMembers.length === 0 ? (
        <p className="text-sm text-center py-10" style={{ color: THEME.navySoft }}>
          Aucun collaborateur pour l'instant.
        </p>
      ) : (
        visibleMembers.map((member) => (
          <MemberDetailCard
            key={member.id}
            member={member}
            session={session}
            isManager={isManager}
            mKey={mKey}
            viewMonth={viewMonth}
            isCurrentMonth={isCurrentMonth}
            entries={entries}
            monthFigures={monthFigures}
            creditRecords={creditRecords}
            editingId={editing}
            setEditing={setEditing}
            objDraft={objDraft}
            setObjDraft={setObjDraft}
            objByTypeDraft={objByTypeDraft}
            setObjByTypeDraft={setObjByTypeDraft}
            creditDate={creditDate}
            creditDraft={creditDraft}
            setCreditDraft={setCreditDraft}
            startEdit={startEdit}
            changeCreditDate={changeCreditDate}
            saveEdit={saveEdit}
            saveCreditRecords={saveCreditRecords}
            saving={saving}
          />
        ))
      )}
    </div>
  );
}

// Puce de statut de rythme (vue d'ensemble responsable) — couleur sémantique
// cohérente avec le reste de l'app (rouge = retard, teal = à jour).
function StatusBadge({ status }) {
  const styles = {
    retard: { bg: THEME.redSoft, color: THEME.red },
    a_jour: { bg: THEME.tealSoft, color: THEME.teal },
    neutre: { bg: THEME.line, color: THEME.navySoft },
    archive: { bg: THEME.line, color: THEME.navySoft },
  };
  const s = styles[status.key] || styles.neutre;
  return (
    <span
      className="text-[11px] font-semibold px-2 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {status.label}
    </span>
  );
}

// Réinitialisation du mot de passe d'un collaborateur — bouton + prompt
// inline demandant le code responsable, factorisé pour être utilisé aussi
// bien depuis "Équipe" (liste complète) que depuis la carte détaillée d'un
// collaborateur dans "Suivi & objectifs" (action rapide sans changer
// d'onglet). `compact` ajuste juste le libellé du bouton pour s'intégrer
// à un en-tête de carte plutôt qu'à une ligne de liste.
function ResetPasswordControl({ member, notify, compact = false }) {
  const [armed, setArmed] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = () => {
    setArmed(true);
    setCode("");
    setError("");
  };
  const cancel = () => {
    setArmed(false);
    setCode("");
    setError("");
  };
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await resetMemberPassword(member.id, code);
      notify(`Mot de passe réinitialisé — ${member.name} pourra en créer un nouveau à sa prochaine connexion.`);
      cancel();
    } catch (e) {
      if (e.message === "manager_code_required") setError("Code d'accès responsable incorrect.");
      else if (e.message === "too_many_attempts") setError("Trop de tentatives — réessayez dans quelques minutes.");
      else setError(`Échec de la réinitialisation (${e.message}).`);
    }
    setBusy(false);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => (armed ? cancel() : start())}
        className={compact ? "flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg flex-shrink-0" : "p-2 rounded-md flex-shrink-0"}
        style={compact ? { background: armed ? MANAGER_ACCENT_SOFT : THEME.bg, color: armed ? MANAGER_ACCENT : THEME.navySoft } : {}}
        aria-label="Réinitialiser le mot de passe"
        title="Réinitialiser le mot de passe"
      >
        <KeyRound size={compact ? 13 : 14} style={{ color: compact ? undefined : (armed ? MANAGER_ACCENT : THEME.navySoft) }} />
        {compact && "Mot de passe"}
      </button>
      {armed && (
        <div className="pt-2 flex items-center gap-2 flex-wrap">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code d'accès responsable"
            className="flex-1 min-w-[10rem] px-2.5 py-1.5 rounded-lg text-xs"
            style={{ border: `1px solid ${THEME.line}`, background: THEME.card }}
          />
          <button
            type="button"
            onClick={confirm}
            disabled={busy || !code}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: MANAGER_ACCENT }}
          >
            Réinitialiser
          </button>
          <button type="button" onClick={cancel} className="px-2 py-1.5 rounded-lg text-xs" style={{ color: THEME.navySoft }}>
            Annuler
          </button>
          {error && (
            <div className="w-full text-xs flex items-center gap-1" style={{ color: THEME.red }}>
              <AlertCircle size={12} /> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Carte détaillée d'un collaborateur (objectifs, graphique, saisie des
// crédits) — un seul rendu à la fois côté responsable (celui sélectionné
// dans la vue d'ensemble), toujours affiché directement côté collaborateur
// (qui ne voit que son propre profil).
function MemberDetailCard({
  member, session, isManager, mKey, viewMonth, isCurrentMonth, entries, monthFigures, creditRecords,
  editingId, setEditing, objDraft, setObjDraft, objByTypeDraft, setObjByTypeDraft,
  creditDate, creditDraft, setCreditDraft, startEdit, changeCreditDate, saveEdit, saveCreditRecords, saving,
  notify, setTab,
}) {
  const isEditing = editingId === member.id;
  const metrics = computeMemberMetrics(member, entries, monthFigures, creditRecords, viewMonth);
  const {
    objA, objC, objM, declared, todayForMember, montantRealise, resteM,
    assuranceRealiseParType, creditRealiseParType, creditCountParType,
    creditTotal, creditCountTotal, resteC, assuranceRealise, resteA,
    objectifsAssuranceParType, objectifsCreditParType, hasProduitObjectifs,
  } = metrics;
  const status = memberPaceStatus(metrics, isCurrentMonth);

  // Accordéon des produits crédit (saisie du jour) : un seul type de
  // crédit dévoile ses champs à la fois, pour éviter d'afficher les 6
  // produits en même temps. Repli des "objectifs par produit" (optionnels,
  // moins consultés) par défaut, dépliés via un bouton.
  const [expandedCreditType, setExpandedCreditType] = useState(null);
  const [showProduitObjectifs, setShowProduitObjectifs] = useState(false);

  // Message de relance pré-rempli (copié dans le presse-papier, à coller où
  // le responsable veut — e-mail, WhatsApp, SMS…) : reprend ce qu'il reste
  // à faire pour atteindre l'objectif du mois, sans jamais l'envoyer
  // automatiquement.
  const copyReminder = async () => {
    const manques = [];
    if (resteA > 0) manques.push(`${resteA} assurance${resteA > 1 ? "s" : ""}`);
    if (resteC > 0) manques.push(`${resteC} crédit${resteC > 1 ? "s" : ""}`);
    const detail = manques.length > 0 ? manques.join(" et ") : "votre objectif";
    const message = `Bonjour ${member.name.split(" ")[0]}, petit rappel : il vous reste ${detail} à réaliser pour atteindre l'objectif de ce mois (${daysLeftInMonth()} jour${daysLeftInMonth() > 1 ? "s" : ""} restant${daysLeftInMonth() > 1 ? "s" : ""}). N'hésitez pas si vous avez besoin d'aide !`;
    try {
      await navigator.clipboard.writeText(message);
      notify?.("Message de relance copié dans le presse-papier.");
    } catch {
      notify?.("Impossible de copier le message — copiez-le manuellement.", true);
    }
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
      <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${THEME.line}` }}>
        <div>
          <div className="font-semibold text-sm">{member.name}</div>
          <div className="text-xs" style={{ color: THEME.navySoft }}>{member.email}</div>
        </div>
        {isManager && !isEditing && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {isCurrentMonth && status.key === "retard" && (
              <button
                onClick={copyReminder}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg flex-shrink-0"
                style={{ background: THEME.redSoft, color: THEME.red }}
                title="Copier un message de relance pré-rempli"
              >
                <Copy size={13} /> Relancer
              </button>
            )}
            <button
              onClick={() => setTab?.("journal")}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg flex-shrink-0"
              style={{ background: THEME.bg, color: THEME.navySoft }}
              title="Voir le journal de ce collaborateur"
            >
              <Calendar size={13} /> Journal
            </button>
            <ResetPasswordControl member={member} notify={notify} compact />
            <button
              onClick={() => startEdit(member)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-90 flex-shrink-0"
              style={{ background: MANAGER_ACCENT, color: "#fff" }}
            >
              <Pencil size={13} /> Mettre à jour
            </button>
          </div>
        )}
      </div>

      <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          label="Crédits (contrats)"
          value={creditCountTotal}
          objective={objC}
          reste={resteC}
          color={THEME.amber}
          colorSoft={THEME.amberSoft}
          editing={isEditing}
          onChangeObjective={(v) => setObjDraft((o) => ({ ...o, objectifCredit: v }))}
          draftObjective={objDraft.objectifCredit}
          readOnlyValue
          isCurrentMonth={isCurrentMonth}
          sublabel={`${formatEUR(creditTotal)} financés`}
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

      {isCurrentMonth && !isManager && (
        <div className="px-5 pb-5">
          <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: THEME.navySoft }}>
            <Calendar size={13} /> Récapitulatif du jour
          </div>
          <RecapGrid entries={todayForMember} />
        </div>
      )}

      {/* Masqué pendant l'édition : libère de l'espace pour la saisie des
          crédits/objectifs, le graphique n'apportant rien à ce moment-là. */}
      {!isEditing && (
        <div className="px-5 pb-5">
          <PerformanceChart
            entries={entries}
            creditRecords={creditRecords}
            lines={
              isManager
                ? [
                    { key: "self", personId: member.id, label: member.name, color: THEME.yellow },
                    { key: "team", personId: null, label: "Équipe DirectSales", color: THEME.navy },
                  ]
                : [{ key: "self", personId: member.id, label: member.name, color: THEME.yellow }]
            }
          />
        </div>
      )}

      {isEditing && (
        <div className="px-5 pb-5">
          <div
            className="rounded-xl p-3.5 mb-5"
            style={{ background: THEME.amberSoft, border: `1px solid ${THEME.amber}30` }}
          >
            <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: THEME.navy }}>
              <CreditCard size={13} style={{ color: THEME.amber }} /> Crédits financés — saisie du jour
            </div>
            <p className="text-xs mb-3" style={{ color: THEME.navySoft }}>
              À remplir chaque jour : pour chaque type financé, le nombre de dossiers et le montant total. Choisir une autre date recharge (et permet de corriger) la saisie de ce jour-là.
            </p>
            <label className="block mb-3">
              <span className="block text-xs font-medium mb-1" style={{ color: THEME.navySoft }}>Date</span>
              <input
                type="date"
                value={creditDate}
                min={`${mKey}-01`}
                max={todayISO()}
                onChange={(e) => changeCreditDate(member, e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ border: `1px solid ${THEME.line}`, background: THEME.card }}
              />
            </label>
            {/* Accordéon : un seul produit dévoile ses champs à la fois
                (bouton d'en-tête), pour éviter les 6 blocs ouverts en même
                temps. Un point rempli sur l'en-tête indique un produit déjà
                saisi pour ce jour, visible même replié. */}
            <div className="space-y-1.5 mb-3">
              {CREDIT_TYPES.map((ct) => {
                const isOpen = expandedCreditType === ct;
                const filled = CONTRACT_MODE_CREDIT_TYPES.includes(ct)
                  ? CONTRACT_MODES.some((mode) => (creditDraft[ct][mode].nombre || 0) > 0 || (creditDraft[ct][mode].montant || 0) > 0)
                  : (creditDraft[ct].nombre || 0) > 0 || (creditDraft[ct].montant || 0) > 0;
                return (
                  <div key={ct} className="rounded-lg overflow-hidden" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
                    <button
                      type="button"
                      onClick={() => setExpandedCreditType((c) => (c === ct ? null : ct))}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold"
                    >
                      <span className="flex items-center gap-1.5">
                        {filled && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: THEME.amber }} />}
                        {ct}
                      </span>
                      <ChevronRight size={13} style={{ color: THEME.navySoft, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3">
                        {CONTRACT_MODE_CREDIT_TYPES.includes(ct) ? (
                          <div className="space-y-2">
                            {CONTRACT_MODES.map((mode) => (
                              <div key={mode}>
                                <div className="text-[10px] font-medium mb-1" style={{ color: THEME.navySoft }}>{mode}</div>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="block">
                                    <span className="block text-[10px] mb-1" style={{ color: THEME.navySoft }}>Nombre</span>
                                    <input
                                      type="number"
                                      min="0"
                                      value={creditDraft[ct][mode].nombre}
                                      onChange={(e) =>
                                        setCreditDraft((d) => ({
                                          ...d,
                                          [ct]: { ...d[ct], [mode]: { ...d[ct][mode], nombre: Number(e.target.value) || 0 } },
                                        }))
                                      }
                                      className="w-full px-2 py-1.5 rounded-lg text-sm text-center"
                                      style={{ border: `1px solid ${THEME.line}` }}
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="block text-[10px] mb-1" style={{ color: THEME.navySoft }}>Montant (€)</span>
                                    <input
                                      type="number"
                                      min="0"
                                      value={creditDraft[ct][mode].montant}
                                      onChange={(e) =>
                                        setCreditDraft((d) => ({
                                          ...d,
                                          [ct]: { ...d[ct], [mode]: { ...d[ct][mode], montant: Number(e.target.value) || 0 } },
                                        }))
                                      }
                                      className="w-full px-2 py-1.5 rounded-lg text-sm text-center"
                                      style={{ border: `1px solid ${THEME.line}` }}
                                    />
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="block text-[10px] mb-1" style={{ color: THEME.navySoft }}>Nombre</span>
                              <input
                                type="number"
                                min="0"
                                value={creditDraft[ct].nombre}
                                onChange={(e) =>
                                  setCreditDraft((d) => ({ ...d, [ct]: { ...d[ct], nombre: Number(e.target.value) || 0 } }))
                                }
                                className="w-full px-2 py-1.5 rounded-lg text-sm text-center"
                                style={{ border: `1px solid ${THEME.line}` }}
                              />
                            </label>
                            <label className="block">
                              <span className="block text-[10px] mb-1" style={{ color: THEME.navySoft }}>Montant (€)</span>
                              <input
                                type="number"
                                min="0"
                                value={creditDraft[ct].montant}
                                onChange={(e) =>
                                  setCreditDraft((d) => ({ ...d, [ct]: { ...d[ct], montant: Number(e.target.value) || 0 } }))
                                }
                                className="w-full px-2 py-1.5 rounded-lg text-sm text-center"
                                style={{ border: `1px solid ${THEME.line}` }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => saveCreditRecords(member)}
              disabled={saving}
              className="sc-btn w-full py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-1.5"
              style={{ background: THEME.amber }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Enregistrer les crédits du {new Date(creditDate + "T00:00:00").toLocaleDateString("fr-FR")}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowProduitObjectifs((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-xs font-medium mb-2"
            style={{ color: THEME.navySoft }}
          >
            <span>Objectifs par produit (optionnel)</span>
            <ChevronRight size={13} style={{ transform: showProduitObjectifs ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {showProduitObjectifs && (
            <>
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
            </>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => saveEdit(member)}
              disabled={saving}
              className="sc-btn flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
              style={{ background: MANAGER_ACCENT }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Enregistrer les objectifs
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
                const count = creditCountParType[ct] || 0;
                const atteint = real >= obj;
                return (
                  <div key={`c-${ct}`} className="text-xs px-2 py-2 rounded-lg" style={{ background: THEME.bg }}>
                    <div className="font-semibold flex items-center gap-1">
                      {ct} {atteint && <CheckCircle2 size={11} style={{ color: THEME.amber }} />}
                    </div>
                    <div style={{ color: THEME.navySoft }}>{formatEUR(real)} / {formatEUR(obj)}</div>
                    <div style={{ color: THEME.navySoft }}>{count} dossier{count !== 1 ? "s" : ""}</div>
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
}

function ProgressBlock({ icon: Icon, label, value, objective, reste, color, colorSoft, editing, onChangeValue, onChangeObjective, draftValue, draftObjective, readOnlyValue, format = (v) => v, isCurrentMonth = true, sublabel }) {
  const pct = objective > 0 ? Math.min(100, Math.round((value / objective) * 100)) : 0;
  // Sans objectif fixé (0), "reste" tombe toujours à 0 : ne pas afficher un
  // "Objectif atteint" trompeur quand il n'y a en réalité aucun objectif.
  const atteint = objective > 0 && reste === 0;
  // Couleur de la jauge conditionnée à la progression réelle (pas seulement
  // à la couleur "thème" du bloc) : rouge en dessous de 50%, orange entre
  // 50 et 99%, vert dès l'objectif atteint — un repère visuel immédiat
  // indépendant du produit concerné. Sans objectif fixé, on garde la
  // couleur neutre du bloc plutôt qu'un rouge qui n'aurait pas de sens.
  const gauge =
    objective <= 0
      ? { fill: color, track: colorSoft }
      : pct >= 100
      ? { fill: THEME.teal, track: THEME.tealSoft }
      : pct >= 50
      ? { fill: THEME.amber, track: THEME.amberSoft }
      : { fill: THEME.red, track: THEME.redSoft };
  // Projection de fin de mois : extrapole le rythme actuel (réalisé ÷
  // fraction du mois déjà écoulée) — permet de repérer, tôt dans le mois,
  // qui n'atteindra pas son objectif au rythme actuel plutôt que de
  // l'apprendre le 28. Uniquement sur le mois en cours, hors édition, et
  // seulement tant que l'objectif n'est pas déjà atteint.
  let projectedPct = null;
  if (isCurrentMonth && !editing && objective > 0 && !atteint) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsedFraction = now.getDate() / daysInMonth;
    if (elapsedFraction > 0) {
      projectedPct = Math.min(999, Math.round((value / elapsedFraction / objective) * 100));
    }
  }
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

      <div className="h-2.5 rounded-full overflow-hidden mb-2" style={{ background: gauge.track }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: gauge.fill }} />
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
      {projectedPct !== null && (
        <div className="text-xs mt-1" style={{ color: projectedPct >= 100 ? THEME.teal : THEME.navySoft }}>
          À ce rythme : ~{projectedPct}&nbsp;% en fin de mois
        </div>
      )}
      {sublabel && (
        <div className="text-xs mt-1" style={{ color: THEME.navySoft }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

// Graphique linéaire de performance (dossiers vendus, ou crédits financés
// si creditRecords est fourni) d'un collaborateur — bascule
// Assurances/Crédits (si creditRecords fourni) + Jour/Semaine/Mois/Année,
// survol avec repère + infobulle, et un détail sous forme de tableau
// (accessible sans passer par la souris).
function PerformanceChart({ entries, creditRecords, lines }) {
  const [granularity, setGranularity] = useState("mois");
  const [metric, setMetric] = useState("assurances"); // "assurances" | "credits"
  const [hoverIdx, setHoverIdx] = useState(null);
  const showMetricToggle = !!creditRecords;
  const isCredits = showMetricToggle && metric === "credits";
  const format = isCredits ? formatEUR : (v) => v;
  const title = isCredits ? "Performance — crédits financés" : "Performance — assurances vendues";

  const linesData = useMemo(
    () =>
      lines.map((l) => ({
        ...l,
        data: isCredits
          ? creditPerformanceSeries(creditRecords, l.personId, granularity)
          : performanceSeries(entries, l.personId, granularity),
      })),
    [entries, creditRecords, isCredits, lines, granularity]
  );

  const W = 600;
  const H = 168;
  const padL = 22;
  const padR = 22;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = linesData[0].data.length;
  const maxVal = Math.max(1, ...linesData.flatMap((l) => l.data.map((b) => b.value)));
  const multi = linesData.length > 1;

  const xFor = (i) => (n > 1 ? padL + (i * plotW) / (n - 1) : padL + plotW / 2);
  const yFor = (v) => padT + plotH - (v / maxVal) * plotH;

  const linesGeom = linesData.map((l) => {
    const points = l.data.map((b, i) => ({ x: xFor(i), y: yFor(b.value), ...b }));
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return { ...l, points, linePath };
  });
  const areaPath = !multi
    ? `${linesGeom[0].linePath} L ${linesGeom[0].points[n - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L ${linesGeom[0].points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`
    : null;

  const activeIdx = hoverIdx;
  const bucket = linesData[0].data;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(frac * (n - 1)));
  };

  // Un point sur deux (ou moins) reçoit une étiquette d'axe pour éviter le
  // chevauchement quand il y a beaucoup de périodes (ex. 14 jours).
  const labelEvery = n > 8 ? 2 : 1;

  const ariaLabel = `Évolution des ${isCredits ? "crédits financés" : "assurances vendues"} ${
    multi ? `— ${linesGeom.map((l) => l.label).join(" et ")}` : linesGeom[0].personId ? `par ${linesGeom[0].label}` : "pour toute l'équipe"
  }, par ${granularity}`;

  return (
    <div className="rounded-xl p-4" style={{ background: THEME.bg }}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: THEME.navySoft }}>
          <BarChart3 size={14} style={{ color: linesGeom[0].color }} /> {title}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showMetricToggle && (
            <div className="flex gap-1 rounded-lg p-0.5" style={{ background: THEME.card }}>
              {[{ key: "assurances", label: "Assurances" }, { key: "credits", label: "Crédits" }].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setMetric(m.key);
                    setHoverIdx(null);
                  }}
                  className="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
                  style={{
                    background: metric === m.key ? MANAGER_ACCENT : "transparent",
                    color: metric === m.key ? "#fff" : THEME.navySoft,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
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
      </div>

      {multi && <ChartLegend lines={linesGeom} />}

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "auto" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label={ariaLabel}
        >
          <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={THEME.line} strokeWidth="1" />
          {areaPath && <path d={areaPath} fill={linesGeom[0].color} opacity="0.1" stroke="none" />}

          {activeIdx !== null && (
            <line x1={xFor(activeIdx)} y1={padT} x2={xFor(activeIdx)} y2={padT + plotH} stroke={THEME.navySoft} strokeWidth="1" opacity="0.35" />
          )}

          {linesGeom.map((l) => (
            <path key={l.key} d={l.linePath} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {linesGeom.map((l) => {
            const last = l.points[n - 1];
            const activePoint = activeIdx !== null ? l.points[activeIdx] : null;
            return (
              <g key={l.key}>
                <circle cx={last.x} cy={last.y} r="5" fill={l.color} stroke={THEME.bg} strokeWidth="2" />
                {activePoint && activePoint !== last && (
                  <circle cx={activePoint.x} cy={activePoint.y} r="5" fill={l.color} stroke={THEME.bg} strokeWidth="2" />
                )}
              </g>
            );
          })}

          {bucket.map((b, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={b.startISO} x={xFor(i)} y={H - 6} fontSize="9" textAnchor="middle" fill={THEME.navySoft}>
                {b.label}
              </text>
            ) : null
          )}
        </svg>

        {activeIdx !== null && (
          <div
            className="absolute top-0 px-2.5 py-1.5 rounded-lg text-xs shadow-md pointer-events-none"
            style={{
              left: `${Math.min(92, Math.max(8, (xFor(activeIdx) / W) * 100))}%`,
              transform: "translateX(-50%)",
              background: THEME.navy,
              color: "#fff",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ color: "rgba(255,255,255,0.7)" }}>{bucket[activeIdx].fullLabel}</div>
            {linesGeom.map((l) => (
              <div key={l.key} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: l.color }} />
                <span className="font-semibold" style={{ fontFamily: FONT_DISPLAY }}>{format(l.points[activeIdx].value)}</span>
                {multi && <span style={{ color: "rgba(255,255,255,0.7)" }}>{l.label}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {!multi ? (
        <div className="text-xs mt-1" style={{ color: THEME.navySoft }}>
          Total sur la période : <strong style={{ color: THEME.navy }}>{format(linesGeom[0].data.reduce((s, b) => s + b.value, 0))}</strong>
        </div>
      ) : (
        <div className="flex items-center gap-4 flex-wrap text-xs mt-1" style={{ color: THEME.navySoft }}>
          {linesGeom.map((l) => (
            <div key={l.key} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: l.color }} />
              Total {l.label} : <strong style={{ color: THEME.navy }}>{format(l.data.reduce((s, b) => s + b.value, 0))}</strong>
            </div>
          ))}
        </div>
      )}
      <PerformanceTable buckets={bucket} lines={linesGeom} format={format} />
    </div>
  );
}

// Puces couleur + libellé, une par série — n'apparaît que si le graphique
// affiche plusieurs séries (jamais pour une seule courbe).
function ChartLegend({ lines }) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-1.5">
      {lines.map((l) => (
        <div key={l.key} className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: THEME.navySoft }}>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.color }} />
          {l.label}
        </div>
      ))}
    </div>
  );
}

// Version tabulaire des mêmes données, repliée par défaut — équivalent
// accessible du graphique (lecteur d'écran, sans survol nécessaire).
// Chaque puce affiche la valeur de chaque série (avec pastille couleur si
// plusieurs séries) pour la période correspondante.
function PerformanceTable({ buckets, lines, format = (v) => v }) {
  const multi = lines.length > 1;
  return (
    <details className="mt-1">
      <summary className="text-xs cursor-pointer font-medium" style={{ color: THEME.navySoft }}>
        Détail chiffré par période
      </summary>
      <div className={`mt-2 grid gap-1.5 ${multi ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}>
        {buckets.map((b, i) => (
          <div key={b.startISO} className="text-xs px-2 py-1.5 rounded-lg text-center" style={{ background: THEME.card }}>
            <div style={{ color: THEME.navySoft }}>{b.label}</div>
            {!multi ? (
              <div className="font-semibold mt-0.5" style={{ color: THEME.navy, fontVariantNumeric: "tabular-nums" }}>
                {format(lines[0].data[i].value)}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 mt-0.5">
                {lines.map((l) => (
                  <div key={l.key} className="flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: l.color }} />
                    <span className="font-semibold" style={{ color: THEME.navy, fontVariantNumeric: "tabular-nums" }}>{format(l.data[i].value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/* ---------------- CLASSEMENT TAB (visible responsable + collaborateur) ---------------- */
// Classement du mois en cours, trié par crédits financés (le chiffre
// officiel validé par le responsable) — se met donc à jour dès que le
// responsable enregistre une saisie de crédits du jour. Assurances et
// montant vendu (déclarés par le collaborateur) restent affichés à titre
// de repère, sans entrer dans le tri.
function ClassementTab({ members, entries, figures, creditRecords, mKey }) {
  const collaborators = members.filter((m) => m.role === "collaborateur");
  const monthFigures = figures[mKey] || {};

  const ranked = useMemo(
    () =>
      collaborators
        .map((m) => {
          const f = monthFigures[m.id] || emptyFigures();
          const declared = entries.filter((e) => e.personId === m.id && e.date.slice(0, 7) === mKey);
          const assurances = declared.filter((e) => e.type === "assurance").reduce((s, e) => s + (e.quantite || 1), 0);
          const creditParType = creditRealiseParTypeFor(f, creditRecords, m.id, mKey);
          const creditsTotal = CREDIT_TYPES.reduce((s, ct) => s + (creditParType[ct] || 0), 0);
          return { member: m, assurances, creditsTotal };
        })
        .sort((a, b) => b.creditsTotal - a.creditsTotal),
    [collaborators, entries, monthFigures, creditRecords, mKey]
  );

  const medal = (i) => (i === 0 ? "#D4AF37" : i === 1 ? "#9AA0A6" : i === 2 ? "#B08D57" : null);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: THEME.navy, color: "#fff" }}>
        <Trophy size={18} style={{ color: THEME.yellow }} />
        <div className="text-sm">
          Classement — <span className="capitalize">{monthLabel()}</span> · trié par crédits financés
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          <p className="text-sm" style={{ color: THEME.navySoft }}>
            Aucun collaborateur pour l'instant.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: THEME.card, border: `1px solid ${THEME.line}` }}>
          {ranked.map((r, i) => (
            <div
              key={r.member.id}
              className="flex items-center gap-3 px-5 py-4 flex-wrap sm:flex-nowrap transition-colors hover:brightness-[0.98]"
              style={{
                borderBottom: i < ranked.length - 1 ? `1px solid ${THEME.line}` : "none",
                background: i === 0 ? `${THEME.yellowSoft}` : "transparent",
              }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: medal(i) || THEME.bg, color: medal(i) ? "#fff" : THEME.navySoft }}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{r.member.name}</div>
                <div className="text-xs truncate" style={{ color: THEME.navySoft }}>
                  {r.member.email}
                </div>
              </div>
              <div className="flex items-center gap-5 flex-shrink-0 text-right ml-11 sm:ml-0">
                <div>
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: THEME.navySoft }}>
                    Assurances
                  </div>
                  <div className="text-base font-semibold" style={{ fontFamily: FONT_DISPLAY, color: THEME.teal }}>
                    {r.assurances}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: THEME.navySoft }}>
                    Crédits financés
                  </div>
                  <div className="text-base font-semibold" style={{ fontFamily: FONT_DISPLAY, color: THEME.amber }}>
                    {formatEUR(r.creditsTotal)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [inviteBusy, setInviteBusy] = useState(false);

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
    if (inviteBusy) return; // évite un double envoi (double-clic, réseau lent)
    setInviteError("");
    const em = inviteEmail.trim().toLowerCase();
    if (!em || !inviteName.trim()) return setInviteError("Renseignez le nom et l'e-mail du collaborateur à inviter.");
    if (members.find((m) => m.email.toLowerCase() === em)) return setInviteError("Un compte existe déjà avec cet e-mail.");
    if (pendingInvites.find((i) => i.email.toLowerCase() === em)) return setInviteError("Une invitation est déjà en attente pour cet e-mail.");
    setInviteBusy(true);
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
    setInviteBusy(false);
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
            disabled={inviteBusy}
            className="sc-btn px-3.5 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: MANAGER_ACCENT }}
          >
            {inviteBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Générer le lien
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
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
          <Users size={15} style={{ color: MANAGER_ACCENT }} /> Collaborateurs ({collaborators.length})
        </h2>
        <p className="text-xs mb-3" style={{ color: THEME.navySoft }}>
          Chaque collaborateur protège son profil par un mot de passe personnel. En cas d'oubli, l'icône <KeyRound size={11} className="inline align-text-top" /> réinitialise son mot de passe (il en recrée un nouveau à sa prochaine connexion) — ses ventes, objectifs et crédits financés restent intacts.
        </p>
        {collaborators.length === 0 ? (
          <p className="text-sm py-4" style={{ color: THEME.navySoft }}>
            Aucun collaborateur n'a encore créé de compte. Ils apparaîtront ici dès leur première connexion.
          </p>
        ) : (
          <div className="space-y-2">
            {collaborators.map((m) => (
              <div key={m.id} className="rounded-lg px-3 py-2.5" style={{ background: THEME.bg }}>
                <div className="flex items-center justify-between text-sm gap-2 flex-wrap">
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs" style={{ color: THEME.navySoft }}>{m.email}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs hidden md:inline" style={{ color: THEME.navySoft }}>
                      Obj. {m.objectifAssurance ?? 5} assur. / {m.objectifCredit ?? 5} créd. / {formatEUR(m.objectifMontant ?? 5000)}
                    </span>
                    <ResetPasswordControl member={m} notify={notify} />
                    <ConfirmActionButton onConfirm={() => removeMember(m.id)} label="Retirer" />
                  </div>
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
