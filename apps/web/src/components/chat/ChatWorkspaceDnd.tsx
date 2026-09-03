import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { MAX_CHAT_WORKSPACE_TABS, useChatWorkspaceStore } from "~/chatWorkspaceStore";
import { buildThreadRouteParams } from "~/threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useSidebar } from "../ui/sidebar";
import { resolveWorkspacePaneDropSide, type WorkspacePaneDropSide } from "./ChatWorkspace.logic";

export interface SidebarThreadDragData {
  readonly kind: "sidebar-thread";
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  readonly pinned: boolean;
}

export interface WorkspacePaneDragData {
  readonly kind: "workspace-pane";
  readonly paneId: string;
}

export type ChatWorkspaceDragData = SidebarThreadDragData | WorkspacePaneDragData;

interface WorkspacePaneDropIndicator {
  readonly paneId: string;
  readonly side: WorkspacePaneDropSide;
  readonly allowed: boolean;
}

export type ChatWorkspaceDropAction =
  | {
      readonly kind: "dock-thread";
      readonly threadRef: ScopedThreadRef;
      readonly targetPaneId: string;
      readonly side: WorkspacePaneDropSide;
    }
  | { readonly kind: "reorder-pane"; readonly activePaneId: string; readonly overPaneId: string }
  | {
      readonly kind: "reorder-pinned";
      readonly activeThreadKey: string;
      readonly overThreadKey: string;
    };

type PinnedReorderHandler = (activeThreadKey: string, overThreadKey: string) => void;

const DndCoordinatorContext = createContext<{
  readonly registerPinnedReorder: (handler: PinnedReorderHandler) => () => void;
} | null>(null);
const PaneDropIndicatorContext = createContext<WorkspacePaneDropIndicator | null>(null);

export function sidebarThreadDragId(threadKey: string): string {
  return `sidebar-thread:${threadKey}`;
}

export function workspacePaneDragId(paneId: string): string {
  return `workspace-pane:${paneId}`;
}

export function sidebarThreadDragData(input: {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  readonly pinned: boolean;
}): SidebarThreadDragData {
  return { kind: "sidebar-thread", ...input };
}

export function workspacePaneDragData(paneId: string): WorkspacePaneDragData {
  return { kind: "workspace-pane", paneId };
}

function readDragData(value: unknown): ChatWorkspaceDragData | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null;
  const candidate = value as Partial<ChatWorkspaceDragData>;
  if (candidate.kind === "sidebar-thread" && "threadRef" in candidate) {
    return candidate as SidebarThreadDragData;
  }
  if (candidate.kind === "workspace-pane" && typeof candidate.paneId === "string") {
    return candidate as WorkspacePaneDragData;
  }
  return null;
}

export function resolveChatWorkspaceDropAction(input: {
  readonly activeData: ChatWorkspaceDragData | null;
  readonly overData: ChatWorkspaceDragData | null;
  readonly paneDrop: WorkspacePaneDropIndicator | null;
}): ChatWorkspaceDropAction | null {
  if (input.activeData?.kind === "sidebar-thread" && input.paneDrop) {
    return {
      kind: "dock-thread",
      threadRef: input.activeData.threadRef,
      targetPaneId: input.paneDrop.paneId,
      side: input.paneDrop.side,
    };
  }
  if (input.activeData?.kind === "workspace-pane" && input.overData?.kind === "workspace-pane") {
    return {
      kind: "reorder-pane",
      activePaneId: input.activeData.paneId,
      overPaneId: input.overData.paneId,
    };
  }
  if (
    input.activeData?.kind === "sidebar-thread" &&
    input.activeData.pinned &&
    input.overData?.kind === "sidebar-thread" &&
    input.overData.pinned
  ) {
    return {
      kind: "reorder-pinned",
      activeThreadKey: input.activeData.threadKey,
      overThreadKey: input.overData.threadKey,
    };
  }
  return null;
}

function paneDropFromEvent(event: DragOverEvent | DragEndEvent): WorkspacePaneDropIndicator | null {
  const activeData = readDragData(event.active.data.current);
  const overData = readDragData(event.over?.data.current);
  const draggedRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  if (
    activeData?.kind !== "sidebar-thread" ||
    overData?.kind !== "workspace-pane" ||
    !draggedRect ||
    !event.over
  ) {
    return null;
  }
  const state = useChatWorkspaceStore.getState();
  return {
    paneId: overData.paneId,
    side: resolveWorkspacePaneDropSide({
      draggedLeft: draggedRect.left,
      draggedWidth: draggedRect.width,
      paneLeft: event.over.rect.left,
      paneWidth: event.over.rect.width,
    }),
    allowed:
      state.panes.some((pane) => pane.id === activeData.threadKey) ||
      state.panes.length < MAX_CHAT_WORKSPACE_TABS,
  };
}

const workspaceCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

export function ChatWorkspaceDndProvider({ children }: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const { isMobile } = useSidebar();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pinnedReorderRef = useRef<PinnedReorderHandler | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<WorkspacePaneDropIndicator | null>(null);

  const registerPinnedReorder = useCallback((handler: PinnedReorderHandler) => {
    pinnedReorderRef.current = handler;
    return () => {
      if (pinnedReorderRef.current === handler) pinnedReorderRef.current = null;
    };
  }, []);
  const coordinator = useMemo(() => ({ registerPinnedReorder }), [registerPinnedReorder]);
  const clearDragState = useCallback(() => {
    setActiveTitle(null);
    setDropIndicator(null);
  }, []);
  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = readDragData(event.active.data.current);
    setActiveTitle(data?.kind === "sidebar-thread" ? data.title : null);
  }, []);
  const onDragOver = useCallback((event: DragOverEvent) => {
    const next = paneDropFromEvent(event);
    setDropIndicator((current) =>
      current?.paneId === next?.paneId &&
      current?.side === next?.side &&
      current?.allowed === next?.allowed
        ? current
        : next,
    );
  }, []);
  const onDragCancel = useCallback((_event: DragCancelEvent) => clearDragState(), [clearDragState]);
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeData = readDragData(event.active.data.current);
      const overData = readDragData(event.over?.data.current);
      const paneDrop = paneDropFromEvent(event);
      const action = resolveChatWorkspaceDropAction({ activeData, overData, paneDrop });
      clearDragState();

      if (action?.kind === "dock-thread") {
        const opened = useChatWorkspaceStore
          .getState()
          .openThreadAdjacent(action.threadRef, action.targetPaneId, action.side);
        if (!opened) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Close a chat pane first",
              description: `You can keep up to ${MAX_CHAT_WORKSPACE_TABS} chats open at once.`,
            }),
          );
          return;
        }
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(action.threadRef),
        });
        return;
      }

      if (action?.kind === "reorder-pane") {
        useChatWorkspaceStore.getState().reorderPane(action.activePaneId, action.overPaneId);
        return;
      }

      if (action?.kind === "reorder-pinned") {
        pinnedReorderRef.current?.(action.activeThreadKey, action.overThreadKey);
      }
    },
    [clearDragState, navigate],
  );

  return (
    <DndCoordinatorContext.Provider value={coordinator}>
      <PaneDropIndicatorContext.Provider value={dropIndicator}>
        <DndContext
          sensors={isMobile ? [] : sensors}
          collisionDetection={workspaceCollisionDetection}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragCancel={onDragCancel}
          onDragEnd={onDragEnd}
        >
          {children}
          <DragOverlay dropAnimation={null}>
            {activeTitle ? (
              <div className="max-w-64 truncate rounded-md border border-border bg-popover px-3 py-2 text-sm font-medium text-popover-foreground shadow-lg">
                {activeTitle}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </PaneDropIndicatorContext.Provider>
    </DndCoordinatorContext.Provider>
  );
}

export function useRegisterPinnedThreadReorder(handler: PinnedReorderHandler): void {
  const coordinator = useContext(DndCoordinatorContext);
  if (!coordinator) throw new Error("Chat workspace drag coordinator is missing.");
  const { registerPinnedReorder } = coordinator;
  useEffect(() => registerPinnedReorder(handler), [handler, registerPinnedReorder]);
}

export function useWorkspacePaneDropIndicator(
  paneId: string,
): Omit<WorkspacePaneDropIndicator, "paneId"> | null {
  const indicator = useContext(PaneDropIndicatorContext);
  if (indicator?.paneId !== paneId) return null;
  return { side: indicator.side, allowed: indicator.allowed };
}
