"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { ProspectTable } from "@/components/prospect-table";
import { ProspectFilters } from "@/components/prospect-filters";
import type { IProspect, ProspectStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";

interface PaginationData {
  page: number;
  totalPages: number;
  total: number;
}

export default function ProspectsPage() {
  const router = useRouter();
  const [prospects, setProspects] = useState<IProspect[]>([]);
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [filters, setFilters] = useState({ search: "", status: "" as ProspectStatus | "" });
  const [loading, setLoading] = useState(true);

  const fetchProspects = useCallback(async (page: number, search: string, status: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (search) params.set("search", search);
    if (status) params.set("status", status);

    const res = await fetch(`/api/prospects?${params}`);
    const data = await res.json();

    setProspects(data.prospects);
    setPagination(data.pagination);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProspects(1, filters.search, filters.status);
  }, [filters, fetchProspects]);

  // Real-time: refresh when other users make changes
  useRealtime(() => {
    fetchProspects(pagination.page, filters.search, filters.status);
  });

  function handleFilterChange(newFilters: { search: string; status: ProspectStatus | "" }) {
    setFilters(newFilters);
  }

  function handlePageChange(page: number) {
    fetchProspects(page, filters.search, filters.status);
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer ce prospect ?")) return;
    await fetch(`/api/prospects/${id}`, { method: "DELETE" });
    fetchProspects(pagination.page, filters.search, filters.status);
  }

  return (
    <>
      <Header
        title="Prospects"
        description="Gérez vos prospects et suivez leur progression"
        actions={
          <>
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

      <ProspectFilters onFilterChange={handleFilterChange} />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <ProspectTable
          prospects={prospects}
          pagination={pagination}
          onPageChange={handlePageChange}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
