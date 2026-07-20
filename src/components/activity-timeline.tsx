"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Phone,
  Mail,
  ArrowRightLeft,
  Bell,
  Upload,
  Send,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActivityType } from "@/types";

interface Activity {
  readonly _id: string;
  readonly type: ActivityType;
  readonly content: string;
  readonly userId: { readonly name: string } | null;
  readonly createdAt: string;
}

const typeConfig: Record<
  ActivityType,
  { icon: React.ElementType; label: string; color: string }
> = {
  note: { icon: MessageSquare, label: "Note", color: "text-blue-500" },
  call: { icon: Phone, label: "Appel", color: "text-green-500" },
  email: { icon: Mail, label: "Email", color: "text-violet-500" },
  status_change: {
    icon: ArrowRightLeft,
    label: "Changement",
    color: "text-orange-500",
  },
  reminder: { icon: Bell, label: "Rappel", color: "text-yellow-500" },
  import: { icon: Upload, label: "Import", color: "text-gray-500" },
  payment: { icon: CreditCard, label: "Paiement", color: "text-emerald-500" },
};

interface ActivityTimelineProps {
  readonly activities: readonly Activity[];
  readonly onAddActivity?: (type: ActivityType, content: string) => void;
}

// On affiche peu d'activités au départ ; « Voir plus » active ensuite le
// scroll infini (chargement au fur et à mesure du défilement).
const INITIAL_COUNT = 5;
const LOAD_STEP = 10;

export function ActivityTimeline({
  activities,
  onAddActivity,
}: ActivityTimelineProps) {
  const [newNote, setNewNote] = useState("");
  const [noteType, setNoteType] = useState<ActivityType>("note");
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [infiniteScroll, setInfiniteScroll] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infiniteScroll) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleCount((count) => count + LOAD_STEP);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [infiniteScroll]);

  const visibleActivities = activities.slice(0, visibleCount);
  const hasMore = activities.length > visibleCount;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newNote.trim() || !onAddActivity) return;
    onAddActivity(noteType, newNote.trim());
    setNewNote("");
  }

  function formatDate(dateStr: string) {
    const [y, m, d] = dateStr.split("T")[0]!.split("-").map(Number);
    const date = new Date(y!, m! - 1, d!);
    return date.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div>
      {/* Add note form */}
      {onAddActivity && (
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex gap-2 mb-2">
            {(["note", "call", "email"] as const).map((type) => {
              const config = typeConfig[type];
              const Icon = config.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setNoteType(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    noteType === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {config.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ajouter une note..."
              className="flex-1 min-h-[80px] rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 resize-none"
            />
          </div>
          <div className="flex justify-end mt-2">
            <Button type="submit" size="sm" disabled={!newNote.trim()}>
              <Send className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
        </form>
      )}

      {/* Timeline */}
      <div className="space-y-4">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucune activité pour le moment
          </p>
        )}
        {visibleActivities.map((activity) => {
          const config = typeConfig[activity.type];
          const Icon = config.icon;
          return (
            <div key={activity._id} className="flex gap-3">
              <div
                className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center bg-muted ${config.color}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {activity.userId?.name ?? "Système"}
                  </span>
                  <span>·</span>
                  <span>{config.label}</span>
                  <span>·</span>
                  <span>
                    {formatDate(activity.createdAt)}{" "}
                    {formatTime(activity.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">
                  {activity.content}
                </p>
              </div>
            </div>
          );
        })}

        {/* Voir plus → active le scroll infini */}
        {hasMore && !infiniteScroll && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => {
                setInfiniteScroll(true);
                setVisibleCount((count) => count + LOAD_STEP);
              }}
              className="text-sm font-medium text-primary hover:underline cursor-pointer"
              data-test="activities-see-more"
            >
              Voir plus ({activities.length - visibleCount} restantes)
            </button>
          </div>
        )}
        {hasMore && infiniteScroll && (
          <div ref={sentinelRef} className="flex justify-center py-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  );
}
