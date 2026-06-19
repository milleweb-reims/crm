"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, Circle, Calendar, MapPin } from "lucide-react";
import { Header } from "@/components/header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import type { ProspectStatus } from "@/types";

interface Reminder {
  _id: string;
  dueDate: string;
  title: string;
  description: string;
  isCompleted: boolean;
  prospectId: {
    _id: string;
    name: string;
    phone: string;
    address: { city: string };
    status: ProspectStatus;
  } | null;
  userId: { name: string } | null;
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReminders = useCallback(async () => {
    const res = await fetch("/api/reminders");
    if (res.ok) setReminders(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReminders();
  }, [fetchReminders]);

  async function toggleComplete(id: string, isCompleted: boolean) {
    await fetch(`/api/reminders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !isCompleted }),
    });
    fetchReminders();
  }

  function formatDate(dateStr: string) {
    const [y, m, d] = dateStr.split("T")[0]!.split("-").map(Number);
    const date = new Date(y!, m! - 1, d!);
    return date.toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function isOverdue(dateStr: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dateStr) < today;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const pending = reminders.filter((r) => !r.isCompleted);
  const completed = reminders.filter((r) => r.isCompleted);

  return (
    <>
      <Header
        title="Rappels"
        description={`${pending.length} rappel${pending.length > 1 ? "s" : ""} en attente`}
      />

      {pending.length === 0 && completed.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-muted-foreground">Aucun rappel</p>
          <p className="text-sm text-muted-foreground mt-1">
            Créez des rappels depuis la fiche d&apos;un prospect
          </p>
        </Card>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-3 mb-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            En attente
          </h2>
          {pending.map((reminder) => (
            <Card
              key={reminder._id}
              className={cn(
                "flex items-start gap-4 !p-4",
                isOverdue(reminder.dueDate) && !reminder.isCompleted && "border-red-200 bg-red-50/50"
              )}
            >
              <button
                onClick={() => toggleComplete(reminder._id, reminder.isCompleted)}
                className="mt-0.5 cursor-pointer text-muted-foreground hover:text-green-500 transition-colors"
              >
                <Circle className="h-5 w-5" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {reminder.title}
                </p>
                {reminder.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {reminder.description}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className={cn("flex items-center gap-1", isOverdue(reminder.dueDate) && "text-red-600 font-medium")}>
                    <Calendar className="h-3 w-3" />
                    {formatDate(reminder.dueDate)}
                    {isOverdue(reminder.dueDate) && " (en retard)"}
                  </span>
                  {reminder.prospectId && (
                    <>
                      <span>·</span>
                      <Link
                        href={`/prospects/${reminder.prospectId._id}`}
                        className="hover:text-primary flex items-center gap-1"
                      >
                        {reminder.prospectId.name}
                        {reminder.prospectId.address?.city && (
                          <>
                            <MapPin className="h-3 w-3" />
                            {reminder.prospectId.address.city}
                          </>
                        )}
                      </Link>
                      <StatusBadge status={reminder.prospectId.status} />
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Terminés
          </h2>
          {completed.map((reminder) => (
            <Card key={reminder._id} className="flex items-start gap-4 !p-4 opacity-60">
              <button
                onClick={() => toggleComplete(reminder._id, reminder.isCompleted)}
                className="mt-0.5 cursor-pointer text-green-500 hover:text-muted-foreground transition-colors"
              >
                <CheckCircle className="h-5 w-5" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground line-through">
                  {reminder.title}
                </p>
                {reminder.prospectId && (
                  <Link
                    href={`/prospects/${reminder.prospectId._id}`}
                    className="text-xs text-muted-foreground hover:text-primary mt-1 block"
                  >
                    {reminder.prospectId.name}
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
