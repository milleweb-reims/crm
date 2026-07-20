"use client";

import { useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusGuideLink } from "@/components/status-guide";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types";
import { cn } from "@/lib/utils";

interface ProspectFiltersProps {
  onFilterChange: (filters: {
    search: string;
    status: ProspectStatus | "";
    city: string;
  }) => void;
  initialSearch?: string;
  initialStatus?: ProspectStatus | "";
  initialCity?: string;
  hideStatus?: boolean;
}

export function ProspectFilters({
  onFilterChange,
  initialSearch = "",
  initialStatus = "",
  initialCity = "",
  hideStatus = false,
}: ProspectFiltersProps) {
  const [search, setSearch] = useState(initialSearch);
  const [city, setCity] = useState(initialCity);
  const [activeStatus, setActiveStatus] = useState<ProspectStatus | "">(
    initialStatus
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    onFilterChange({ search: value, status: activeStatus, city });
  }

  function handleCityChange(value: string) {
    setCity(value);
    onFilterChange({ search, status: activeStatus, city: value });
  }

  function handleStatusChange(status: ProspectStatus | "") {
    const newStatus = status === activeStatus ? "" : status;
    setActiveStatus(newStatus);
    onFilterChange({ search, status: newStatus, city });
  }

  return (
    <div className="space-y-4 mb-6">
      {/* Status filters — un dev n'a pas la notion de statut */}
      {!hideStatus && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleStatusChange("")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              activeStatus === ""
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Tous
          </button>
          {PROSPECT_STATUSES.map((status) => (
            <button
              key={status.value}
              onClick={() => handleStatusChange(status.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                activeStatus === status.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {status.label}
            </button>
          ))}
          {activeStatus && (
            <button
              onClick={() => handleStatusChange("")}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <StatusGuideLink className="sm:ml-auto" />
        </div>
      )}

      {/* Recherche et ville */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un prospect..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
            data-test="prospect-search"
          />
        </div>
        <div className="relative w-full sm:w-56">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Ville"
            value={city}
            onChange={(e) => handleCityChange(e.target.value)}
            className="pl-10"
            data-test="prospect-city"
          />
        </div>
      </div>
    </div>
  );
}
