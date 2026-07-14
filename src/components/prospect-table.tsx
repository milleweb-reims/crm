"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Pencil, Trash2, Star, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLockHolder } from "@/lib/lock";
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
  const router = useRouter();
  const { data: session } = useSession();

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
            {prospects.map((prospect) => {
              const lockHolder = getLockHolder(prospect, session?.user?.id);
              return (
              <tr
                key={prospect._id}
                onClick={() => router.push(`/prospects/${prospect._id}`)}
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
              >
                <td className="px-6 py-4">
                  <span className="font-medium text-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5">
                    {prospect.name}
                    {lockHolder && (
                      <Badge
                        variant="orange"
                        className="gap-1 flex-shrink-0"
                        title={`Fiche en cours de traitement par ${lockHolder.name}`}
                      >
                        <Lock className="h-3 w-3" />
                        {lockHolder.name}
                      </Badge>
                    )}
                  </span>
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
                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => router.push(`/prospects/${prospect._id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
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
              );
            })}
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
        {prospects.map((prospect) => {
          const lockHolder = getLockHolder(prospect, session?.user?.id);
          return (
          <div
            key={prospect._id}
            className="p-4 space-y-2 cursor-pointer active:bg-muted/30"
            onClick={() => router.push(`/prospects/${prospect._id}`)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                  <span className="truncate">{prospect.name}</span>
                  {lockHolder && (
                    <Badge variant="orange" className="gap-1 flex-shrink-0">
                      <Lock className="h-3 w-3" />
                      {lockHolder.name}
                    </Badge>
                  )}
                </span>
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
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => router.push(`/prospects/${prospect._id}`)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
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
          );
        })}
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
