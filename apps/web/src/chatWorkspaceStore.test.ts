import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  MAX_CHAT_WORKSPACE_PANES,
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
  it("sanitizes, deduplicates, caps, and normalizes persisted panes", () => {
    const snapshot = sanitizeChatWorkspaceSnapshot({
      panes: [pane("a", 2), pane("a", 4), pane("b", 1), pane("c", 1), pane("d", 1)],
      activePaneId: "missing",
    });

    expect(snapshot.panes.map((entry) => entry.id)).toEqual(["env-1:a", "env-1:b", "env-1:c"]);
    expect(snapshot.panes).toHaveLength(MAX_CHAT_WORKSPACE_PANES);
    expect(snapshot.panes.reduce((sum, entry) => sum + entry.size, 0)).toBeCloseTo(1);
    expect(snapshot.activePaneId).toBe("env-1:a");
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

  it("opens unique threads to the side and enforces the pane limit", () => {
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("a"))).toBe(true);
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("b"))).toBe(true);
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("c"))).toBe(true);
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("d"))).toBe(false);
    expect(useChatWorkspaceStore.getState().openThreadToSide(ref("a"))).toBe(true);

    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
      "env-1:c",
    ]);
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:a");
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

  it("deduplicates adjacent opens and rejects unique threads at the pane cap", () => {
    useChatWorkspaceStore.setState({
      panes: normalizePaneSizes([pane("a"), pane("b"), pane("c")]),
      activePaneId: "env-1:a",
    });

    expect(useChatWorkspaceStore.getState().openThreadAdjacent(ref("c"), "env-1:a", "before")).toBe(
      true,
    );
    expect(useChatWorkspaceStore.getState().activePaneId).toBe("env-1:c");
    expect(useChatWorkspaceStore.getState().openThreadAdjacent(ref("d"), "env-1:b", "after")).toBe(
      false,
    );
    expect(useChatWorkspaceStore.getState().panes.map((entry) => entry.id)).toEqual([
      "env-1:a",
      "env-1:b",
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
