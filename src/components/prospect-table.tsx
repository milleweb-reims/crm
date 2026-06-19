"use client";

import Link from "next/link";
import { Pencil, Trash2, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { Button } from "@/components/ui/button";
import type { IProspect, ProspectStatus } from "@/types";

interface ProspectTableProps {
  prospects: IProspect[];
  pagination: {
    page: number;
    totalPages: number;
    total: number;
  };
  onPageChange: (page: number) => void;
  onDelete?: (id: string) => void;
}

export function ProspectTable({
  prospects,
  pagination,
  onPageChange,
  onDelete,
}: ProspectTableProps) {
  return (
    <div className="rounded-xl border border-border bg-background shadow-sm overflow-hidden">
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">
                Entreprise
              </th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">
                Téléphone
              </th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground hidden lg:table-cell">
                Email
              </th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">
                Statut
              </th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground hidden xl:table-cell">
                Ville
              </th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground hidden xl:table-cell">
                Avis
              </th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {prospects.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-12 text-center text-muted-foreground"
                >
                  Aucun prospect trouvé
                </td>
              </tr>
            )}
            {prospects.map((prospect) => (
              <tr
                key={prospect._id}
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/prospects/${prospect._id}`}
                    className="font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {prospect.name}
                  </Link>
                  {prospect.websiteRoot && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {prospect.websiteRoot}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4 text-muted-foreground">
                  {prospect.phone || "—"}
                </td>
                <td className="px-6 py-4 text-muted-foreground hidden lg:table-cell">
                  {prospect.email || "—"}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={prospect.status as ProspectStatus} />
                </td>
                <td className="px-6 py-4 text-muted-foreground hidden xl:table-cell">
                  {prospect.address?.city || "—"}
                </td>
                <td className="px-6 py-4 hidden xl:table-cell">
                  {prospect.reviews?.rating ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                      {prospect.reviews.rating}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/prospects/${prospect._id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Link>
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => onDelete(prospect._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="md:hidden divide-y divide-border">
        {prospects.length === 0 && (
          <div className="px-4 py-12 text-center text-muted-foreground">
            Aucun prospect trouvé
          </div>
        )}
        {prospects.map((prospect) => (
          <div key={prospect._id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/prospects/${prospect._id}`}
                  className="font-medium text-foreground hover:text-primary transition-colors block truncate"
                >
                  {prospect.name}
                </Link>
                {prospect.address?.city && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {prospect.address.city}
                  </p>
                )}
              </div>
              <StatusBadge status={prospect.status as ProspectStatus} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground space-y-0.5">
                {prospect.phone && <p>{prospect.phone}</p>}
                {prospect.email && <p className="truncate max-w-[200px]">{prospect.email}</p>}
              </div>
              <div className="flex items-center gap-1">
                <Link href={`/prospects/${prospect._id}`}>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => onDelete(prospect._id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row items-center justify-between px-4 sm:px-6 py-3 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} sur {pagination.totalPages} ({pagination.total}{" "}
            résultats)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Précédent</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              <span className="hidden sm:inline">Suivant</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
