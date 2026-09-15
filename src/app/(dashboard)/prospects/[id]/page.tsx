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
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { CallbackReminderDialog } from "@/components/callback-reminder-dialog";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PromptGenerator } from "@/components/prompt-generator";
import { DevUrlCard } from "@/components/dev-url-card";
import { PaymentLinkCard } from "@/components/payment-link-card";
import { SalesScript } from "@/components/sales-script";
import { StatusGuideLink } from "@/components/status-guide";
import { cn } from "@/lib/utils";
import { DAY_LABELS_FR, formatHoursFr } from "@/lib/format";
import {
  PROSPECT_STATUSES,
  DELIVERY_STAGES,
  type IProspect,
  type IUser,
  type ProspectStatus,
  type DeliveryStage,
  type ActivityType,
} from "@/types";
import {
  LOCK_HEARTBEAT_MS,
  getLockHolder,
  isReservationBinding,
} from "@/lib/lock";
import { getDeliveryStage } from "@/lib/delivery";
import { useRealtime } from "@/hooks/use-realtime";

/**
 * Activity timeline entry with user and timestamp information.
 */
type ActivityData = Readonly<{
  _id: string;
  type: ActivityType;
  content: string;
  userId: Readonly<{ name: string }> | null;
  createdAt: string;
}>;

/**
 * Sales pipeline progression for closers: prospect → en appel → (à rappeler) → rdv → lien envoyé.
 * Advances step-by-step without skipping, allows free backward movement for corrections.
 * "À rappeler" is a half-rank detour off "en appel" (no answer / voicemail): reaching it
 * requires "en appel" first (the lock during dialing keeps its meaning), it never opens
 * "lien envoyé", and "en appel" → "rdv" still works in one step as if it didn't exist.
 * "Pas intéressé" and "Payé" are terminal states managed separately.
 */
const STATUS_RANKS: Readonly<Partial<Record<ProspectStatus, number>>> = {
  prospect: 0,
  en_appel: 1,
  a_rappeler: 1.5,
  rdv: 2,
  lien_envoye: 3,
};

/**
 * Prospect status should never transition to or from "payé" (webhook-only),
 * but "pas_interesse" can transition back to "prospect" for re-engagement.
 * Otherwise progression follows STATUS_RANKS (one rank forward or any rank backward).
 */
function canTransition(from: ProspectStatus, to: ProspectStatus): boolean {
  if (from === "paye" || to === "paye") return false;
  if (to === "pas_interesse") return true;
  if (from === "pas_interesse") return to === "prospect";
  const fromRank = STATUS_RANKS[from];
  const toRank = STATUS_RANKS[to];
  if (fromRank === undefined || toRank === undefined) return false;
  return toRank <= fromRank + 1;
}

/**
 * Developer delivery pipeline (independent of sales status).
 * Advances step-by-step without skipping, allows free backward movement for corrections.
 * Devs never modify sales status directly.
 */
const DELIVERY_FLOW = DELIVERY_STAGES.map((s) => s.value) as ReadonlyArray<DeliveryStage>;

/**
 * Delivery stage advancement allows one-step forward or any-step backward only.
 */
function canChangeDeliveryStage(from: DeliveryStage, to: DeliveryStage): boolean {
  return DELIVERY_FLOW.indexOf(to) <= DELIVERY_FLOW.indexOf(from) + 1;
}

/**
 * Visual styles (border, background, text color) for delivery stage pills.
 */
const deliveryStagePillStyles = {
  a_faire: { active: "border-gray-300 bg-gray-100 text-gray-700", dot: "bg-gray-400" },
  en_cours: { active: "border-blue-300 bg-blue-100 text-blue-700", dot: "bg-blue-400" },
  termine: { active: "border-green-300 bg-green-100 text-green-700", dot: "bg-green-500" },
} as const satisfies Readonly<Record<DeliveryStage, Readonly<{ active: string; dot: string }>>>;

/**
 * Visual styles (border, background, text color) for prospect status pills.
 */
const statusPillStyles = {
  prospect: { active: "border-gray-300 bg-gray-100 text-gray-700", dot: "bg-gray-400" },
  en_appel: { active: "border-amber-300 bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  a_rappeler: { active: "border-orange-300 bg-orange-100 text-orange-700", dot: "bg-orange-400" },
  rdv: { active: "border-blue-300 bg-blue-100 text-blue-700", dot: "bg-blue-400" },
  lien_envoye: { active: "border-violet-300 bg-violet-100 text-violet-700", dot: "bg-violet-400" },
  paye: { active: "border-green-300 bg-green-100 text-green-700", dot: "bg-green-500" },
  pas_interesse: { active: "border-red-300 bg-red-100 text-red-700", dot: "bg-red-400" },
} as const satisfies Readonly<Record<ProspectStatus, Readonly<{ active: string; dot: string }>>>;

export default function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [prospect, setProspect] = useState<IProspect | null>(null);
  const [activities, setActivities] = useState<ReadonlyArray<ActivityData>>([]);
  const [loading, setLoading] = useState(true);
  const [rdvModalOpen, setRdvModalOpen] = useState(false);
  const [callbackPromptOpen, setCallbackPromptOpen] = useState(false);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
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
  /**
   * Lock acquisition state:
   * - "init": deciding (first load)
   * - "held": taken by another closer, cannot acquire
   * - "mine": lock acquired, can edit
   * - "admin": admin/dev free navigation mode (never locks themselves)
   */
  const [lockState, setLockState] = useState<"init" | "held" | "mine" | "admin">("init");
  const [lockHolder, setLockHolder] = useState<{ _id: string; name: string } | null>(null);
  /**
   * Prospect permanently assigned to another closer: lock cannot be acquired (terminal state).
   */
  const [reservedBy, setReservedBy] = useState<string | null>(null);
  const [closers, setClosers] = useState<ReadonlyArray<IUser>>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const isAdmin = session?.user?.role === "admin";
  const isDev = session?.user?.role === "dev";
  const canSeePrompt = isAdmin || isDev;
  const userId = session?.user?.id;

  const assigned =
    prospect?.assignedTo && typeof prospect.assignedTo === "object"
      ? prospect.assignedTo
      : null;
  const assignedId =
    assigned?._id ??
    (typeof prospect?.assignedTo === "string" ? prospect.assignedTo : null);

  /**
   * Pure fetcher (no state updates) so effects can call it and apply
   * results in a callback, where setState is legitimate.
   */
  const loadData = useCallback(async () => {
    const [prospectRes, activitiesRes] = await Promise.all([
      fetch(`/api/prospects/${id}`),
      fetch(`/api/activities?prospectId=${id}`),
    ]);

    return {
      freshProspect: prospectRes.ok
        ? ((await prospectRes.json()) as IProspect)
        : null,
      freshActivities: activitiesRes.ok
        ? ((await activitiesRes.json()) as ActivityData[])
        : null,
    };
  }, [id]);

  const fetchData = useCallback(() => {
    loadData()
      .then(({ freshProspect, freshActivities }) => {
        if (freshProspect) setProspect(freshProspect);
        if (freshActivities) setActivities(freshActivities);
      })
      .catch(() => {
        // Network unavailable: next SSE event or user action retries
      })
      .finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Realtime SSE updates: GoCardless payment webhooks, other user modifications → auto-refresh without page reload.
   */
  useRealtime(fetchData);

  /**
   * Acquire prospect lock via server endpoint.
   * On success: immediately update local state to prevent stale lock detection.
   * On 423 conflict: prospect is reserved or held by another closer.
   * Network errors allow user retry via overlay.
   */
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
        // Network unavailable: overlay remains, user can retry
      }
    },
    [id, userId]
  );

  /**
   * Initialize lock state on page load:
   * - Admin/Dev: free navigation mode (devs don't participate in sales assignment, never blocked)
   * - Reserved to another closer: "held" (terminal, no acquisition possible)
   * - Already held by another: "held" (acquisition waits for release)
   * - Otherwise: auto-acquire lock immediately on page load
   *
   * La réservation n'est opposable que sur un dossier entamé
   * (isReservationBinding). Une fiche encore au statut « Prospect » appartient au
   * pool de sa ville : le closer qui l'ouvre la prend, même si la répartition du
   * territoire l'avait suggérée à un collègue. C'est le pendant côté interface de
   * la règle appliquée par POST /api/prospects/[id]/lock — sans lui, un closer
   * ajouté sur une ville se heurterait à « déjà pris » sur tout le stock.
   */
  /* eslint-disable react-hooks/set-state-in-effect -- One-shot state-machine
     transition guarded by lockState === "init": runs once when prospect and
     session are both available (session arrival is only observable here). */
  useEffect(() => {
    if (lockState !== "init" || !prospect || !session?.user?.id) return;

    if (session.user.role === "admin" || session.user.role === "dev") {
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
    if (
      prospectAssignedId &&
      prospectAssignedId !== session.user.id &&
      isReservationBinding(prospect)
    ) {
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
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Lock maintenance heartbeat: periodically refresh lock while editing.
   * Release lock on page exit via pagehide event (browser/tab close).
   * Detect admin force-take via 423 conflict and revert to "held".
   * Except "en_appel" status: server retains lock across navigation.
   */
  useEffect(() => {
    if (lockState !== "mine") return;

    async function refreshLockHeartbeat() {
      try {
        const res = await fetch(`/api/prospects/${id}/lock`, { method: "POST" });
        if (res.status !== 423) return;

        const data = await res.json().catch(() => ({}));
        setLockHolder(data.lockedBy ?? { _id: "", name: "un autre utilisateur" });
        setLockState("held");
      } catch {
        // Network error: retry on next interval
      }
    }

    const heartbeat = setInterval(() => {
      refreshLockHeartbeat();
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

  /**
   * Lock loss detection via realtime prospect update:
   * Admin force-take detected when prospect.lockedBy changes → immediately transition to "held".
   */
  /* eslint-disable react-hooks/set-state-in-effect -- Guarded "mine" → "held"
     transition reacting to server-driven prospect updates (SSE refresh);
     fires at most once per lock loss, cannot cascade. */
  useEffect(() => {
    if (lockState !== "mine" || !prospect || !session?.user?.id) return;

    const holder = getLockHolder(prospect, session.user.id);
    if (holder) {
      setLockHolder(holder);
      setLockState("held");
    }
  }, [lockState, prospect, session?.user?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Admin realtime lock holder banner: refresh on prospect update (SSE lock acquisition/release)
   * and periodically since getLockHolder depends on clock (TTL expiry without explicit release
   * from crashes or abrupt browser closes).
   */
  /* eslint-disable react-hooks/set-state-in-effect -- The synchronous call
     refreshes the banner immediately when prospect changes (SSE update);
     the value converges (getLockHolder is derived data), no cascade. */
  useEffect(() => {
    if (lockState !== "admin" || !prospect) return;

    setLockHolder(getLockHolder(prospect, session?.user?.id));
    const interval = setInterval(() => {
      setLockHolder(getLockHolder(prospect, session?.user?.id));
    }, 15_000);
    return () => clearInterval(interval);
  }, [lockState, prospect, session?.user?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Monitor held lock for release opportunity: poll prospect for lock expiry
   * and auto-acquire when available. Reserved prospects never auto-release
   * (permanent assignment, no polling needed).
   */
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
        // Network unavailable: retry on next interval
      }
    }, 15_000);

    return () => clearInterval(interval);
  }, [lockState, reservedBy, id, session?.user?.id, takeProspect]);

  /**
   * Load active closers list for admin assignment selector.
   */
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : []))
      .then((users: IUser[]) =>
        setClosers(users.filter((u) => u.role === "closer" && u.isActive))
      )
      .catch(() => {});
  }, [isAdmin]);

  /**
   * Transition prospect status (except RDV which requires modal date/time input).
   * Moving to "à rappeler" then offers to schedule the callback reminder — the
   * status is already changed, the reminder alone is optional.
   */
  async function handleStatusChange(newStatus: string) {
    if (savingStatus) return;
    if (newStatus === "rdv") {
      setRdvDateTime("");
      setRdvModalOpen(true);
      return;
    }
    setStatusError(null);
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusError(data.error || "Impossible de changer le statut");
      } else if (newStatus === "a_rappeler") {
        setCallbackPromptOpen(true);
      }
    } catch {
      setStatusError("Erreur réseau — réessaie");
    } finally {
      setSavingStatus(false);
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

  /**
   * Advance or retreat delivery stage. Moving to "termine" stamps deliveredDate
   * for delivery stats; exiting "termine" clears it (correction).
   */
  async function handleDeliveryStageChange(newStage: DeliveryStage) {
    setStatusError(null);
    const res = await fetch(`/api/prospects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryStage: newStage,
        deliveredDate: newStage === "termine" ? new Date().toISOString() : null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatusError(data.error || "Impossible de changer l'étape");
    }
    fetchData();
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
      /**
       * Show email sent confirmation badge in Contact card for 6 seconds.
       */
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
      {/* Page header: back button, prospect identity, admin/dev actions */}
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
          {isDev ? (
            <Button
              variant="outline"
              className="h-9"
              onClick={() => setPromptModalOpen(true)}
              data-test="prompt-claude-design"
            >
              <Wand2 className="h-4 w-4" />
              Prompt Claude Design
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-9"
              onClick={() => setScriptModalOpen(true)}
              data-test="sales-script"
            >
              <BookOpen className="h-4 w-4" />
              Script de vente
            </Button>
          )}
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
              {/* Assigned closer missing from active list (disabled): still displayed for continuity */}
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

      {/* Demo site link: admin/dev only, independent of Prompt Claude Design */}
      {canSeePrompt && (
        <DevUrlCard
          prospectId={prospect._id}
          devUrl={prospect.devUrl}
          onUpdated={fetchData}
        />
      )}

      {/* Status pipeline for closers/admins (sales progression), delivery pipeline for devs only (site workflow).
          Devs never see or modify sales status. */}
      {isDev ? (
        <div
          role="group"
          aria-label="Étape de livraison du site"
          className="mb-6 flex flex-wrap items-center gap-1.5"
        >
          {DELIVERY_STAGES.map((s) => {
            const currentStage = getDeliveryStage(prospect);
            const isActive = currentStage === s.value;
            const canChangeStage = lockState === "mine" || lockState === "admin";
            const reachable = canChangeDeliveryStage(currentStage, s.value);
            const enabled = canChangeStage && !isActive && reachable;
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={isActive}
                disabled={!enabled}
                title={
                  !isActive && !reachable
                    ? "Étape non accessible : on avance une étape à la fois"
                    : undefined
                }
                onClick={() => handleDeliveryStageChange(s.value)}
                data-test={`delivery-stage-${s.value}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? cn(deliveryStagePillStyles[s.value].active, "shadow-sm")
                    : "border-border bg-background text-muted-foreground",
                  enabled && "cursor-pointer hover:bg-muted hover:text-foreground",
                  !isActive && !enabled && "opacity-40 cursor-not-allowed"
                )}
              >
                <span
                  className={cn("h-2 w-2 rounded-full", deliveryStagePillStyles[s.value].dot)}
                />
                {s.label}
              </button>
            );
          })}
          <StatusGuideLink className="sm:ml-auto" />
        </div>
      ) : (
        <div
          role="group"
          aria-label="Statut du prospect"
          className="mb-6 flex flex-wrap items-center gap-1.5"
        >
          {PROSPECT_STATUSES.map((s) => {
            const isActive = prospect.status === s.value;
            const canChangeStatus = lockState === "mine" || lockState === "admin";
            const reachable = canTransition(
              prospect.status as ProspectStatus,
              s.value
            );
            const enabled = canChangeStatus && !isActive && reachable && !savingStatus;
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
          <StatusGuideLink className="sm:ml-auto" />
        </div>
      )}

      {/* Admin banner: display active closer with force-take option */}
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

      {/* Status change error: lock conflict or validation failure */}
      {statusError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {statusError}
        </div>
      )}

      {/* Contextual info badges: payment received, RDV scheduled */}
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

      {/* Three equal-height cards: payment (closers/admins only), contact, opening hours.
          Devs skip payment card (accessed via header button instead). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {!isDev && (
          <PaymentLinkCard
            prospect={prospect}
            onUpdated={fetchData}
            isAdmin={isAdmin}
            // Le prix se fixe par le détenteur de la fiche ou un admin ; une
            // fiche libre accepte le prix de qui la prend. Le serveur revérifie.
            canEditPrice={isAdmin || !assignedId || assignedId === userId}
            className="h-full"
          />
        )}
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

      {/* Prompt Claude Design: full-width for admins (devs access via header button modal) */}
      {isAdmin && (
        <div className="mt-6">
          <PromptGenerator prospect={prospect} />
        </div>
      )}

      {/* Activity timeline: full-width at bottom of page */}
      <Card className="mt-6">
        <CardTitle>Activité</CardTitle>
        <CardContent className="mt-4">
          <ActivityTimeline
            activities={activities}
            onAddActivity={handleAddActivity}
          />
        </CardContent>
      </Card>

      {/* Lock overlay: page remains blurred until lock acquired (reserved or held by another) */}
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

      {/* Email modal: send message to prospect from Milleweb email address */}
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

      {/* Sales script modal: closer reference displayed without leaving page */}
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

      {/* Prompt Claude Design modal: dev access via header button, stays within page */}
      {promptModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPromptModalOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-background border border-border p-5 shadow-lg overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-primary" />
                Prompt Claude Design
              </h2>
              <button
                onClick={() => setPromptModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <PromptGenerator prospect={prospect} alwaysOpen />
          </div>
        </div>
      )}

      {/* RDV scheduling modal: date/time input for prospect appointment */}
      <CallbackReminderDialog
        open={callbackPromptOpen}
        onOpenChange={setCallbackPromptOpen}
        prospectId={prospect._id}
        prospectName={prospect.name}
        onCreated={fetchData}
      />

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
