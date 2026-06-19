"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Phone, MapPin, User, AlertCircle } from "lucide-react";
import { PROSPECT_STATUSES, type IProspect, type ProspectStatus } from "@/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRealtime } from "@/hooks/use-realtime";

const columnStyles: Record<ProspectStatus, { bg: string; header: string; headerText: string; card: string; badge: string; dragOver: string }> = {
  prospect: { bg: "bg-gray-50", header: "bg-gray-100", headerText: "text-gray-700", card: "border-t-gray-400", badge: "bg-gray-200 text-gray-600", dragOver: "bg-gray-100" },
  rdv: { bg: "bg-blue-50", header: "bg-blue-100", headerText: "text-blue-700", card: "border-t-blue-400", badge: "bg-blue-200 text-blue-700", dragOver: "bg-blue-100" },
  en_dev: { bg: "bg-orange-50", header: "bg-orange-100", headerText: "text-orange-700", card: "border-t-orange-400", badge: "bg-orange-200 text-orange-700", dragOver: "bg-orange-100" },
  devis_envoye: { bg: "bg-violet-50", header: "bg-violet-100", headerText: "text-violet-700", card: "border-t-violet-400", badge: "bg-violet-200 text-violet-700", dragOver: "bg-violet-100" },
  signe: { bg: "bg-green-50", header: "bg-green-100", headerText: "text-green-700", card: "border-t-green-400", badge: "bg-green-200 text-green-700", dragOver: "bg-green-100" },
  livre: { bg: "bg-emerald-50", header: "bg-emerald-100", headerText: "text-emerald-700", card: "border-t-emerald-500", badge: "bg-emerald-200 text-emerald-700", dragOver: "bg-emerald-100" },
};

export function PipelineBoard() {
  const { data: session } = useSession();
  const [columns, setColumns] = useState<Record<ProspectStatus, IProspect[]>>(
    () => {
      const initial: Record<string, IProspect[]> = {};
      for (const s of PROSPECT_STATUSES) {
        initial[s.value] = [];
      }
      return initial as Record<ProspectStatus, IProspect[]>;
    }
  );
  const [loading, setLoading] = useState(true);
  const [conflictMsg, setConflictMsg] = useState("");

  const fetchProspects = useCallback(async () => {
    const res = await fetch("/api/prospects?limit=500");
    const data = await res.json();

    const grouped: Record<string, IProspect[]> = {};
    for (const s of PROSPECT_STATUSES) {
      grouped[s.value] = [];
    }

    for (const prospect of data.prospects) {
      if (grouped[prospect.status]) {
        grouped[prospect.status].push(prospect);
      }
    }

    setColumns(grouped as Record<ProspectStatus, IProspect[]>);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProspects();
  }, [fetchProspects]);

  // Real-time: refresh when other users make changes
  useRealtime(() => {
    fetchProspects();
  });

  async function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    const sourceStatus = source.droppableId as ProspectStatus;
    const destStatus = destination.droppableId as ProspectStatus;

    const newColumns = { ...columns };
    const sourceCol = [...newColumns[sourceStatus]];
    const [moved] = sourceCol.splice(source.index, 1);

    if (sourceStatus === destStatus) {
      sourceCol.splice(destination.index, 0, moved!);
      newColumns[sourceStatus] = sourceCol;
    } else {
      const destCol = [...newColumns[destStatus]];
      const updatedProspect = { ...moved!, status: destStatus };
      destCol.splice(destination.index, 0, updatedProspect);
      newColumns[sourceStatus] = sourceCol;
      newColumns[destStatus] = destCol;
    }

    setColumns(newColumns);
    setConflictMsg("");

    // Persist status change
    if (sourceStatus !== destStatus) {
      const res = await fetch(`/api/prospects/${draggableId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: destStatus }),
      });

      if (res.status === 409) {
        // Conflict: prospect already taken by another closer — revert
        const data = await res.json();
        setConflictMsg(data.error);
        fetchProspects(); // Reload to get true state
        setTimeout(() => setConflictMsg(""), 5000);
      } else if (!res.ok) {
        fetchProspects(); // Revert on any error
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* Conflict alert */}
      {conflictMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {conflictMsg}
        </div>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PROSPECT_STATUSES.map((status) => (
          <div
            key={status.value}
            className={cn("flex-shrink-0 w-[260px] sm:w-[300px] rounded-xl", columnStyles[status.value].bg)}
          >
            {/* Column header */}
            <div className={cn("px-4 py-3 flex items-center justify-between rounded-t-xl", columnStyles[status.value].header)}>
              <h3 className={cn("text-sm font-semibold", columnStyles[status.value].headerText)}>
                {status.label}
              </h3>
              <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", columnStyles[status.value].badge)}>
                {columns[status.value].length}
              </span>
            </div>

            {/* Droppable area */}
            <Droppable droppableId={status.value}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "px-2 pb-2 min-h-[200px] space-y-2 transition-colors rounded-b-xl",
                    snapshot.isDraggingOver && columnStyles[status.value].dragOver
                  )}
                >
                  {columns[status.value].map((prospect, index) => (
                    <Draggable
                      key={prospect._id}
                      draggableId={prospect._id}
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={cn(
                            "bg-background rounded-lg border border-border p-3 shadow-sm border-t-2",
                            columnStyles[status.value].card,
                            snapshot.isDragging && "shadow-lg rotate-2"
                          )}
                        >
                          <Link
                            href={`/prospects/${prospect._id}`}
                            className="block"
                          >
                            <p className="text-sm font-medium text-foreground truncate hover:text-primary">
                              {prospect.name}
                            </p>
                          </Link>
                          <div className="mt-2 space-y-1">
                            {prospect.phone && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {prospect.phone}
                              </p>
                            )}
                            {prospect.address?.city && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {prospect.address.city}
                              </p>
                            )}
                            {prospect.assignedTo && (
                              <p className={cn(
                                "text-xs flex items-center gap-1 font-medium",
                                typeof prospect.assignedTo === "object" &&
                                  "_id" in prospect.assignedTo &&
                                  (prospect.assignedTo as { _id: string })._id === session?.user?.id
                                  ? "text-primary"
                                  : "text-orange-600"
                              )}>
                                <User className="h-3 w-3" />
                                {typeof prospect.assignedTo === "object" && "name" in prospect.assignedTo
                                  ? (prospect.assignedTo as { _id: string; name: string })._id === session?.user?.id
                                    ? "Moi"
                                    : (prospect.assignedTo as { name: string }).name
                                  : "Assigné"}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  );
}
