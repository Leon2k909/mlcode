import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  MAX_CHAT_WORKSPACE_TABS,
  normalizePaneSizes,
  sanitizeChatWorkspaceSnapshot,
  useChatWorkspaceStore,
  visibleWorkspacePaneIds,
  type ChatWorkspacePane,
} from "./chatWorkspaceStore";

const ref = (id: string) => scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make(id));

const pane = (id: string, size = 1): ChatWorkspacePane => ({
  id: `env-1:${id}`,
  threadRef: ref(id),
  size,
});

beforeEach(() => {
  useChatWorkspaceStore.setState({ panes: [], activePaneId: null });
});

describe("chatWorkspaceStore", () => {
  it("sanitizes, deduplicates, and normalizes persisted panes", () => {
    const snapshot = sanitizeChatWorkspaceSnapshot({
      panes: [pane("a", 2), pane("a", 4), pane("b", 1), pane("c", 1), pane("d", 1)],
      activePaneId: "missing",
    });

    // Duplicates collapse; all four unique open chats are kept as tabs.
    expect(snapshot.panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
      "env-1:c",
      "env-1:d",
    ]);
    expect(snapshot.panes.reduce((sum, entry) => sum + entry.size, 0)).toBeCloseTo(1);
    expect(snapshot.activePaneId).toBe("env-1:a");
  });

  it("caps persisted tabs at the tab limit", () => {
    const many = Array.from({ length: MAX_CHAT_WORKSPACE_TABS + 4 }, (_unused, index) =>
      pane(`t${index}`, 1),
    );
    const snapshot = sanitizeChatWorkspaceSnapshot({ panes: many, activePaneId: "missing" });
    expect(snapshot.panes).toHaveLength(MAX_CHAT_WORKSPACE_TABS);
  });

  it("replaces only the active pane during normal navigation", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("b")]),
      activePaneId: "env-1:a",
    });

    useChatWorkspaceStore.getState().replaceActiveThread(ref("c"));

    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:c",
      "env-1:b",
    ]);
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:c");
  });

  it("opens unique threads as tabs up to the tab limit", () => {
    for (let index = 0; index < MAX_CHAT_WORKSPACE_TABS; index += 1) {
      expect(useChatWorkspaceStore.getState().openThreadToSide(ref(`t${index}`))).toBe(true);
    }
    // One past the limit is refused...
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("overflow"))).toBe(false);
    // ...but re-opening an already-open tab just activates it.
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("t0"))).toBe(true);

    expect(useChatWorkspaceStore.getState().panes).toHaveLength(MAX_CHAT_WORKSPACE_TABS);
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:t0");
  });

  it("inserts a dragged thread on either side of a target pane", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("c")]),
      activePaneId: "env-1:a",
    });

    expect(useChatWorkspaceStore.getState().openThreadAdjacent(ref("b"), "env-1:c", "before")).toBe(
      true,
    );
    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
      "env-1:c",
    ]);
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:b");

    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("c")]),
      activePaneId: "env-1:a",
    });
    expect(useChatWorkspaceStore.getState().openThreadAdjacent(ref("b"), "env-1:a", "after")).toBe(
      true,
    );
    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
      "env-1:c",
    ]);
  });

  it("deduplicates adjacent opens and keeps a fourth unique thread as a tab", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("b"), pane("c")]),
      activePaneId: "env-1:a",
    });

    // Re-opening an already-open thread just activates it, not a duplicate tab.
    expect(useChatWorkspaceStore.getState().openThreadAdjacent(ref("c"), "env-1:a", "before")).toBe(
      true,
    );
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:c");
    // A fourth unique thread is now a new tab, no longer rejected at three.
    expect(useChatWorkspaceStore.getState().openThreadAdjacent(ref("d"), "env-1:b", "after")).toBe(
      true,
    );
    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
      "env-1:d",
      "env-1:c",
    ]);
  });

  it("closes an active pane into its right neighbor, then its left neighbor", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("b"), pane("c")]),
      activePaneId: "env-1:b",
    });

    expect(useChatWorkspaceStore.getState().closePane("env-1:b")).toEqual(ref("c"));
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:c");
    expect(useChatWorkspaceStore.getState().closePane("env-1:c")).toEqual(ref("a"));
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:a");
  });

  it("reorders panes without changing the active pane", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("b"), pane("c")]),
      activePaneId: "env-1:b",
    });

    useChatWorkspaceStore.getState().reorderPane("env-1:c", "env-1:a");

    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:c",
      "env-1:a",
      "env-1:b",
    ]);
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:b");
  });

  it("normalizes committed sizes and reconciles stale panes", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("b"), pane("c")]),
      activePaneId: "env-1:c",
    });

    useChatWorkspaceStore.getState().setPaneSizes({ "env-1:a": 0.6, "env-1:b": 0.2 });
    expect(
      useChatWorkspaceStore.getState().panes.reduce((sum, entry) => sum + entry.size, 0),
    ).toBeCloseTo(1);

    useChatWorkspaceStore.getState().reconcilePanes(new Set(["env-1:a", "env-1:b"]));
    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
    ]);
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:a");
  });

  it("collapses to the active pane when the workspace cannot fit every pane", () => {
    const panes = normalizePaneSizes([pane("a"), pane("b"), pane("c")]);
    expect(
      visibleWorkspacePaneIds({ panes, activePaneId: "env-1:b", availableWidth: 1_200 }),
    ).toEqual(["env-1:b"]);
    expect(
      visibleWorkspacePaneIds({ panes, activePaneId: "env-1:b", availableWidth: 1_500 }),
    ).toEqual(["env-1:a", "env-1:b", "env-1:c"]);
  });
});
