"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ActivityTimeline } from "@/components/activity-timeline";
import { ReminderForm } from "@/components/reminder-form";
import { PromptGenerator } from "@/components/prompt-generator";
import { PROSPECT_STATUSES, type IProspect, type ProspectStatus, type ActivityType } from "@/types";

interface ActivityData {
  _id: string;
  type: ActivityType;
  content: string;
  userId: { name: string } | null;
  createdAt: string;
}

interface ReminderData {
  _id: string;
  title: string;
  dueDate: string;
  isCompleted: boolean;
}

export default function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [prospect, setProspect] = useState<IProspect | null>(null);
  const [activities, setActivities] = useState<ActivityData[]>([]);
  const [reminders, setReminders] = useState<ReminderData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [prospectRes, activitiesRes, remindersRes] = await Promise.all([
      fetch(`/api/prospects/${id}`),
      fetch(`/api/activities?prospectId=${id}`),
      fetch(`/api/reminders?prospectId=${id}`),
    ]);

    if (prospectRes.ok) setProspect(await prospectRes.json());
    if (activitiesRes.ok) setActivities(await activitiesRes.json());
    if (remindersRes.ok) setReminders(await remindersRes.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleStatusChange(newStatus: string) {
    await fetch(`/api/prospects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchData();
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
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/prospects")}>
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
      </div>

      <Header
        title={prospect.name}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Status dropdown */}
            <select
              value={prospect.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="h-9 sm:h-10 rounded-lg border border-border bg-background px-2 sm:px-3 text-sm cursor-pointer"
            >
              {PROSPECT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <StatusBadge status={prospect.status as ProspectStatus} />
            <Button variant="destructive" size="icon" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Info */}
        <div className="lg:col-span-1 space-y-6">
          {/* Contact */}
          <Card>
            <CardTitle>Contact</CardTitle>
            <CardContent className="space-y-3 mt-3">
              {prospect.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${prospect.phoneInternational || prospect.phone}`} className="hover:text-primary">
                    {prospect.phone}
                  </a>
                </div>
              )}
              {prospect.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${prospect.email}`} className="hover:text-primary">
                    {prospect.email}
                  </a>
                </div>
              )}
              {prospect.websiteRoot && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={prospect.websiteRoot.startsWith("http") ? prospect.websiteRoot : `https://${prospect.websiteRoot}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary flex items-center gap-1"
                  >
                    {prospect.websiteRoot}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Address */}
          {prospect.address?.full && (
            <Card>
              <CardTitle>Adresse</CardTitle>
              <CardContent className="mt-3">
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
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
              </CardContent>
            </Card>
          )}

          {/* Reviews */}
          {prospect.reviews?.rating > 0 && (
            <Card>
              <CardTitle>Avis Google</CardTitle>
              <CardContent className="mt-3">
                <div className="flex items-center gap-2">
                  <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                  <span className="text-2xl font-semibold">{prospect.reviews.rating}</span>
                  <span className="text-sm text-muted-foreground">
                    ({prospect.reviews.count} avis)
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Opening hours */}
          {prospect.openingHours && Object.keys(prospect.openingHours).length > 0 && (
            <Card>
              <CardTitle>Horaires</CardTitle>
              <CardContent className="mt-3">
                <div className="space-y-1.5 text-sm">
                  {Object.entries(prospect.openingHours).map(([day, hours]) => (
                    <div key={day} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">{day}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {String(hours)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Social links */}
          {(prospect.socialLinks?.facebook || prospect.socialLinks?.linkedin || prospect.socialLinks?.twitter) && (
            <Card>
              <CardTitle>Réseaux sociaux</CardTitle>
              <CardContent className="space-y-2 mt-3">
                {prospect.socialLinks.facebook && (
                  <a href={prospect.socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary hover:underline">
                    Facebook
                  </a>
                )}
                {prospect.socialLinks.linkedin && (
                  <a href={prospect.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary hover:underline">
                    LinkedIn
                  </a>
                )}
                {prospect.socialLinks.twitter && (
                  <a href={prospect.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary hover:underline">
                    Twitter
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column - Timeline & Reminders */}
        <div className="lg:col-span-2 space-y-6">
          {/* Reminders */}
          <Card>
            <CardTitle>Rappels</CardTitle>
            <CardContent className="mt-4">
              {reminders.filter((r) => !r.isCompleted).length > 0 && (
                <div className="space-y-2 mb-4">
                  {reminders
                    .filter((r) => !r.isCompleted)
                    .map((r) => {
                      const [y, m, d] = r.dueDate.split("T")[0]!.split("-").map(Number);
                      const date = new Date(y!, m! - 1, d!);
                      return (
                        <div
                          key={r._id}
                          className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50"
                        >
                          <button
                            onClick={async () => {
                              await fetch(`/api/reminders/${r._id}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ isCompleted: true }),
                              });
                              fetchData();
                            }}
                            className="text-muted-foreground hover:text-green-500 cursor-pointer"
                          >
                            ○
                          </button>
                          <span className="flex-1">{r.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
              <ReminderForm prospectId={id} onCreated={fetchData} />
            </CardContent>
          </Card>

          {/* Prompt Generator */}
          <PromptGenerator prospect={prospect} />

          {/* Activity Timeline */}
          <Card>
            <CardTitle>Activité</CardTitle>
            <CardContent className="mt-4">
              <ActivityTimeline
                activities={activities}
                onAddActivity={handleAddActivity}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
