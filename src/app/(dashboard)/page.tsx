"use client";

import { useEffect, useState } from "react";
import { Users, Calendar, Code, FileCheck } from "lucide-react";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import { ProspectsChart } from "@/components/prospects-chart";
import { useRealtime } from "@/hooks/use-realtime";

interface Stats {
  totalProspects: number;
  rdv: number;
  enDev: number;
  signesThisMonth: number;
  signesPrevMonth: number;
  monthlyTrend: { _id: { year: number; month: number }; count: number }[];
  todayReminders: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  function fetchStats() {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStats(); }, []);

  // Real-time: refresh stats when other users make changes
  useRealtime(fetchStats);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const signesChange =
    stats && stats.signesPrevMonth > 0
      ? Math.round(
          ((stats.signesThisMonth - stats.signesPrevMonth) /
            stats.signesPrevMonth) *
            100
        )
      : 0;

  return (
    <>
      <Header
        title="Dashboard"
        description="Vue d'ensemble de votre activité commerciale"
      />

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total prospects"
          value={stats?.totalProspects ?? 0}
          icon={Users}
          iconColor="text-primary"
        />
        <StatCard
          title="En RDV"
          value={stats?.rdv ?? 0}
          icon={Calendar}
          iconColor="text-blue-500"
        />
        <StatCard
          title="En dev"
          value={stats?.enDev ?? 0}
          icon={Code}
          iconColor="text-orange-500"
        />
        <StatCard
          title="Devis signés (ce mois)"
          value={stats?.signesThisMonth ?? 0}
          change={signesChange}
          icon={FileCheck}
          iconColor="text-green-500"
        />
      </div>

      {/* Chart */}
      <div className="mb-8">
        <ProspectsChart data={stats?.monthlyTrend ?? []} />
      </div>

      {/* Reminders summary */}
      {stats && stats.todayReminders > 0 && (
        <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            Rappels du jour
          </p>
          <p className="text-2xl font-semibold text-foreground mt-1">
            {stats.todayReminders} rappel{stats.todayReminders > 1 ? "s" : ""} en
            attente
          </p>
        </div>
      )}
    </>
  );
}
