"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Phone, MapPin, User, AlertCircle, Lock, Globe, ExternalLink } from "lucide-react";
import { CallbackReminderDialog } from "@/components/callback-reminder-dialog";
import {
  PROSPECT_STATUSES,
  DELIVERY_STAGES,
  type IProspect,
  type ProspectStatus,
  type DeliveryStage,
} from "@/types";
import { getDeliveryStage } from "@/lib/delivery";
import { getLockHolder } from "@/lib/lock";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRealtime } from "@/hooks/use-realtime";

interface ColumnStyle {
  readonly bg: string;
  readonly header: string;
  readonly headerText: string;
  readonly card: string;
  readonly badge: string;
  readonly dragOver: string;
}

const statusColumnStyles = {
  prospect: { bg: "bg-gray-50", header: "bg-gray-100", headerText: "text-gray-700", card: "border-t-gray-400", badge: "bg-gray-200 text-gray-600", dragOver: "bg-gray-100" },
  en_appel: { bg: "bg-amber-50", header: "bg-amber-100", headerText: "text-amber-700", card: "border-t-amber-400", badge: "bg-amber-200 text-amber-700", dragOver: "bg-amber-100" },
  a_rappeler: { bg: "bg-orange-50", header: "bg-orange-100", headerText: "text-orange-700", card: "border-t-orange-400", badge: "bg-orange-200 text-orange-700", dragOver: "bg-orange-100" },
  rdv: { bg: "bg-blue-50", header: "bg-blue-100", headerText: "text-blue-700", card: "border-t-blue-400", badge: "bg-blue-200 text-blue-700", dragOver: "bg-blue-100" },
  lien_envoye: { bg: "bg-violet-50", header: "bg-violet-100", headerText: "text-violet-700", card: "border-t-violet-400", badge: "bg-violet-200 text-violet-700", dragOver: "bg-violet-100" },
  paye: { bg: "bg-green-50", header: "bg-green-100", headerText: "text-green-700", card: "border-t-green-400", badge: "bg-green-200 text-green-700", dragOver: "bg-green-100" },
  pas_interesse: { bg: "bg-red-50", header: "bg-red-100", headerText: "text-red-700", card: "border-t-red-400", badge: "bg-red-200 text-red-700", dragOver: "bg-red-100" },
} as const satisfies Record<ProspectStatus, ColumnStyle>;

const deliveryColumnStyles = {
  a_faire: { bg: "bg-gray-50", header: "bg-gray-100", headerText: "text-gray-700", card: "border-t-gray-400", badge: "bg-gray-200 text-gray-600", dragOver: "bg-gray-100" },
  en_cours: { bg: "bg-blue-50", header: "bg-blue-100", headerText: "text-blue-700", card: "border-t-blue-400", badge: "bg-blue-200 text-blue-700", dragOver: "bg-blue-100" },
  termine: { bg: "bg-green-50", header: "bg-green-100", headerText: "text-green-700", card: "border-t-green-400", badge: "bg-green-200 text-green-700", dragOver: "bg-green-100" },
} as const satisfies Record<DeliveryStage, ColumnStyle>;

/**
 * Initialize empty prospect columns from stage identifiers.
 * @param keys - Array of column keys to initialize
 * @returns Record mapping each key to an empty array
 */
function initializeEmptyColumns(keys: readonly string[]): Record<string, IProspect[]> {
  return Object.fromEntries(keys.map(key => [key, []]));
}

interface GroupProspectsOptions {
  readonly prospects: readonly IProspect[];
  readonly isDev: boolean;
}

/**
 * Group prospects by their current stage (dev view) or status (sales view).
 * @param options - Prospects list and role flag
 * @returns Prospects grouped by column key
 */
function groupProspectsByStage(options: GroupProspectsOptions): Record<string, IProspect[]> {
  return options.prospects.reduce((acc, prospect) => {
    const key = options.isDev ? getDeliveryStage(prospect) : prospect.status;
    return {
      ...acc,
      [key]: [...(acc[key] ?? []), prospect],
    };
  }, {} as Record<string, IProspect[]>);
}

interface MergeProspectsOptions {
  readonly prospects: readonly IProspect[];
  readonly keys: readonly string[];
  readonly isDev: boolean;
}

/**
 * Merge fetched prospects into initialized columns, grouping by stage/status.
 * @param options - Prospects from API, column keys, and view mode
 * @returns Columns with prospects distributed by current stage
 */
function mergeProspectsIntoColumns(options: MergeProspectsOptions): Record<string, IProspect[]> {
  const empty = initializeEmptyColumns(options.keys);
  const grouped = groupProspectsByStage({
    prospects: options.prospects,
    isDev: options.isDev,
  });
  return { ...empty, ...grouped };
}

interface DragValidationResult {
  readonly isValid: boolean;
  readonly movedProspect?: IProspect;
  readonly sourceKey: string;
  readonly destKey: string;
}

/**
 * Validate drag operation and extract moved prospect.
 * Checks destination exists, item exists, and move is not a no-op.
 * @param options - Current columns state and drag result
 * @returns Validation outcome with extracted prospect if valid
 */
function validateDragOperation(options: {
  readonly columns: Record<string, IProspect[]>;
  readonly result: DropResult;
}): DragValidationResult {
  const { source, destination } = options.result;
  const sourceKey = source.droppableId;

  if (!destination) {
    return { isValid: false, sourceKey, destKey: "" };
  }

  const destKey = destination.droppableId;

  if (sourceKey === destKey && source.index === destination.index) {
    return { isValid: false, sourceKey, destKey };
  }

  const sourceCol = options.columns[sourceKey] ?? [];
  const movedProspect = sourceCol[source.index];

  if (!movedProspect) {
    return { isValid: false, sourceKey, destKey };
  }

  return {
    isValid: true,
    movedProspect,
    sourceKey,
    destKey,
  };
}

interface UpdateProspectOptions {
  readonly prospect: IProspect;
  readonly destKey: string;
  readonly isDev: boolean;
}

/**
 * Compute prospect with updated stage/status after cross-column move.
 * Encodes stage-specific logic: dev sets deliveryStage + deliveredDate, others set status.
 * @param options - Prospect, destination column, and role flag
 * @returns Updated prospect with new stage/status
 */
function computeUpdatedProspect(options: UpdateProspectOptions): IProspect {
  const { prospect, destKey, isDev } = options;
  if (!isDev) {
    return { ...prospect, status: destKey as ProspectStatus };
  }
  return {
    ...prospect,
    deliveryStage: destKey as DeliveryStage,
    deliveredDate: destKey === "termine" ? new Date() : null,
  };
}

interface ComputeColumnsOptions {
  readonly columns: Record<string, IProspect[]>;
  readonly sourceKey: string;
  readonly destKey: string;
  readonly sourceIndex: number;
  readonly destIndex: number;
  readonly movedProspect: IProspect;
}

/**
 * Compute new column state after move (same-column reorder or cross-column transfer).
 * Handles reordering logic and cross-column insertion.
 * @param options - Current columns, source/dest keys/indices, and prospect to insert
 * @returns New columns record with updated state
 */
function computeNextColumnsState(options: ComputeColumnsOptions): Record<string, IProspect[]> {
  const { columns, sourceKey, destKey, sourceIndex, destIndex, movedProspect } = options;
  const newColumns = { ...columns };
  const sourceCol = [...(newColumns[sourceKey] ?? [])];
  sourceCol.splice(sourceIndex, 1);

  if (sourceKey === destKey) {
    sourceCol.splice(destIndex, 0, movedProspect);
    newColumns[sourceKey] = sourceCol;
  } else {
    const destCol = [...(newColumns[destKey] ?? [])];
    destCol.splice(destIndex, 0, movedProspect);
    newColumns[sourceKey] = sourceCol;
    newColumns[destKey] = destCol;
  }

  return newColumns;
}

interface PersistenceBodyOptions {
  readonly isDev: boolean;
  readonly destKey: string;
}

/**
 * Compute request body for server persistence based on view mode and target column.
 * @param options - Role flag and destination column
 * @returns Request body for PATCH endpoint
 */
function computePersistenceBody(options: PersistenceBodyOptions): Record<string, unknown> {
  const { isDev, destKey } = options;
  if (!isDev) {
    return { status: destKey };
  }
  return {
    deliveryStage: destKey,
    deliveredDate: destKey === "termine" ? new Date().toISOString() : null,
  };
}

interface SyncProspectOptions {
  readonly prospectId: string;
  readonly body: Record<string, unknown>;
  readonly onConflict: (error: string) => void;
  readonly onError: () => void;
}

/**
 * Persist drag operation to server and handle conflict/error rollback.
 * Implements optimistic update pattern with rollback on 409/423/error.
 * @param options - Prospect ID, request body, and failure callbacks
 * @returns Whether the server accepted the change
 */
async function syncProspectChanges(options: SyncProspectOptions): Promise<boolean> {
  const { prospectId, body, onConflict, onError } = options;
  const res = await fetch(`/api/prospects/${prospectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 409 || res.status === 423) {
    const data = await res.json();
    onConflict(data.error);
  } else if (!res.ok) {
    onError();
  }
  return res.ok;
}

export function PipelineBoard() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const isDev = session?.user?.role === "dev";

  const columnDefs = isDev
    ? DELIVERY_STAGES.map((s) => ({
        value: s.value as string,
        label: s.label,
        styles: deliveryColumnStyles[s.value],
      }))
    : PROSPECT_STATUSES.map((s) => ({
        value: s.value as string,
        label: s.label,
        styles: statusColumnStyles[s.value],
      }));

  const [columns, setColumns] = useState<Record<string, IProspect[]>>({});
  const [loading, setLoading] = useState(true);
  const [conflictMsg, setConflictMsg] = useState("");
  /** Fiche venant d'être glissée en « À rappeler » : propose le rappel daté. */
  const [callbackPrompt, setCallbackPrompt] = useState<{ id: string; name: string } | null>(null);

  const loadProspects = useCallback(async () => {
    const res = await fetch(
      isDev
        ? "/api/prospects?limit=500&view=delivery"
        : "/api/prospects?limit=500"
    );
    const data = await res.json();

    const keys = isDev
      ? DELIVERY_STAGES.map((s) => s.value as string)
      : PROSPECT_STATUSES.map((s) => s.value as string);

    return mergeProspectsIntoColumns({
      prospects: data.prospects,
      keys,
      isDev,
    });
  }, [isDev]);

  const fetchProspects = useCallback(() => {
    loadProspects()
      .then((merged) => {
        setColumns(merged);
      })
      .catch(() => {
        // Network unavailable: next poll or SSE event retries
      })
      .finally(() => setLoading(false));
  }, [loadProspects]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    fetchProspects();
  }, [sessionStatus, fetchProspects]);

  useRealtime(() => {
    fetchProspects();
  });

  useEffect(() => {
    const interval = setInterval(fetchProspects, 10_000);
    return () => clearInterval(interval);
  }, [fetchProspects]);

  async function handleDragEnd(result: DropResult): Promise<void> {
    const { destination, draggableId, source } = result;

    if (!destination) return;

    const validation = validateDragOperation({
      columns,
      result,
    });

    if (!validation.isValid || !validation.movedProspect) return;

    const { sourceKey, destKey, movedProspect } = validation;

    const prospectToInsert = sourceKey === destKey
      ? movedProspect
      : computeUpdatedProspect({
          prospect: movedProspect,
          destKey,
          isDev,
        });

    const nextColumns = computeNextColumnsState({
      columns,
      sourceKey,
      destKey,
      sourceIndex: source.index,
      destIndex: destination.index,
      movedProspect: prospectToInsert,
    });

    setColumns(nextColumns);
    setConflictMsg("");

    if (sourceKey !== destKey) {
      const body = computePersistenceBody({
        isDev,
        destKey,
      });

      const accepted = await syncProspectChanges({
        prospectId: draggableId,
        body,
        onConflict: (error: string) => {
          setConflictMsg(error);
          fetchProspects();
          setTimeout(() => setConflictMsg(""), 5000);
        },
        onError: () => {
          fetchProspects();
        },
      });

      if (accepted && !isDev && destKey === "a_rappeler") {
        setCallbackPrompt({ id: draggableId, name: movedProspect.name });
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
      {conflictMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {conflictMsg}
        </div>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columnDefs.map((column) => (
          <div
            key={column.value}
            className={cn("flex-shrink-0 w-[260px] sm:w-[300px] rounded-xl", column.styles.bg)}
          >
            <div className={cn("px-4 py-3 flex items-center justify-between rounded-t-xl", column.styles.header)}>
              <h3 className={cn("text-sm font-semibold", column.styles.headerText)}>
                {column.label}
              </h3>
              <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", column.styles.badge)}>
                {(columns[column.value] ?? []).length}
              </span>
            </div>

            <Droppable droppableId={column.value}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "px-2 pb-2 min-h-[200px] space-y-2 transition-colors rounded-b-xl",
                    snapshot.isDraggingOver && column.styles.dragOver
                  )}
                >
                  {(columns[column.value] ?? []).map((prospect, index) => (
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
                          onClick={(e) => {
                            if (e.defaultPrevented) return;
                            router.push(`/prospects/${prospect._id}`);
                          }}
                          className={cn(
                            "bg-background rounded-lg border border-border p-3 shadow-sm border-t-2 cursor-pointer",
                            column.styles.card,
                            snapshot.isDragging && "shadow-lg rotate-2"
                          )}
                        >
                          <p className="text-sm font-medium text-foreground hover:text-primary flex items-center gap-1.5">
                            <span className="truncate">{prospect.name}</span>
                            {getLockHolder(prospect, session?.user?.id) && (
                              <Lock className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                            )}
                          </p>
                          <div className="mt-2 space-y-1">
                            {getLockHolder(prospect, session?.user?.id) && (
                              <p className="text-xs text-orange-600 flex items-center gap-1 font-medium">
                                <Lock className="h-3 w-3" />
                                En cours par{" "}
                                {getLockHolder(prospect, session?.user?.id)?.name}
                              </p>
                            )}
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
                            {prospect.websiteRoot && (
                              <a
                                href={prospect.websiteRoot.startsWith("http") ? prospect.websiteRoot : `https://${prospect.websiteRoot}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-muted-foreground flex items-center gap-1 hover:text-primary hover:underline"
                              >
                                <Globe className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{prospect.websiteRoot}</span>
                              </a>
                            )}
                            {prospect.devUrl && (
                              <a
                                href={prospect.devUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                Voir le site
                              </a>
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

      {callbackPrompt && (
        <CallbackReminderDialog
          open
          onOpenChange={(open) => {
            if (!open) setCallbackPrompt(null);
          }}
          prospectId={callbackPrompt.id}
          prospectName={callbackPrompt.name}
        />
      )}
    </DragDropContext>
  );
}
