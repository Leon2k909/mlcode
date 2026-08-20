import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_CHAT_WORKSPACE_PANES = 3;
export const MIN_CHAT_WORKSPACE_PANE_WIDTH = 460;

export interface ChatWorkspacePane {
  readonly id: string;
  readonly threadRef: ScopedThreadRef;
  readonly size: number;
}

export interface ChatWorkspaceSnapshot {
  readonly panes: ReadonlyArray<ChatWorkspacePane>;
  readonly activePaneId: string | null;
}

export type ChatWorkspaceInsertSide = "before" | "after";

interface ChatWorkspaceStore extends ChatWorkspaceSnapshot {
  replaceActiveThread: (threadRef: ScopedThreadRef) => void;
  openThreadToSide: (threadRef: ScopedThreadRef) => boolean;
  openThreadAdjacent: (
    threadRef: ScopedThreadRef,
    targetPaneId: string,
    side: ChatWorkspaceInsertSide,
  ) => boolean;
  activatePane: (paneId: string) => void;
  closePane: (paneId: string) => ScopedThreadRef | null;
  reorderPane: (activePaneId: string, overPaneId: string) => void;
  setPaneSizes: (sizesByPaneId: Readonly<Record<string, number>>) => void;
  reconcilePanes: (validPaneIds: ReadonlySet<string>) => void;
}

function equalSizePanes(panes: ReadonlyArray<ChatWorkspacePane>): ChatWorkspacePane[] {
  if (panes.length === 0) return [];
  const size = 1 / panes.length;
  return panes.map((pane) => ({ ...pane, size }));
}

function sanitizeThreadRef(value: unknown): ScopedThreadRef | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ScopedThreadRef>;
  if (typeof candidate.environmentId !== "string" || typeof candidate.threadId !== "string") {
    return null;
  }
  return {
    environmentId: candidate.environmentId,
    threadId: candidate.threadId,
  } as ScopedThreadRef;
}

export function sanitizeChatWorkspaceSnapshot(value: unknown): ChatWorkspaceSnapshot {
  if (!value || typeof value !== "object") {
    return { panes: [], activePaneId: null };
  }
  const candidate = value as {
    panes?: unknown;
    activePaneId?: unknown;
  };
  const seen = new Set<string>();
  const panes = Array.isArray(candidate.panes)
    ? candidate.panes.flatMap((entry): ChatWorkspacePane[] => {
        const threadRef = sanitizeThreadRef(
          entry && typeof entry === "object" ? (entry as { threadRef?: unknown }).threadRef : null,
        );
        if (!threadRef) return [];
        const id = scopedThreadKey(threadRef);
        if (seen.has(id) || seen.size >= MAX_CHAT_WORKSPACE_PANES) return [];
        seen.add(id);
        const rawSize = (entry as { size?: unknown }).size;
        return [
          {
            id,
            threadRef,
            size:
              typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 1,
          },
        ];
      })
    : [];
  const normalized = normalizePaneSizes(panes);
  const requestedActivePaneId =
    typeof candidate.activePaneId === "string" ? candidate.activePaneId : null;
  return {
    panes: normalized,
    activePaneId: normalized.some((pane) => pane.id === requestedActivePaneId)
      ? requestedActivePaneId
      : (normalized[0]?.id ?? null),
  };
}

export function normalizePaneSizes(panes: ReadonlyArray<ChatWorkspacePane>): ChatWorkspacePane[] {
  if (panes.length === 0) return [];
  const total = panes.reduce(
    (sum, pane) => sum + (Number.isFinite(pane.size) && pane.size > 0 ? pane.size : 0),
    0,
  );
  if (total <= 0) return equalSizePanes(panes);
  return panes.map((pane) => ({ ...pane, size: pane.size / total }));
}

export function visibleWorkspacePaneIds(input: {
  readonly panes: ReadonlyArray<ChatWorkspacePane>;
  readonly activePaneId: string | null;
  readonly availableWidth: number;
}): ReadonlyArray<string> {
  if (input.panes.length === 0) return [];
  if (input.availableWidth <= 0) return input.panes.map((pane) => pane.id);
  const capacity = Math.max(
    1,
    Math.min(
      MAX_CHAT_WORKSPACE_PANES,
      Math.floor(input.availableWidth / MIN_CHAT_WORKSPACE_PANE_WIDTH),
    ),
  );
  if (capacity >= input.panes.length) return input.panes.map((pane) => pane.id);
  const activePane = input.panes.find((pane) => pane.id === input.activePaneId) ?? input.panes[0];
  return activePane ? [activePane.id] : [];
}

function paneFromRef(threadRef: ScopedThreadRef): ChatWorkspacePane {
  return { id: scopedThreadKey(threadRef), threadRef, size: 1 };
}

export const useChatWorkspaceStore = create<ChatWorkspaceStore>()(
  persist(
    (set, get) => ({
      panes: [],
      activePaneId: null,
      replaceActiveThread: (threadRef) =>
        set((state) => {
          const id = scopedThreadKey(threadRef);
          const existing = state.panes.find((pane) => pane.id === id);
          if (existing) {
            return state.activePaneId === id ? state : { activePaneId: id };
          }
          if (state.panes.length === 0 || state.activePaneId === null) {
            return { panes: [paneFromRef(threadRef)], activePaneId: id };
          }
          const panes = state.panes.map((pane) =>
            pane.id === state.activePaneId ? { ...paneFromRef(threadRef), size: pane.size } : pane,
          );
          return { panes, activePaneId: id };
        }),
      openThreadToSide: (threadRef) => {
        const state = get();
        const id = scopedThreadKey(threadRef);
        if (state.panes.some((pane) => pane.id === id)) {
          set({ activePaneId: id });
          return true;
        }
        if (state.panes.length >= MAX_CHAT_WORKSPACE_PANES) return false;
        set({
          panes: equalSizePanes([...state.panes, paneFromRef(threadRef)]),
          activePaneId: id,
        });
        return true;
      },
      openThreadAdjacent: (threadRef, targetPaneId, side) => {
        const state = get();
        const id = scopedThreadKey(threadRef);
        if (state.panes.some((pane) => pane.id === id)) {
          set({ activePaneId: id });
          return true;
        }
        if (state.panes.length >= MAX_CHAT_WORKSPACE_PANES) return false;
        const targetIndex = state.panes.findIndex((pane) => pane.id === targetPaneId);
        const insertIndex =
          targetIndex < 0
            ? state.panes.length
            : Math.min(state.panes.length, targetIndex + (side === "after" ? 1 : 0));
        const panes = [...state.panes];
        panes.splice(insertIndex, 0, paneFromRef(threadRef));
        set({ panes: equalSizePanes(panes), activePaneId: id });
        return true;
      },
      activatePane: (paneId) =>
        set((state) =>
          state.activePaneId === paneId || !state.panes.some((pane) => pane.id === paneId)
            ? state
            : { activePaneId: paneId },
        ),
      closePane: (paneId) => {
        const state = get();
        const index = state.panes.findIndex((pane) => pane.id === paneId);
        if (index < 0) {
          return state.panes.find((pane) => pane.id === state.activePaneId)?.threadRef ?? null;
        }
        const remaining = state.panes.filter((pane) => pane.id !== paneId);
        if (remaining.length === 0) {
          set({ panes: [], activePaneId: null });
          return null;
        }
        const activePaneId =
          state.activePaneId === paneId
            ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0]?.id ?? null)
            : state.activePaneId;
        const panes = equalSizePanes(remaining);
        set({ panes, activePaneId });
        return (
          panes.find((pane) => pane.id === activePaneId)?.threadRef ?? panes[0]?.threadRef ?? null
        );
      },
      reorderPane: (activePaneId, overPaneId) =>
        set((state) => {
          const from = state.panes.findIndex((pane) => pane.id === activePaneId);
          const to = state.panes.findIndex((pane) => pane.id === overPaneId);
          if (from < 0 || to < 0 || from === to) return state;
          const panes = [...state.panes];
          const [moved] = panes.splice(from, 1);
          if (!moved) return state;
          panes.splice(to, 0, moved);
          return { panes };
        }),
      setPaneSizes: (sizesByPaneId) =>
        set((state) => ({
          panes: normalizePaneSizes(
            state.panes.map((pane) => ({
              ...pane,
              size: sizesByPaneId[pane.id] ?? pane.size,
            })),
          ),
        })),
      reconcilePanes: (validPaneIds) =>
        set((state) => {
          const remaining = state.panes.filter((pane) => validPaneIds.has(pane.id));
          if (remaining.length === state.panes.length) return state;
          const panes = equalSizePanes(remaining);
          const activePaneId = panes.some((pane) => pane.id === state.activePaneId)
            ? state.activePaneId
            : (panes[0]?.id ?? null);
          return { panes, activePaneId };
        }),
    }),
    {
      name: "t3.chat-workspace",
      version: 1,
      partialize: (state) => ({ panes: state.panes, activePaneId: state.activePaneId }),
      migrate: (persisted) => sanitizeChatWorkspaceSnapshot(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeChatWorkspaceSnapshot(persisted),
      }),
    },
  ),
);

export function isThreadOpenInWorkspace(threadRef: ScopedThreadRef): boolean {
  const id = scopedThreadKey(threadRef);
  return useChatWorkspaceStore.getState().panes.some((pane) => pane.id === id);
}

export function canOpenThreadToSide(threadRef: ScopedThreadRef): boolean {
  const state = useChatWorkspaceStore.getState();
  return (
    state.panes.some((pane) => pane.id === scopedThreadKey(threadRef)) ||
    state.panes.length < MAX_CHAT_WORKSPACE_PANES
  );
}
