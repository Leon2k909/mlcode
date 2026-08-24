import {
  CheckpointRef,
  EmployeeId,
  type EmployeeMap,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  TurnId,
} from "@t3tools/contracts";
import { createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";

vi.mock("@legendapp/list/react", async () => {
  const legendListTestId = "legend-list";

  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    anchoredEndSpace?: {
      anchorIndex: number;
      anchorMaxSize?: number;
      anchorOffset?: number;
      onReady?: (info: { anchorIndex: number }) => void;
    };
    contentInsetEndAdjustment?: number;
    className?: string;
    maintainScrollAtEnd?:
      | boolean
      | {
          animated?: boolean;
          on?: {
            dataChange?: boolean;
            itemLayout?: boolean;
            layout?: boolean;
          };
        };
    maintainVisibleContentPosition?:
      | boolean
      | {
          data?: boolean;
          size?: boolean;
          shouldRestorePosition?: (item: { id: string }) => boolean;
        };
    ref?: Ref<LegendListRef>;
  }) => {
    if (props.anchoredEndSpace) {
      props.anchoredEndSpace.onReady?.({ anchorIndex: props.anchoredEndSpace.anchorIndex });
    }
    return (
      <div
        data-testid={legendListTestId}
        data-anchor-index={props.anchoredEndSpace?.anchorIndex}
        data-anchor-max-size={props.anchoredEndSpace?.anchorMaxSize}
        data-anchor-offset={props.anchoredEndSpace?.anchorOffset}
        data-anchor-on-ready={Boolean(props.anchoredEndSpace?.onReady)}
        data-content-inset-end={props.contentInsetEndAdjustment}
        data-class-name={props.className}
        data-maintain-scroll-at-end={props.maintainScrollAtEnd ? "enabled" : undefined}
        data-maintain-scroll-at-end-animated={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.animated
            : undefined
        }
        data-maintain-scroll-at-end-data-change={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.dataChange
            : undefined
        }
        data-maintain-scroll-at-end-item-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.itemLayout
            : undefined
        }
        data-maintain-scroll-at-end-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.layout
            : undefined
        }
        data-maintain-visible-content-position={
          typeof props.maintainVisibleContentPosition === "object"
            ? "object"
            : props.maintainVisibleContentPosition
        }
        data-maintain-visible-content-position-data={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.data
            : undefined
        }
        data-maintain-visible-content-position-size={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.size
            : undefined
        }
        data-maintain-visible-content-position-restore={
          typeof props.maintainVisibleContentPosition === "object"
            ? Boolean(props.maintainVisibleContentPosition.shouldRestorePosition)
            : undefined
        }
      >
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  };

  return { LegendList };
});

function MockFileDiff(props: {
  fileDiff: { name?: string | null; prevName?: string | null };
  renderCustomHeader?: (fileDiff: {
    name?: string | null;
    prevName?: string | null;
  }) => React.ReactNode;
}) {
  return (
    <div data-testid="file-diff">
      {props.renderCustomHeader?.(props.fileDiff)}
      {props.fileDiff.name ?? props.fileDiff.prevName ?? "diff"}
    </div>
  );
}

vi.mock("@pierre/diffs/react", () => {
  return { FileDiff: MockFileDiff };
});

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;

beforeAll(async () => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });

  ({ MessagesTimeline } = await import("./MessagesTimeline"));
}, 30_000);

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const MESSAGE_CREATED_AT = "2026-03-17T19:12:28.000Z";
const TEST_EMPLOYEES: EmployeeMap = {
  [EmployeeId.make("ceo")]: {
    displayName: "Alex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    role: "CEO",
    instructions: "",
    enabled: true,
  },
  [EmployeeId.make("reviewer")]: {
    displayName: "Riley",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    role: "Reviewer",
    instructions: "",
    enabled: true,
  },
};

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: null,
    runningTurnId: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    contentInsetEndAdjustment: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
  };
}

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string, messageId = MessageId.make("message-1")) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: messageId,
      role: "user" as const,
      text,
      turnId: null,
      createdAt: MESSAGE_CREATED_AT,
      updatedAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

describe("MessagesTimeline", () => {
  it("uses the larger leading inset only when the top fade is enabled", () => {
    const timelineEntries = [buildUserTimelineEntry("Hello")];

    const compactMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );
    const fadedMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} topFadeEnabled />,
    );

    expect(compactMarkup).toContain('class="h-3 sm:h-4"');
    expect(compactMarkup).not.toContain("chat-timeline-scroll-fade");
    expect(fadedMarkup).toContain('class="h-10 sm:h-12"');
    expect(fadedMarkup).toContain("chat-timeline-scroll-fade");
  });

  it("keeps assistant changed-files headers sticky below the thread header", () => {
    const assistantMessageId = MessageId.make("message-assistant-with-files");
    const turnId = TurnId.make("turn-with-files");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{
          turnId,
          state: "completed",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: MESSAGE_CREATED_AT,
        }}
        timelineEntries={[
          {
            id: "entry-assistant-with-files",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "Updated the fixture.",
              turnId,
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              assistantMessageId,
              {
                turnId,
                checkpointTurnCount: 1,
                checkpointRef: CheckpointRef.make("checkpoint-with-files"),
                status: "ready",
                files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
                assistantMessageId,
                completedAt: MESSAGE_CREATED_AT,
              },
            ],
          ])
        }
      />,
    );

    expect(markup).toContain("sticky top-2 z-10");
    expect(markup).not.toContain("self-start");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("!size-[22px]");
    expect(markup).toContain("size-3");
    expect(markup).toContain('aria-label="Collapse all folders"');
    expect(markup).toContain('aria-label="Open diff"');
    expect(markup).toContain("1 changed file");
  });

  it("treats only the strict list end as the live edge", async () => {
    const {
      resolveTimelineIsAtEnd,
      resolveTimelineMinimapHasPersistentGutter,
      resolveTimelineMinimapHeightStyle,
      resolveTimelineMinimapHitStripWidth,
      resolveTimelineMinimapIndexFromPointer,
      resolveTimelineMinimapInteractiveWidth,
      resolveTimelineMinimapTopPercent,
    } = await import("./MessagesTimeline.logic");

    expect(resolveTimelineIsAtEnd({ isAtEnd: true })).toBe(true);
    expect(resolveTimelineIsAtEnd(undefined)).toBeUndefined();
    // Within the pixel band above the content bottom counts as the end...
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: false,
        contentLength: 2000,
        scroll: 1170,
        scrollLength: 800,
      }),
    ).toBe(true);
    // ...but half a viewport up (LegendList's isNearEnd territory) does not.
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: false,
        contentLength: 2000,
        scroll: 900,
        scrollLength: 800,
      }),
    ).toBe(false);
    // The composer inset is part of contentLength and must not count as
    // distance-to-end.
    expect(
      resolveTimelineIsAtEnd(
        { isAtEnd: false, contentLength: 2100, scroll: 1170, scrollLength: 800 },
        100,
      ),
    ).toBe(true);
    // Geometry missing (older state shape): fall back to the strict flag.
    expect(resolveTimelineIsAtEnd({ isAtEnd: false })).toBe(false);

    expect(resolveTimelineMinimapHeightStyle(5)).toBe("min(32px, calc(100vh - 18rem))");
    expect(resolveTimelineMinimapTopPercent(2, 5)).toBe(50);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 350,
      }),
    ).toBe(50);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 999,
      }),
    ).toBe(100);
    expect(resolveTimelineMinimapHasPersistentGutter(832)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(863)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(864)).toBe(true);

    // No usable gutter (zoomed in / narrow pane): the strip must go inert
    // instead of overlaying the centered content column.
    expect(resolveTimelineMinimapHitStripWidth(768)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(792)).toBe(0);
    // Partial gutter: strip shrinks to what fits between the viewport edge
    // and the content column.
    expect(resolveTimelineMinimapHitStripWidth(820)).toBe(14);
    // Full gutter: unchanged 40px-wide strip.
    expect(resolveTimelineMinimapHitStripWidth(872)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(1400)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(0)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(Number.NaN)).toBe(0);

    // The collapsed target stays narrow, but an open preview keeps its full
    // 20rem width plus the 2rem offset from the minimap rail interactive.
    expect(resolveTimelineMinimapInteractiveWidth(0, false)).toBe(0);
    expect(resolveTimelineMinimapInteractiveWidth(14, false)).toBe(14);
    expect(resolveTimelineMinimapInteractiveWidth(40, false)).toBe(40);
    expect(resolveTimelineMinimapInteractiveWidth(0, true)).toBe("22rem");
    expect(resolveTimelineMinimapInteractiveWidth(14, true)).toBe("22rem");
    expect(resolveTimelineMinimapInteractiveWidth(40, true)).toBe("22rem");
  });

  it("anchors a sent attachment message using its measured height", () => {
    const onAnchorReady = vi.fn();
    const firstEntry = buildUserTimelineEntry("First prompt.");
    const secondEntry = {
      ...buildUserTimelineEntry("Newest prompt."),
      id: "entry-2",
      message: {
        ...buildUserTimelineEntry("Newest prompt.").message,
        id: MessageId.make("message-2"),
        attachments: [
          {
            type: "image" as const,
            id: "attachment-1",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1,
            previewUrl: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        anchorMessageId={secondEntry.message.id}
        onAnchorReady={onAnchorReady}
        contentInsetEndAdjustment={144}
        timelineEntries={[firstEntry, secondEntry]}
      />,
    );

    expect(markup).toContain('data-anchor-index="1"');
    expect(markup).toContain('data-anchor-offset="16"');
    expect(markup).toContain('data-anchor-on-ready="true"');
    expect(markup).not.toContain("data-anchor-max-size=");
    expect(markup).toContain('data-content-inset-end="144"');
    expect(markup).toContain("[overflow-anchor:none]");
    expect(markup).not.toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-visible-content-position="object"');
    expect(markup).toContain('data-maintain-visible-content-position-data="true"');
    expect(markup).toContain('data-maintain-visible-content-position-size="true"');
    expect(markup).toContain('data-maintain-visible-content-position-restore="true"');
    expect(onAnchorReady).toHaveBeenCalledOnce();
    expect(onAnchorReady).toHaveBeenCalledWith(secondEntry.message.id, 1);
  });

  it("renders collapse controls for long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain("Show full message");
    expect(markup).toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-scroll-at-end-animated="false"');
    expect(markup).toContain('data-maintain-scroll-at-end-data-change="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-item-layout="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-layout="true"');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-fade="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("does not render collapse controls for short user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("Short prompt.")]}
      />,
    );

    expect(markup).not.toContain("Show full message");
    expect(markup).toContain('data-user-message-collapsible="false"');
    expect(markup).toContain("rounded-2xl bg-message p-3");
  });

  it("renders inline terminal labels with the composer chip UI", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              buildLongUserMessageText("yoo what's @terminal-1:1-5 mean"),
              "",
              "<terminal_context>",
              "- Terminal 1 lines 1-5:",
              "  1 | julius@mac effect-http-ws-cli % bun i",
              "  2 | bun install v1.3.9 (cf6cdbbb)",
              "</terminal_context>",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s</p>");
    expect(markup).toContain('<span aria-hidden="true"> </span>');
    expect(markup).toContain("Show full message");
  }, 20_000);

  it("renders chips for standalone element-pick context messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              "<element_context>",
              "- <SubmitButton> (Button.tsx:12):",
              "  url: https://example.com/dashboard",
              "  selector: button.submit",
              "  source: /repo/src/Button.tsx:12:5",
              "  html:",
              '  <button class="submit">Save</button>',
              "</element_context>",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("SubmitButton");
    expect(markup).not.toContain("&lt;element_context");
    expect(markup).not.toContain("<element_context");
  });

  it("keeps the copy button for collapsed long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain('aria-label="Copy link"');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("renders context compaction entries in the normal work log", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work Log");
  });

  it("formats changed file paths from the workspace root", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts"],
            },
          },
        ]}
        workspaceRoot="C:/Users/mike/dev-stuff/t3code"
      />,
    );

    expect(markup).toContain("t3code/apps/web/src/session-logic.ts");
    expect(markup).not.toContain("C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts");
  });

  it("renders review comment contexts as structured cards instead of raw tags", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-2"),
              role: "user",
              text: [
                '<review_comment sectionId="turn:2" sectionTitle="Turn 2" filePath="apps/web/src/lib/contextWindow.test.ts" startIndex="3" endIndex="14" rangeLabel="+47 to +58">',
                "Wadduo",
                "```diff",
                "@@ -0,0 +47,2 @@",
                '+  it("keeps valid zero-usage snapshots", () => {',
                "+    expect(snapshot).not.toBeNull();",
                "```",
                "</review_comment>",
              ].join("\n"),
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("contextWindow.test.ts");
    expect(markup).toContain("Wadduo");
    expect(markup).toContain('data-testid="file-diff"');
    expect(markup).not.toContain(">Review comment<");
    expect(markup).not.toContain("&lt;review_comment");
    expect(markup).not.toContain("&lt;/review_comment&gt;");
  });

  it("renders file review comments as source code instead of diffs", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-source-comment"),
              role: "user",
              text: [
                '<review_comment sectionId="file:docs/plan.md" sectionTitle="File comment" filePath="docs/plan.md" startIndex="0" endIndex="1" rangeLabel="L1 to L2">',
                "Clarify this.",
                "```md",
                "# Plan",
                "- Step one",
                "```",
                "</review_comment>",
              ].join("\n"),
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("plan.md");
    expect(markup).toContain("Clarify this.");
    expect(markup).toContain("# Plan");
    expect(markup).not.toContain('data-testid="file-diff"');
  });

  it("renders a failure marker for failed tool lifecycle entries", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Glob",
              tone: "tool",
              toolLifecycleStatus: "failed",
              detail: "No files found",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("lucide-x");
    expect(markup).toContain('aria-label="Tool call failed"');
  });

  it("labels employee replies and handoffs separately from provider subagents", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        timelineEntries={[
          {
            id: "employee-response",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("employee-response"),
              role: "assistant",
              employeeId: EmployeeId.make("ceo"),
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5.6-sol",
                options: [{ id: "reasoningEffort", value: "high" }],
                employeeId: EmployeeId.make("ceo"),
                employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
              },
              text: 'The brief is ready.\n<handoff to="reviewer">Review this.</handoff>',
              turnId: TurnId.make("turn-employee"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-t3-worker-kind="employee"');
    expect(markup).toContain("Employee");
    expect(markup).toContain('aria-label="Mark response as not helpful"');
    expect(markup).toContain("via Codex");
    expect(markup).toContain('data-t3-worker-kind="employee-handoff"');
    expect(markup).toContain("Employee handoff");
    expect(markup).toContain("Alex to");
    expect(markup).toContain("Riley");
    expect(markup).toContain("via Claude");
    expect(markup).not.toContain("&lt;handoff");
  });

  it("shows a stopped employee handoff as paused instead of transferred", () => {
    const turnId = TurnId.make("turn-stopped-handoff");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        timelineEntries={[
          {
            id: "stopped-handoff-work",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "stopped-handoff-activity",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              label: "Employee handoff limit reached",
              detail: "The group paused after eight consecutive employee turns.",
              tone: "error",
              sourceActivityKind: "employee.handoff.stopped",
            },
          },
          {
            id: "stopped-handoff-response",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("stopped-handoff-response"),
              role: "assistant",
              employeeId: EmployeeId.make("ceo"),
              text: '<handoff to="reviewer">Review this.</handoff>',
              turnId,
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-t3-worker-kind="employee-handoff-stopped"');
    expect(markup).toContain("Employee workflow paused");
    expect(markup).toContain("The group paused after eight consecutive employee turns.");
    expect(markup).not.toContain('data-t3-worker-kind="employee-handoff"');
    expect(markup).not.toContain("Employee handoff</span>");
  });

  it("shows response feedback for ordinary assistant replies", () => {
    const turnId = TurnId.make("turn-provider-response");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{
          turnId,
          state: "completed",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: MESSAGE_CREATED_AT,
        }}
        timelineEntries={[
          {
            id: "provider-response",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("provider-response"),
              role: "assistant",
              text: "The answer is ready.",
              turnId,
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('aria-label="Mark response as not helpful"');
  });

  it("labels the available checkpoint action as delete and rewind", () => {
    const messageId = MessageId.make("message-1");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        revertTurnCountByUserMessageId={new Map([[messageId, 0]])}
        timelineEntries={[buildUserTimelineEntry("Sent to the wrong chat.")]}
      />,
    );

    expect(markup).toContain('aria-label="Delete this message and rewind"');
    expect(markup).toContain("Delete &amp; rewind");
    expect(markup).toContain('title="Delete this message and rewind the thread to before it"');
    expect(markup).toContain('data-user-message-actions="true"');
    expect(markup).toContain("opacity-0");
    expect(markup).toContain("group-hover:opacity-100");
  });

  it("shows delete-only for a latest message without a Git checkpoint", () => {
    const messageId = MessageId.make("message-without-checkpoint");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        deletableUserMessageId={messageId}
        timelineEntries={[buildUserTimelineEntry("Sent to the wrong chat.", messageId)]}
      />,
    );

    expect(markup).toContain('aria-label="Delete this message"');
    expect(markup).toContain("Delete message");
    expect(markup).not.toContain("Delete &amp; rewind");
  });

  it("does not present a rejected self-handoff as an employee transfer", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        timelineEntries={[
          {
            id: "employee-self-handoff",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("employee-self-handoff"),
              role: "assistant",
              employeeId: EmployeeId.make("ceo"),
              text: 'Done.\n<handoff to="ceo">Continue.</handoff>',
              turnId: TurnId.make("turn-self-handoff"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Done.");
    expect(markup).not.toContain('data-t3-worker-kind="employee-handoff"');
    expect(markup).not.toContain("Alex to");
    expect(markup).not.toContain("Continue.");
  });

  it("keeps durable employee attribution on a legacy row without inventing model badges", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        modelSelection={{
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-fable-5",
          options: [{ id: "effort", value: "max" }],
          employeeId: EmployeeId.make("ceo"),
          employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
        }}
        timelineEntries={[
          {
            id: "legacy-employee-response",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("legacy-employee-response"),
              role: "assistant",
              employeeId: EmployeeId.make("ceo"),
              text: "The CEO handled this.",
              turnId: TurnId.make("turn-legacy-employee"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-t3-worker-kind="employee"');
    expect(markup).toContain("Alex");
    expect(markup).not.toContain("claude-fable-5");
    expect(markup).not.toContain("reasoning Max");
    expect(markup).not.toContain("via Claude");
    expect(markup).not.toContain('title="Alex uses');
  });

  it("does not relabel an ordinary legacy row after the thread switches providers", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        modelSelection={{
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-fable-5",
          options: [{ id: "effort", value: "max" }],
        }}
        timelineEntries={[
          {
            id: "legacy-provider-response",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("legacy-provider-response"),
              role: "assistant",
              text: "This response predates per-message model metadata.",
              turnId: TurnId.make("turn-legacy-provider"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("This response predates per-message model metadata.");
    expect(markup).not.toContain('data-t3-worker-kind="employee"');
    expect(markup).not.toContain("claude-fable-5");
    expect(markup).not.toContain("reasoning Max");
    expect(markup).not.toContain("via Claude");
  });

  it("uses each assistant row's persisted selection instead of the latest thread selection", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        modelSelection={{
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-sol",
          options: [{ id: "reasoningEffort", value: "ultra" }],
          employeeId: EmployeeId.make("ceo"),
          employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
        }}
        timelineEntries={[
          {
            id: "persisted-worker-selection",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("persisted-worker-selection"),
              role: "assistant",
              employeeId: EmployeeId.make("reviewer"),
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5.6-luna",
                options: [{ id: "reasoningEffort", value: "low" }],
                employeeId: EmployeeId.make("reviewer"),
                employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
              },
              text: "The routine check passed.",
              turnId: TurnId.make("turn-persisted-worker-selection"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('title="Riley uses gpt-5.6-luna via Codex at Low reasoning"');
    expect(markup).not.toContain("model gpt-5.6-sol");
    expect(markup).not.toContain("reasoning Ultra");
  });

  it("keeps an ordinary assistant row's provider badges after the thread switches providers", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        modelSelection={{
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-fable-5",
          options: [{ id: "effort", value: "max" }],
        }}
        timelineEntries={[
          {
            id: "persisted-codex-selection",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("persisted-codex-selection"),
              role: "assistant",
              modelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5.6-sol",
                options: [{ id: "reasoningEffort", value: "high" }],
              },
              text: "This response was produced before the provider changed.",
              turnId: TurnId.make("turn-persisted-codex-selection"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("model gpt-5.6-sol");
    expect(markup).toContain("reasoning High");
    expect(markup).toContain("via Codex");
    expect(markup).not.toContain("claude-fable-5");
    expect(markup).not.toContain("reasoning Max");
    expect(markup).not.toContain("via Claude");
  });

  it("shows Claude effort levels in employee attribution", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        modelSelection={{
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-5",
          options: [{ id: "effort", value: "max" }],
          employeeId: EmployeeId.make("ceo"),
          employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
        }}
        timelineEntries={[
          {
            id: "claude-employee-response",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("claude-employee-response"),
              role: "assistant",
              employeeId: EmployeeId.make("ceo"),
              modelSelection: {
                instanceId: ProviderInstanceId.make("claudeAgent"),
                model: "claude-opus-5",
                options: [{ id: "effort", value: "max" }],
                employeeId: EmployeeId.make("ceo"),
                employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
              },
              text: "The Claude employee handled this.",
              turnId: TurnId.make("turn-claude-employee"),
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("reasoning Max");
    expect(markup).toContain('title="Alex uses claude-opus-5 via Claude at Max reasoning"');
  });

  it("renders employee handoff prompts as an internal teammate message", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        timelineEntries={[
          {
            id: "employee-handoff-message",
            kind: "message",
            createdAt: MESSAGE_CREATED_AT,
            message: {
              id: MessageId.make("employee-handoff-message"),
              role: "user",
              text: "To Riley, from Alex:\n\nPlease inspect the implementation.",
              turnId: null,
              createdAt: MESSAGE_CREATED_AT,
              updatedAt: MESSAGE_CREATED_AT,
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-employee-message="true"');
    expect(markup).toContain('data-employee-handoff-message="true"');
    expect(markup).toContain('data-chat-employee-id="ceo"');
    expect(markup).toContain("Alex");
    expect(markup).toContain("to Riley");
    expect(markup).toContain("Please inspect the implementation.");
    expect(markup).not.toContain("To Riley, from Alex:");
    expect(markup).not.toContain("bg-message p-3");
  });

  it("marks employee names inside provider plans as planned, not running", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        employees={TEST_EMPLOYEES}
        timelineEntries={[
          {
            id: "turn-plan:turn-employee",
            kind: "turn-plan",
            createdAt: MESSAGE_CREATED_AT,
            turnPlan: {
              id: "turn-plan:turn-employee",
              createdAt: MESSAGE_CREATED_AT,
              turnId: TurnId.make("turn-employee"),
              plan: {
                createdAt: MESSAGE_CREATED_AT,
                turnId: TurnId.make("turn-employee"),
                steps: [
                  {
                    step: "Hand Riley a focused independent product-ideas brief",
                    status: "inProgress",
                  },
                ],
              },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-plan-t3-employees="reviewer"');
    expect(markup).toContain("Employee: Riley (planned)");
    expect(markup).toContain("has not started from this plan item");
  });

  it("calls temporary spawned workers provider subagents", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "provider-spawn",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "provider-spawn",
              createdAt: MESSAGE_CREATED_AT,
              label: "Spawned reviewer",
              tone: "tool",
              agentSpawn: {
                workflowId: null,
                agentTaskIds: ["temporary-agent-1"],
              },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-t3-worker-kind="provider-subagent"');
    expect(markup).toContain("Ran 1 provider subagent");
    expect(markup).toContain("not workspace employees");
  });
});
