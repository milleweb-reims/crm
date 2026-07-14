"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Phone,
  Mail,
  Globe,
  MapPin,
  Star,
  Clock,
  ExternalLink,
  Trash2,
  Calendar,
  CheckCircle2,
  X,
  Lock,
  UserCheck,
  Plus,
  Send,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PromptGenerator } from "@/components/prompt-generator";
import { PaymentLinkCard } from "@/components/payment-link-card";
import { SalesScript } from "@/components/sales-script";
import { cn } from "@/lib/utils";
import { PROSPECT_STATUSES, type IProspect, type IUser, type ProspectStatus, type ActivityType } from "@/types";
import { LOCK_HEARTBEAT_MS, getLockHolder } from "@/lib/lock";
import { useRealtime } from "@/hooks/use-realtime";

interface ActivityData {
  _id: string;
  type: ActivityType;
  content: string;
  userId: { name: string } | null;
  createdAt: string;
}

// Le statut en boutons : la pipeline dans l'ordre du parcours de vente,
// chaque étape reprend la couleur de sa colonne (badge & pipeline).
// Parcours de vente linéaire : on avance étape par étape, sans en sauter.
// Le retour en arrière est libre (correction) et « Pas intéressé » est une
// sortie accessible à tout moment ; on en repart par « Prospect ».
const STATUS_FLOW: ProspectStatus[] = [
  "prospect",
  "en_appel",
  "rdv",
  "lien_envoye",
];

function canTransition(from: ProspectStatus, to: ProspectStatus) {
  // « Payé » est posé par le webhook GoCardless uniquement, et une fiche
  // payée ne change plus de statut.
  if (from === "paye" || to === "paye") return false;
  if (to === "pas_interesse") return true;
  if (from === "pas_interesse") return to === "prospect";
  return STATUS_FLOW.indexOf(to) <= STATUS_FLOW.indexOf(from) + 1;
}

const DAY_LABELS_FR: Record<string, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

// Convertit les valeurs Google du type "7-am-11-pm", "7:30-am-11-pm" ou
// "730-am-6-pm" (minutes sans deux-points) en "7h – 23h" / "7h30 – 18h".
function formatHoursFr(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "closed") return "Fermé";
  if (lower === "open-24-hours" || lower === "open 24 hours") return "24h/24";

  const toFr = (h: number, min: string | undefined, meridiem: string) => {
    let hour = h % 12;
    if (meridiem === "pm") hour += 12;
    return `${hour}h${min ?? ""}`;
  };

  const match = lower.match(
    /^(\d{1,2})(?::?(\d{2}))?-(am|pm)-(\d{1,2})(?::?(\d{2}))?-(am|pm)$/
  );
  if (!match) return raw;
  const [, h1, m1, mer1, h2, m2, mer2] = match;
  return `${toFr(Number(h1), m1, mer1!)} – ${toFr(Number(h2), m2, mer2!)}`;
}

const statusPillStyles: Record<ProspectStatus, { active: string; dot: string }> = {
  prospect: { active: "border-gray-300 bg-gray-100 text-gray-700", dot: "bg-gray-400" },
  en_appel: { active: "border-amber-300 bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  rdv: { active: "border-blue-300 bg-blue-100 text-blue-700", dot: "bg-blue-400" },
  lien_envoye: { active: "border-violet-300 bg-violet-100 text-violet-700", dot: "bg-violet-400" },
  paye: { active: "border-green-300 bg-green-100 text-green-700", dot: "bg-green-500" },
  pas_interesse: { active: "border-red-300 bg-red-100 text-red-700", dot: "bg-red-400" },
};

export default function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [prospect, setProspect] = useState<IProspect | null>(null);
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [rdvModalOpen, setRdvModalOpen] = useState(false);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [savingRdv, setSavingRdv] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [rdvDateTime, setRdvDateTime] = useState("");
  // init = on décide, held = pris par un autre closer, mine = verrou acquis,
  // admin = navigation libre sans verrou (l'admin ne verrouille jamais)
  const [lockState, setLockState] = useState<"init" | "held" | "mine" | "admin">("init");
  const [lockHolder, setLockHolder] = useState<{ _id: string; name: string } | null>(null);
  // Fiche réservée (attribuée à un autre closer) : pas de prise possible
  const [reservedBy, setReservedBy] = useState<string | null>(null);
  const [closers, setClosers] = useState<IUser[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);

  const isAdmin = session?.user?.role === "admin";
  const canSeePrompt = isAdmin || session?.user?.role === "dev";

  const assigned =
    prospect?.assignedTo && typeof prospect.assignedTo === "object"
      ? prospect.assignedTo
      : null;
  const assignedId =
    assigned?._id ??
    (typeof prospect?.assignedTo === "string" ? prospect.assignedTo : null);

  const fetchData = useCallback(async () => {
    const [prospectRes, activitiesRes] = await Promise.all([
      fetch(`/api/prospects/${id}`),
      fetch(`/api/activities?prospectId=${id}`),
    ]);

    if (prospectRes.ok) setProspect(await prospectRes.json());
    if (activitiesRes.ok) setActivities(await activitiesRes.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Temps réel : paiement reçu (webhook GoCardless), modifications d'un autre
  // utilisateur... → la fiche se met à jour sans recharger la page.
  useRealtime(fetchData);

  // Prendre le prospect = acquérir le verrou côté serveur
  const takeProspect = useCallback(
    async (force = false) => {
      try {
        const res = await fetch(`/api/prospects/${id}/lock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        if (res.ok) {
          setLockHolder(null);
          // Reflète le verrou localement tout de suite : évite qu'une donnée
          // périmée (ancien détenteur) déclenche la détection de perte de verrou
          const userId = session?.user?.id;
          if (userId) {
            setProspect((p) =>
              p ? { ...p, lockedBy: userId, lockedAt: new Date() } : p
            );
          }
          setLockState("mine");
        } else if (res.status === 423) {
          const data = await res.json();
          if (data.reserved) {
            setReservedBy(data.assignedTo?.name ?? "un autre utilisateur");
          } else {
            setLockHolder(data.lockedBy ?? { _id: "", name: "un autre utilisateur" });
          }
          setLockState("held");
        }
      } catch {
        // réseau indisponible : l'overlay reste affiché, l'utilisateur peut réessayer
      }
    },
    [id, session?.user?.id]
  );

  // À l'arrivée sur la fiche : admin → navigation libre sans verrou ;
  // réservée à un autre closer → "held" sans prise possible ;
  // déjà prise par un autre → "held" ;
  // sinon → verrou acquis automatiquement dès l'ouverture de la fiche.
  useEffect(() => {
    if (lockState !== "init" || !prospect || !session?.user?.id) return;

    if (session.user.role === "admin") {
      setLockHolder(getLockHolder(prospect, session.user.id));
      setLockState("admin");
      return;
    }

    const prospectAssigned =
      prospect.assignedTo && typeof prospect.assignedTo === "object"
        ? prospect.assignedTo
        : null;
    const prospectAssignedId =
      prospectAssigned?._id ??
      (typeof prospect.assignedTo === "string" ? prospect.assignedTo : null);
    if (prospectAssignedId && prospectAssignedId !== session.user.id) {
      setReservedBy(prospectAssigned?.name ?? "un autre utilisateur");
      setLockState("held");
      return;
    }

    const holder = getLockHolder(prospect, session.user.id);
    if (holder) {
      setLockHolder(holder);
      setLockState("held");
      return;
    }

    takeProspect();
  }, [lockState, prospect, session, takeProspect]);

  // Verrou acquis : heartbeat pour le garder, libération en quittant la fiche
  // (sauf statut "en_appel" — le serveur conserve alors le verrou).
  useEffect(() => {
    if (lockState !== "mine") return;

    const heartbeat = setInterval(() => {
      fetch(`/api/prospects/${id}/lock`, { method: "POST" })
        .then(async (res) => {
          // Verrou perdu (un admin a forcé la prise) : la fiche se bloque
          if (res.status === 423) {
            const data = await res.json().catch(() => ({}));
            setLockHolder(data.lockedBy ?? { _id: "", name: "un autre utilisateur" });
            setLockState("held");
          }
        })
        .catch(() => {});
    }, LOCK_HEARTBEAT_MS);

    function releaseLock() {
      fetch(`/api/prospects/${id}/lock`, { method: "DELETE", keepalive: true }).catch(
        () => {}
      );
    }

    window.addEventListener("pagehide", releaseLock);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("pagehide", releaseLock);
      releaseLock();
    };
  }, [lockState, id]);

  // Perte du verrou détectée via le temps réel (un admin a forcé la prise) :
  // la fiche se verrouille immédiatement chez le closer qui la tenait.
  useEffect(() => {
    if (lockState !== "mine" || !prospect || !session?.user?.id) return;

    const holder = getLockHolder(prospect, session.user.id);
    if (holder) {
      setLockHolder(holder);
      setLockState("held");
    }
  }, [lockState, prospect, session?.user?.id]);

  // Bandeau admin en temps réel : le détenteur du verrou est recalculé quand la
  // fiche se rafraîchit (SSE prospect:updated émis à la prise/libération) et
  // périodiquement, car getLockHolder dépend de l'horloge (expiration du TTL
  // sans libération explicite : crash, fermeture brutale du navigateur...).
  useEffect(() => {
    if (lockState !== "admin" || !prospect) return;

    setLockHolder(getLockHolder(prospect, session?.user?.id));
    const interval = setInterval(() => {
      setLockHolder(getLockHolder(prospect, session?.user?.id));
    }, 15_000);
    return () => clearInterval(interval);
  }, [lockState, prospect, session?.user?.id]);

  // Fiche tenue par un autre : on surveille sa libération pour proposer la prise
  // (sauf fiche réservée : l'attribution ne se libère pas toute seule)
  useEffect(() => {
    if (lockState !== "held" || reservedBy) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/prospects/${id}`);
        if (!res.ok) return;
        const fresh: IProspect = await res.json();
        setProspect(fresh);
        const holder = getLockHolder(fresh, session?.user?.id);
        if (!holder) {
          setLockHolder(null);
          takeProspect();
        } else {
          setLockHolder(holder);
        }
      } catch {
        // réseau indisponible : on réessaiera au prochain tick
      }
    }, 15_000);

    return () => clearInterval(interval);
  }, [lockState, reservedBy, id, session?.user?.id]);

  // Liste des closers actifs pour le sélecteur d'attribution (admin uniquement)
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : []))
      .then((users: IUser[]) =>
        setClosers(users.filter((u) => u.role === "closer" && u.isActive))
      )
      .catch(() => {});
  }, [isAdmin]);

  async function handleStatusChange(newStatus: string) {
    // Le passage en RDV demande d'abord la date/heure du rendez-vous
    if (newStatus === "rdv") {
      setRdvDateTime("");
      setRdvModalOpen(true);
      return;
    }
    setStatusError(null);
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatusError(data.error || "Impossible de changer le statut");
    }
    fetchData();
  }

  async function handleConfirmRdv() {
    if (!rdvDateTime || savingRdv) return;
    setStatusError(null);
    setSavingRdv(true);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "rdv",
          rdvDate: new Date(rdvDateTime).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusError(data.error || "Impossible de fixer le RDV");
      }
      setRdvModalOpen(false);
      fetchData();
    } catch {
      setStatusError("Erreur réseau — réessaie");
    } finally {
      setSavingRdv(false);
    }
  }

  async function handleAssign(userId: string) {
    setStatusError(null);
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo: userId || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatusError(data.error || "Impossible d'attribuer le prospect");
    }
    fetchData();
  }

  async function handleSaveEmail() {
    const email = emailInput.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatusError("Adresse email invalide");
      return;
    }
    setSavingEmail(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusError(data.error || "Impossible d'enregistrer l'email");
      }
      setEditingEmail(false);
      fetchData();
    } catch {
      setStatusError("Erreur réseau — réessaie");
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleSendEmail() {
    if (!emailSubject.trim() || !emailMessage.trim() || sendingEmail) return;
    setSendingEmail(true);
    setEmailError(null);
    try {
      const res = await fetch(`/api/prospects/${id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: emailSubject.trim(),
          message: emailMessage.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEmailError(data.error || "Échec de l'envoi de l'email");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setEmailModalOpen(false);
      setEmailSubject("");
      setEmailMessage("");
      // Confirmation visible quelques secondes dans la carte Contact
      setEmailSentTo(data.to || prospect?.email || "");
      setTimeout(() => setEmailSentTo(null), 6000);
      fetchData();
    } catch {
      setEmailError("Erreur réseau — réessaie");
    } finally {
      setSendingEmail(false);
    }
  }

  async function handleAddActivity(type: ActivityType, content: string) {
    await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospectId: id, type, content }),
    });
    fetchData();
  }

  async function handleDelete() {
    if (!confirm("Supprimer ce prospect et tout son historique ?")) return;
    await fetch(`/api/prospects/${id}`, { method: "DELETE" });
    router.push("/prospects");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Prospect introuvable</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/prospects")}>
          Retour aux prospects
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* En-tête : retour + identité + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0"
            title="Retour aux prospects"
            onClick={() => router.push("/prospects")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground truncate">
                {prospect.name}
              </h1>
              <StatusBadge status={prospect.status as ProspectStatus} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {prospect.address?.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {prospect.address.city}
                </span>
              )}
              {prospect.reviews?.rating > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  {prospect.reviews.rating} ({prospect.reviews.count} avis)
                </span>
              )}
              {prospect.tags?.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  {tag}
                </span>
              ))}
              {!isAdmin && assigned && (
                <span className="inline-flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5" />
                  Attribué à {assigned.name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9"
            onClick={() => setScriptModalOpen(true)}
            data-test="sales-script"
          >
            <BookOpen className="h-4 w-4" />
            Script de vente
          </Button>
          {isAdmin && (
            <select
              value={assignedId ?? ""}
              onChange={(e) => handleAssign(e.target.value)}
              title="Attribuer ce prospect à un closer"
              className="h-9 rounded-lg border border-border bg-background px-2 sm:px-3 text-sm cursor-pointer"
            >
              <option value="">Non attribué</option>
              {closers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
              {/* Closer attribué absent de la liste (désactivé...) : rester affichable */}
              {assigned && !closers.some((c) => c._id === assigned._id) && (
                <option value={assigned._id}>{assigned.name}</option>
              )}
            </select>
          )}
          {isAdmin && (
            <Button variant="destructive" size="icon" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Statut : la pipeline en boutons — un clic pour changer d'étape */}
      <div
        role="group"
        aria-label="Statut du prospect"
        className="mb-6 flex flex-wrap items-center gap-1.5"
      >
        {PROSPECT_STATUSES.map((s) => {
          const isActive = prospect.status === s.value;
          const canChangeStatus =
            lockState === "mine" || lockState === "admin";
          const reachable = canTransition(
            prospect.status as ProspectStatus,
            s.value
          );
          const enabled = canChangeStatus && !isActive && reachable;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={isActive}
              disabled={!enabled}
              title={
                !isActive && !reachable
                  ? "Étape non accessible : le parcours se fait étape par étape"
                  : undefined
              }
              onClick={() => handleStatusChange(s.value)}
              data-test={`status-${s.value}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? cn(statusPillStyles[s.value].active, "shadow-sm")
                  : "border-border bg-background text-muted-foreground",
                enabled && "cursor-pointer hover:bg-muted hover:text-foreground",
                !isActive && !enabled && "opacity-40 cursor-not-allowed"
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full", statusPillStyles[s.value].dot)}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Bandeau admin : un closer est actuellement sur la fiche */}
      {lockState === "admin" && lockHolder && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            {lockHolder.name} est actuellement sur cette fiche.
          </span>
          <Button variant="destructive" size="sm" onClick={() => takeProspect(true)}>
            Forcer la prise
          </Button>
        </div>
      )}

      {/* Erreur de changement de statut (fiche verrouillée, conflit...) */}
      {statusError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {statusError}
        </div>
      )}

      {/* Infos contextuelles : paiement reçu, RDV planifié */}
      {(prospect.paidAt || prospect.rdvDate) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {prospect.paidAt && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Payé le{" "}
              {new Date(prospect.paidAt).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {prospect.paidAmount
                ? ` — ${prospect.paidAmount.toLocaleString("fr-FR")} €`
                : ""}
            </span>
          )}
          {prospect.rdvDate && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
              <Calendar className="h-4 w-4 shrink-0" />
              RDV le{" "}
              {new Date(prospect.rdvDate).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}{" "}
              à{" "}
              {new Date(prospect.rdvDate).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      )}

      {/* Devis, contact et horaires sur une même rangée, à hauteur égale */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        <PaymentLinkCard
          prospect={prospect}
          onUpdated={fetchData}
          canEditQuote={isAdmin}
          className="h-full"
        />
          <Card className="h-full">
            <CardTitle>Contact</CardTitle>
            <CardContent className="space-y-3 mt-3">
              {prospect.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <a href={`tel:${prospect.phoneInternational || prospect.phone}`} className="hover:text-primary">
                    {prospect.phone}
                  </a>
                </div>
              )}
              {prospect.email ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a href={`mailto:${prospect.email}`} className="truncate hover:text-primary">
                      {prospect.email}
                    </a>
                  </div>
                  {(lockState === "mine" || lockState === "admin") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEmailError(null);
                        setEmailModalOpen(true);
                      }}
                      data-test="open-send-email"
                    >
                      <Send className="h-4 w-4" />
                      Envoyer un email
                    </Button>
                  )}
                  {emailSentTo && (
                    <p
                      className="flex items-center gap-1.5 text-xs font-medium text-green-600"
                      data-test="email-sent-indicator"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Email envoyé à {emailSentTo}
                    </p>
                  )}
                </div>
              ) : editingEmail ? (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveEmail()}
                    placeholder="email@exemple.fr"
                    autoFocus
                    className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                    data-test="email-input"
                  />
                  <Button
                    size="sm"
                    disabled={savingEmail}
                    onClick={handleSaveEmail}
                    data-test="save-email"
                  >
                    {savingEmail ? "…" : "OK"}
                  </Button>
                  <button
                    onClick={() => setEditingEmail(false)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                (lockState === "mine" || lockState === "admin") && (
                  <button
                    onClick={() => {
                      setEmailInput("");
                      setEditingEmail(true);
                    }}
                    className="flex items-center gap-2 text-sm text-primary hover:underline cursor-pointer"
                    data-test="add-email"
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter un email
                  </button>
                )
              )}
              {prospect.websiteRoot && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <a
                    href={prospect.websiteRoot.startsWith("http") ? prospect.websiteRoot : `https://${prospect.websiteRoot}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary flex items-center gap-1 truncate"
                  >
                    <span className="truncate">{prospect.websiteRoot}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
              )}
              {prospect.address?.full && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div>
                    <p>{prospect.address.full}</p>
                    {prospect.googleMapsLink && (
                      <a
                        href={prospect.googleMapsLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary text-xs mt-1 inline-flex items-center gap-1 hover:underline"
                      >
                        Voir sur Google Maps
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
              {(prospect.socialLinks?.facebook || prospect.socialLinks?.linkedin || prospect.socialLinks?.twitter) && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-sm">
                  {prospect.socialLinks.facebook && (
                    <a href={prospect.socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Facebook
                    </a>
                  )}
                  {prospect.socialLinks.linkedin && (
                    <a href={prospect.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      LinkedIn
                    </a>
                  )}
                  {prospect.socialLinks.twitter && (
                    <a href={prospect.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Twitter
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Horaires */}
          {prospect.openingHours &&
            Object.values(prospect.openingHours).some(
              (h) => h && String(h) !== "null"
            ) && (
            <Card className="h-full">
              <div className="flex items-center justify-between">
                <CardTitle>Horaires</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <CardContent className="mt-3">
                <div className="space-y-1.5 text-sm">
                  {Object.entries(prospect.openingHours)
                    .filter(([, hours]) => hours && String(hours) !== "null")
                    .sort(([a], [b]) => {
                      const order = Object.keys(DAY_LABELS_FR);
                      return order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase());
                    })
                    .map(([day, hours]) => (
                      <div key={day} className="flex justify-between gap-3">
                        <span className="text-muted-foreground capitalize">
                          {DAY_LABELS_FR[day.toLowerCase()] ?? day}
                        </span>
                        <span className="text-right">{formatHoursFr(String(hours))}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
      </div>

      {/* Prompt Claude Design — réservé admin & dev, pleine largeur */}
      {canSeePrompt && (
        <div className="mt-6">
          <PromptGenerator prospect={prospect} />
        </div>
      )}

      {/* Activity Timeline — pleine largeur en bas de page */}
      <Card className="mt-6">
        <CardTitle>Activité</CardTitle>
        <CardContent className="mt-4">
          <ActivityTimeline
            activities={activities}
            onAddActivity={handleAddActivity}
          />
        </CardContent>
      </Card>

      {/* Overlay de prise du prospect : la fiche reste floutée tant que le
          verrou n'est pas acquis */}
      {lockState !== "mine" && lockState !== "admin" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl text-center">
            {lockState === "held" && reservedBy ? (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <UserCheck className="h-6 w-6 text-red-600" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">
                  Prospect réservé
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ce prospect est attribué à {reservedBy} — vous ne pouvez pas
                  le prendre.
                </p>
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                    Retour
                  </Button>
                </div>
              </>
            ) : lockState === "held" && lockHolder ? (
              <>
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <Lock className="h-6 w-6 text-red-600" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">
                  Prospect déjà pris
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {lockHolder.name} est déjà sur ce prospect — vous ne pouvez
                  pas le prendre pour le moment.
                </p>
                <div className="mt-6 flex justify-center gap-2">
                  <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                    Retour
                  </Button>
                  {session?.user?.role === "admin" && (
                    <Button variant="destructive" onClick={() => takeProspect(true)}>
                      Forcer la prise
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email modal : envoi d'un message au prospect avec l'adresse Milleweb */}
      {emailModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEmailModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-background border border-border p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Send className="h-5 w-5 text-primary" />
                Envoyer un email
              </h2>
              <button
                onClick={() => setEmailModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              À {prospect.email} — envoyé avec l&apos;adresse Milleweb
            </p>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Objet"
              autoFocus
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm mb-3"
              data-test="email-subject"
            />
            <textarea
              value={emailMessage}
              onChange={(e) => setEmailMessage(e.target.value)}
              placeholder="Votre message…"
              className="w-full min-h-[140px] rounded-lg border border-border bg-background px-3 py-2 text-sm mb-2 resize-none"
              data-test="email-message"
            />
            {emailError && (
              <p className="text-xs text-red-600 mb-2">{emailError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEmailModalOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleSendEmail}
                disabled={!emailSubject.trim() || !emailMessage.trim() || sendingEmail}
                data-test="send-email"
              >
                {sendingEmail && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {sendingEmail ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Script de vente : la fiche closer s'affiche dans la fiche, sans quitter la page */}
      {scriptModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setScriptModalOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-xl bg-background border border-border p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Script de vente
              </h2>
              <button
                onClick={() => setScriptModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SalesScript />
          </div>
        </div>
      )}

      {/* RDV modal */}
      {rdvModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setRdvModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-background border border-border p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Fixer le rendez-vous
              </h2>
              <button
                onClick={() => setRdvModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Date et heure du RDV avec {prospect.name}
            </p>
            <input
              type="datetime-local"
              value={rdvDateTime}
              onChange={(e) => setRdvDateTime(e.target.value)}
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRdvModalOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleConfirmRdv} disabled={!rdvDateTime || savingRdv}>
                {savingRdv && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {savingRdv ? "Enregistrement…" : "Confirmer le RDV"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
