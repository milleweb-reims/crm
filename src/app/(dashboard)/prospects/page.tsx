"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Upload, Trash2, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { ProspectTable } from "@/components/prospect-table";
import { ProspectFilters } from "@/components/prospect-filters";
import type { IProspect, ProspectStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";

interface PaginationData {
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

interface ListFilters {
  readonly search: string;
  readonly status: ProspectStatus | "";
  readonly assignedTo: string;
  readonly rdvUpcoming: boolean;
  readonly paidMonth: boolean;
}

function FilterChip({
  label,
  onClear,
  testId,
}: Readonly<{
  label: string;
  onClear: () => void;
  testId: string;
}>) {
  return (
    <button
      onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
      data-test={testId}
    >
      {label}
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function ProspectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [prospects, setProspects] = useState<IProspect[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [filters, setFilters] = useState<ListFilters>({
    search: searchParams.get("search") ?? "",
    status: (searchParams.get("status") ?? "") as ProspectStatus | "",
    assignedTo: searchParams.get("assignedTo") ?? "",
    rdvUpcoming: searchParams.get("rdv") === "upcoming",
    paidMonth: searchParams.get("paid") === "month",
  });
  const [loading, setLoading] = useState(true);

  const fetchProspects = useCallback((page: number, f: ListFilters) => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (f.search) params.set("search", f.search);
    if (f.status) params.set("status", f.status);
    if (f.assignedTo) params.set("assignedTo", f.assignedTo);
    if (f.rdvUpcoming) params.set("rdv", "upcoming");
    if (f.paidMonth) params.set("paid", "month");

    fetch(`/api/prospects?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setProspects(data.prospects);
        setPagination(data.pagination);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProspects(1, filters);
  }, [filters, fetchProspects]);

  useRealtime(() => {
    fetchProspects(pagination.page, filters);
  });

  function updateFilters(patch: Partial<ListFilters>) {
    setLoading(true);
    setFilters((f) => ({ ...f, ...patch }));
  }

  function handleFilterChange(newFilters: Readonly<{ search: string; status: ProspectStatus | "" }>) {
    updateFilters(newFilters);
  }

  function handlePageChange(page: number) {
    setLoading(true);
    fetchProspects(page, filters);
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer ce prospect ?")) return;
    await fetch(`/api/prospects/${id}`, { method: "DELETE" });
    fetchProspects(pagination.page, filters);
  }

  async function handleDeleteAll() {
    if (!confirm(`Supprimer TOUS les prospects (${pagination.total}) et tout leur historique ?`)) return;
    if (!confirm("Cette action est irréversible. Confirmer la suppression totale ?")) return;
    await fetch("/api/prospects", { method: "DELETE" });
    fetchProspects(1, filters);
  }

  return (
    <>
      <Header
        title="Prospects"
        description="Gérez vos prospects et suivez leur progression"
        actions={
          <>
            {session?.user?.role === "admin" && (
              <Button variant="destructive" onClick={handleDeleteAll}>
                <Trash2 className="h-4 w-4" />
                Tout supprimer
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => router.push("/prospects/import")}
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button onClick={() => router.push("/prospects/new")}>
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </>
        }
      />

      {(filters.assignedTo || filters.rdvUpcoming || filters.paidMonth) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {filters.assignedTo && (
            <FilterChip
              label={
                filters.assignedTo === session?.user?.id
                  ? "Mes prospects uniquement"
                  : "Filtré par closer"
              }
              onClear={() => updateFilters({ assignedTo: "" })}
              testId="clear-assigned-filter"
            />
          )}
          {filters.rdvUpcoming && (
            <FilterChip
              label="RDV à venir"
              onClear={() => updateFilters({ rdvUpcoming: false })}
              testId="clear-rdv-filter"
            />
          )}
          {filters.paidMonth && (
            <FilterChip
              label="Payés ce mois"
              onClear={() => updateFilters({ paidMonth: false })}
              testId="clear-paid-filter"
            />
          )}
        </div>
      )}

      <ProspectFilters
        onFilterChange={handleFilterChange}
        initialSearch={filters.search}
        initialStatus={filters.status}
        hideStatus={session?.user?.role === "dev"}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <ProspectTable
          prospects={prospects}
          pagination={pagination}
          onPageChange={handlePageChange}
          onDelete={session?.user?.role === "admin" ? handleDelete : undefined}
        />
      )}
    </>
  );
}

export default function ProspectsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <ProspectsPageContent />
    </Suspense>
  );
}
