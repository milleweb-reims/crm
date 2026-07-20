"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Users,
  Calendar,
  Send,
  CreditCard,
  Euro,
  Phone,
  Inbox,
  Rocket,
  Globe,
  PackageCheck,
  Bell,
} from "lucide-react";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import { ProspectsChart } from "@/components/prospects-chart";
import { ConversionFunnel } from "@/components/conversion-funnel";
import {
  ClosersLeaderboard,
  type LeaderboardEntry,
} from "@/components/closers-leaderboard";
import { DeliveryList, type DeliveryItem } from "@/components/delivery-list";
import { useRealtime } from "@/hooks/use-realtime";

interface AdminStats {
  readonly role: "admin";
  readonly totalProspects: number;
  readonly byStatus: Record<string, number>;
  readonly untreatedStock: number;
  readonly caThisMonth: number;
  readonly caPrevMonth: number;
  readonly salesThisMonth: number;
  readonly salesPrevMonth: number;
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly monthlyTrend: readonly { readonly _id: { readonly year: number; readonly month: number }; readonly count: number }[];
  readonly todayReminders: number;
}

interface CloserStats {
  readonly role: "closer";
  readonly myProspects: number;
  readonly callsToday: number;
  readonly upcomingRdv: number;
  readonly liensEnvoyes: number;
  readonly salesThisMonth: number;
  readonly salesPrevMonth: number;
  readonly caThisMonth: number;
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly todayReminders: number;
}

interface DevStats {
  readonly role: "dev";
  readonly toDeliver: number;
  readonly missingDevUrl: number;
  readonly deliveredThisMonth: number;
  readonly totalPaid: number;
  readonly deliveryList: readonly DeliveryItem[];
}

type Stats = AdminStats | CloserStats | DevStats;

function percentChange(current: number, previous: number) {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
}

function formatEuros(amount: number) {
  return `${amount.toLocaleString("fr-FR")} €`;
}

function RemindersCard({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-amber-500" />
        <p className="text-sm font-medium text-muted-foreground">
          Rappels du jour
        </p>
      </div>
      <p className="text-2xl font-semibold text-foreground mt-1">
        {count} rappel{count > 1 ? "s" : ""} en attente
      </p>
    </div>
  );
}

function AdminDashboard({ stats }: { stats: AdminStats }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="CA encaissé (ce mois)"
          value={formatEuros(stats.caThisMonth)}
          change={percentChange(stats.caThisMonth, stats.caPrevMonth)}
          icon={Euro}
          iconColor="text-green-500"
          href="/prospects?paid=month"
        />
        <StatCard
          title="Ventes (ce mois)"
          value={stats.salesThisMonth}
          change={percentChange(stats.salesThisMonth, stats.salesPrevMonth)}
          icon={CreditCard}
          iconColor="text-primary"
          href="/prospects?paid=month"
        />
        <StatCard
          title="Stock non traité"
          value={stats.untreatedStock}
          icon={Inbox}
          iconColor="text-amber-500"
          href="/prospects?status=prospect"
        />
        <StatCard
          title="RDV en cours"
          value={stats.byStatus.rdv || 0}
          icon={Calendar}
          iconColor="text-blue-500"
          href="/prospects?status=rdv"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ConversionFunnel
          byStatus={stats.byStatus}
          total={stats.totalProspects}
        />
        <ClosersLeaderboard entries={[...stats.leaderboard]} showCa />
      </div>

      <div className="mb-8">
        <ProspectsChart data={stats.monthlyTrend} />
      </div>

      <RemindersCard count={stats.todayReminders} />
    </>
  );
}

function CloserDashboard({
  stats,
  userId,
}: {
  stats: CloserStats;
  userId?: string;
}) {
  const mine = (params: string) =>
    userId ? `/prospects?assignedTo=${userId}${params ? `&${params}` : ""}` : undefined;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Appels aujourd'hui"
          value={stats.callsToday}
          icon={Phone}
          iconColor="text-amber-500"
        />
        <StatCard
          title="RDV à venir"
          value={stats.upcomingRdv}
          icon={Calendar}
          iconColor="text-blue-500"
          href={mine("rdv=upcoming")}
        />
        <StatCard
          title="Liens envoyés"
          value={stats.liensEnvoyes}
          icon={Send}
          iconColor="text-violet-500"
          href={mine("status=lien_envoye")}
        />
        <StatCard
          title={`Ventes (ce mois) · ${formatEuros(stats.caThisMonth)}`}
          value={stats.salesThisMonth}
          change={percentChange(stats.salesThisMonth, stats.salesPrevMonth)}
          icon={CreditCard}
          iconColor="text-green-500"
          href={mine("paid=month")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ClosersLeaderboard entries={[...stats.leaderboard]} currentUserId={userId} />
        <div className="space-y-6">
          <StatCard
            title="Mes prospects assignés"
            value={stats.myProspects}
            icon={Users}
            iconColor="text-primary"
            href={mine("")}
          />
          <RemindersCard count={stats.todayReminders} />
        </div>
      </div>
    </>
  );
}

function DevDashboard({ stats }: { stats: DevStats }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Sites à livrer"
          value={stats.toDeliver}
          icon={Rocket}
          iconColor="text-amber-500"
        />
        <StatCard
          title="Sans URL dev"
          value={stats.missingDevUrl}
          icon={Globe}
          iconColor="text-red-500"
        />
        <StatCard
          title="Livrés (ce mois)"
          value={stats.deliveredThisMonth}
          icon={PackageCheck}
          iconColor="text-green-500"
        />
        <StatCard
          title="Total sites payés"
          value={stats.totalPaid}
          icon={CreditCard}
          iconColor="text-primary"
        />
      </div>

      <DeliveryList items={stats.deliveryList} />
    </>
  );
}

const HEADER_BY_ROLE = {
  admin: "Vue d'ensemble : chiffre d'affaires, funnel et performance de l'équipe",
  closer: "Votre activité commerciale du jour et du mois",
  dev: "Suivi des livraisons de sites",
} as const;

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  function fetchStats() {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Failed to fetch stats", { error });
        setLoading(false);
      });
  }

  useEffect(() => { fetchStats(); }, []);

  // Real-time: refresh stats when other users make changes
  useRealtime(fetchStats);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <Header
        title="Dashboard"
        description={
          HEADER_BY_ROLE[stats.role] ??
          "Vue d'ensemble de votre activité commerciale"
        }
      />

      {stats.role === "admin" && <AdminDashboard stats={stats} />}
      {stats.role === "closer" && (
        <CloserDashboard stats={stats} userId={session?.user?.id} />
      )}
      {stats.role === "dev" && <DevDashboard stats={stats} />}
    </>
  );
}
