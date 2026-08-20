import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveChatWorkspaceDropAction,
  sidebarThreadDragData,
  sidebarThreadDragId,
  workspacePaneDragData,
  workspacePaneDragId,
} from "./ChatWorkspaceDnd";

const threadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
const sidebarData = sidebarThreadDragData({
  threadKey: "env-1:thread-1",
  threadRef,
  title: "Thread one",
  pinned: false,
});

describe("chat workspace drag identities", () => {
  it("namespaces sidebar threads and workspace panes", () => {
    expect(sidebarThreadDragId("env-1:thread-1")).toBe("sidebar-thread:env-1:thread-1");
    expect(workspacePaneDragId("env-1:thread-1")).toBe("workspace-pane:env-1:thread-1");
  });
});

describe("resolveChatWorkspaceDropAction", () => {
  it("docks sidebar threads on the selected pane edge", () => {
    expect(
      resolveChatWorkspaceDropAction({
        activeData: sidebarData,
        overData: workspacePaneDragData("env-1:target"),
        paneDrop: { paneId: "env-1:target", side: "before", allowed: true },
      }),
    ).toEqual({
      kind: "dock-thread",
      threadRef,
      targetPaneId: "env-1:target",
      side: "before",
    });
  });

  it("keeps pane and pinned-thread reorder paths distinct", () => {
    expect(
      resolveChatWorkspaceDropAction({
        activeData: workspacePaneDragData("env-1:a"),
        overData: workspacePaneDragData("env-1:b"),
        paneDrop: null,
      }),
    ).toEqual({ kind: "reorder-pane", activePaneId: "env-1:a", overPaneId: "env-1:b" });

    expect(
      resolveChatWorkspaceDropAction({
        activeData: { ...sidebarData, pinned: true },
        overData: {
          ...sidebarData,
          threadKey: "env-1:thread-2",
          threadRef: scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-2")),
          pinned: true,
        },
        paneDrop: null,
      }),
    ).toEqual({
      kind: "reorder-pinned",
      activeThreadKey: "env-1:thread-1",
      overThreadKey: "env-1:thread-2",
    });
  });

  it("ignores invalid cross-surface drops", () => {
    expect(
      resolveChatWorkspaceDropAction({
        activeData: sidebarData,
        overData: { ...sidebarData, threadKey: "env-1:thread-2" },
        paneDrop: null,
      }),
    ).toBeNull();
  });
});
