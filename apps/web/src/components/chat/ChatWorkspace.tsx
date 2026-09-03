import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { GripVerticalIcon, PanelRightOpenIcon, PlusIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  MAX_CHAT_WORKSPACE_TABS,
  MIN_CHAT_WORKSPACE_PANE_WIDTH,
  normalizePaneSizes,
  useChatWorkspaceStore,
  visibleWorkspacePaneIds,
  type ChatWorkspacePane,
} from "~/chatWorkspaceStore";
import { openCommandPalette } from "~/commandPaletteBus";
import { buildThreadRouteParams } from "~/threadRoutes";
import { resolveThreadSyncPhase } from "~/threadSync";
import {
  useAllEnvironmentShellsBootstrapped,
  useThreadDetail,
  useThreadRefs,
  useThreadShell,
  useThreadStatus,
} from "~/state/entities";
import { cn } from "~/lib/utils";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildWorkspaceGridTemplate, resizeAdjacentPanePair } from "./ChatWorkspace.logic";
import {
  useWorkspacePaneDropIndicator,
  workspacePaneDragData,
  workspacePaneDragId,
} from "./ChatWorkspaceDnd";

interface ChatWorkspaceProps {
  readonly activeThreadRef: ScopedThreadRef;
}

function useMeasuredWidth(): {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly width: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function WorkspaceIconButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-workspace-pane-control
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            className="[-webkit-app-region:no-drag]"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function ChatPaneHeaderControls(props: {
  readonly paneId: string;
  readonly active: boolean;
  readonly paneCount: number;
  readonly canReorder: boolean;
  readonly dragAttributes: ReturnType<typeof useSortable>["attributes"];
  readonly dragListeners: ReturnType<typeof useSortable>["listeners"];
  readonly setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
  readonly onOpenThreadToSide: () => void;
  readonly onClose: (paneId: string) => void;
}) {
  const atLimit = props.paneCount >= MAX_CHAT_WORKSPACE_TABS;
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      {props.canReorder ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                ref={props.setActivatorNodeRef}
                data-workspace-pane-control
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Move chat pane"
                className="cursor-grab touch-none [-webkit-app-region:no-drag] active:cursor-grabbing"
                {...props.dragAttributes}
                {...props.dragListeners}
              />
            }
          >
            <GripVerticalIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Move chat pane</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.active ? (
        <WorkspaceIconButton
          label={atLimit ? "Maximum of 12 open chats" : "Open another chat to the side"}
          disabled={atLimit}
          onClick={props.onOpenThreadToSide}
        >
          <PanelRightOpenIcon />
        </WorkspaceIconButton>
      ) : null}
      {props.paneCount > 1 ? (
        <WorkspaceIconButton label="Close chat pane" onClick={() => props.onClose(props.paneId)}>
          <XIcon />
        </WorkspaceIconButton>
      ) : null}
    </div>
  );
}

function ChatThreadPane(props: {
  readonly pane: ChatWorkspacePane;
  readonly active: boolean;
  readonly multiPane: boolean;
  readonly reserveTitleBarControlInset: boolean;
  readonly reserveSidebarToggleInset: boolean;
  readonly headerControls: ReactNode;
}) {
  const shell = useThreadShell(props.pane.threadRef);
  const detail = useThreadDetail(props.pane.threadRef);
  const status = useThreadStatus(props.pane.threadRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: detail !== null,
    shellExists: shell !== null,
    status,
  });

  if (!shell && !detail) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
        Loading chat...
      </div>
    );
  }

  return (
    <ChatView
      environmentId={props.pane.threadRef.environmentId}
      threadId={props.pane.threadRef.threadId}
      routeKind="server"
      threadSyncPhase={threadSyncPhase}
      reserveTitleBarControlInset={props.reserveTitleBarControlInset}
      reserveSidebarToggleInset={props.reserveSidebarToggleInset}
      workspaceActive={props.active}
      workspaceMultiPane={props.multiPane}
      workspaceHeaderControls={props.headerControls}
    />
  );
}

function SortableChatPane(props: {
  readonly pane: ChatWorkspacePane;
  readonly active: boolean;
  readonly multiPane: boolean;
  readonly reserveTitleBarControlInset: boolean;
  readonly reserveSidebarToggleInset: boolean;
  readonly canReorder: boolean;
  readonly onActivate: (threadRef: ScopedThreadRef) => void;
  readonly onOpenThreadToSide: () => void;
  readonly onClose: (paneId: string) => void;
}) {
  const sortable = useSortable({
    id: workspacePaneDragId(props.pane.id),
    disabled: { draggable: !props.canReorder, droppable: false },
    data: workspacePaneDragData(props.pane.id),
  });
  const dropIndicator = useWorkspacePaneDropIndicator(props.pane.id);
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const activate = useCallback(() => {
    if (!props.active) props.onActivate(props.pane.threadRef);
  }, [props.active, props.onActivate, props.pane.threadRef]);
  const activateUnlessControl = useCallback(
    (target: EventTarget | null) => {
      if (target instanceof Element && target.closest("[data-workspace-pane-control]")) return;
      activate();
    },
    [activate],
  );

  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      aria-label="Chat pane"
      data-workspace-pane-id={props.pane.id}
      data-workspace-pane-active={props.active ? "true" : undefined}
      className={cn(
        "relative flex min-h-0 min-w-0 overflow-hidden bg-background",
        props.active && props.multiPane && "ring-1 ring-inset ring-primary/20",
        sortable.isDragging && "z-30 opacity-90 shadow-xl",
      )}
      onPointerDownCapture={(event) => activateUnlessControl(event.target)}
      onFocusCapture={(event) => activateUnlessControl(event.target)}
    >
      {dropIndicator ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 z-40 w-0.5",
            dropIndicator.side === "before" ? "left-0" : "right-0",
            dropIndicator.allowed ? "bg-primary" : "bg-destructive",
          )}
        />
      ) : null}
      <ChatThreadPane
        pane={props.pane}
        active={props.active}
        multiPane={props.multiPane}
        reserveTitleBarControlInset={props.reserveTitleBarControlInset}
        reserveSidebarToggleInset={props.reserveSidebarToggleInset}
        headerControls={
          <ChatPaneHeaderControls
            paneId={props.pane.id}
            active={props.active}
            paneCount={useChatWorkspaceStore.getState().panes.length}
            canReorder={props.canReorder}
            dragAttributes={sortable.attributes}
            dragListeners={sortable.listeners}
            setActivatorNodeRef={sortable.setActivatorNodeRef}
            onOpenThreadToSide={props.onOpenThreadToSide}
            onClose={props.onClose}
          />
        }
      />
    </section>
  );
}

function WorkspacePaneTab(props: {
  readonly pane: ChatWorkspacePane;
  readonly active: boolean;
  readonly showClose: boolean;
  readonly onActivate: (threadRef: ScopedThreadRef) => void;
  readonly onClose: (paneId: string) => void;
}) {
  const shell = useThreadShell(props.pane.threadRef);
  const title = shell?.title ?? "Loading chat";
  return (
    <div
      className={cn(
        // Tabs read as tabs: a bottom seam under inactive ones, none under the
        // active one so it joins the pane below.
        "group/tab flex min-w-0 max-w-56 items-center border-r border-border",
        props.active
          ? "bg-background text-foreground"
          : "bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate py-1.5 pl-3 pr-1 text-left text-xs font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [-webkit-app-region:no-drag]"
        aria-current={props.active ? "page" : undefined}
        onClick={() => props.onActivate(props.pane.threadRef)}
      >
        {title}
      </button>
      {props.showClose ? (
        <button
          type="button"
          aria-label={`Close ${title}`}
          className={cn(
            "mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--control-radius)] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/tab:opacity-100 [-webkit-app-region:no-drag]",
            // Always reachable on the active tab; a hover-reveal on the rest so
            // a wall of tabs is not a wall of close buttons.
            props.active ? "opacity-100" : "opacity-0",
          )}
          onClick={() => props.onClose(props.pane.id)}
        >
          <XIcon className="size-3.5" />
        </button>
      ) : (
        <span className="mr-1 inline-block size-6 shrink-0" aria-hidden />
      )}
    </div>
  );
}

function PaneResizeHandle(props: {
  readonly before: ChatWorkspacePane;
  readonly after: ChatWorkspacePane;
  readonly panes: ReadonlyArray<ChatWorkspacePane>;
  readonly gridRef: RefObject<HTMLDivElement | null>;
  readonly availableWidth: number;
  readonly onCommit: (sizes: Readonly<Record<string, number>>) => void;
}) {
  const dragRef = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startSizes: ReadonlyArray<number>;
    readonly containerWidth: number;
    readonly originalTemplate: string;
    readonly target: HTMLElement;
    pendingSizes: ReadonlyArray<number>;
    rafId: number | null;
  } | null>(null);
  const total = props.before.size + props.after.size;
  const beforeIndex = props.panes.findIndex((pane) => pane.id === props.before.id);
  const afterIndex = props.panes.findIndex((pane) => pane.id === props.after.id);
  const safeGridWidth = Math.max(props.availableWidth, MIN_CHAT_WORKSPACE_PANE_WIDTH * 2);
  const minimum = Math.min(total / 2, MIN_CHAT_WORKSPACE_PANE_WIDTH / safeGridWidth);
  const sizesToRecord = useCallback(
    (sizes: ReadonlyArray<number>): Readonly<Record<string, number>> =>
      Object.fromEntries(props.panes.map((pane, index) => [pane.id, sizes[index] ?? pane.size])),
    [props.panes],
  );
  const resize = useCallback(
    (input: {
      readonly startSizes: ReadonlyArray<number>;
      readonly startX: number;
      readonly currentX: number;
      readonly containerWidth: number;
    }) =>
      resizeAdjacentPanePair({
        paneSizes: input.startSizes,
        beforeIndex,
        afterIndex,
        startX: input.startX,
        currentX: input.currentX,
        containerWidth: input.containerWidth,
        minimumPaneWidth: MIN_CHAT_WORKSPACE_PANE_WIDTH,
      }),
    [afterIndex, beforeIndex],
  );
  const release = useCallback(
    (pointerId: number, restore: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.rafId !== null) cancelAnimationFrame(drag.rafId);
      if (restore && props.gridRef.current) {
        props.gridRef.current.style.gridTemplateColumns = drag.originalTemplate;
      }
      if (drag.target.hasPointerCapture(pointerId)) drag.target.releasePointerCapture(pointerId);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      dragRef.current = null;
    },
    [props.gridRef],
  );
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.rafId !== null) cancelAnimationFrame(drag.rafId);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [],
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const grid = props.gridRef.current;
      if (!grid || beforeIndex < 0 || afterIndex < 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const startSizes = props.panes.map((pane) => pane.size);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startSizes,
        containerWidth: Math.max(grid.getBoundingClientRect().width, 1),
        originalTemplate: buildWorkspaceGridTemplate(startSizes),
        pendingSizes: startSizes,
        rafId: null,
        target: event.currentTarget,
      };
    },
    [afterIndex, beforeIndex, props.gridRef, props.panes],
  );
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.pendingSizes = resize({
        startSizes: drag.startSizes,
        startX: drag.startX,
        currentX: event.clientX,
        containerWidth: drag.containerWidth,
      });
      if (drag.rafId !== null) return;
      drag.rafId = requestAnimationFrame(() => {
        const current = dragRef.current;
        const grid = props.gridRef.current;
        if (!current || !grid) return;
        current.rafId = null;
        grid.style.gridTemplateColumns = buildWorkspaceGridTemplate(current.pendingSizes);
      });
    },
    [props.gridRef, resize],
  );
  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const sizes = resize({
        startSizes: drag.startSizes,
        startX: drag.startX,
        currentX: event.clientX,
        containerWidth: drag.containerWidth,
      });
      const grid = props.gridRef.current;
      if (grid) grid.style.gridTemplateColumns = buildWorkspaceGridTemplate(sizes);
      release(event.pointerId, false);
      props.onCommit(sizesToRecord(sizes));
    },
    [props, release, resize, sizesToRecord],
  );
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const startSizes = props.panes.map((pane) => pane.size);
      const sizes = resize({
        startSizes,
        startX: 0,
        currentX: event.key === "ArrowLeft" ? -24 : 24,
        containerWidth: safeGridWidth,
      });
      props.onCommit(sizesToRecord(sizes));
    },
    [props, resize, safeGridWidth, sizesToRecord],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize chat panes"
      aria-orientation="vertical"
      aria-valuemin={Math.round((minimum / total) * 100)}
      aria-valuemax={Math.round(((total - minimum) / total) * 100)}
      aria-valuenow={Math.round((props.before.size / total) * 100)}
      className="group relative z-20 -mx-1 w-2 touch-none cursor-col-resize select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => release(event.pointerId, true)}
      onKeyDown={onKeyDown}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary/60" />
    </div>
  );
}

export function ChatWorkspace({ activeThreadRef }: ChatWorkspaceProps) {
  const navigate = useNavigate();
  const activeRoutePaneId = scopedThreadKey(activeThreadRef);
  const panes = useChatWorkspaceStore((state) => state.panes);
  const activePaneId = useChatWorkspaceStore((state) => state.activePaneId);
  const allThreadRefs = useThreadRefs();
  const allBootstrapped = useAllEnvironmentShellsBootstrapped();
  const { ref: containerRef, width } = useMeasuredWidth();
  const gridRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    useChatWorkspaceStore.getState().replaceActiveThread(activeThreadRef);
  }, [activeRoutePaneId, activeThreadRef]);

  useEffect(() => {
    if (!allBootstrapped) return;
    useChatWorkspaceStore
      .getState()
      .reconcilePanes(new Set([...allThreadRefs.map(scopedThreadKey), activeRoutePaneId]));
  }, [activeRoutePaneId, allBootstrapped, allThreadRefs]);

  const renderedPanes = useMemo(() => normalizePaneSizes(panes), [panes]);
  const visiblePaneIds = useMemo(
    () => visibleWorkspacePaneIds({ panes: renderedPanes, activePaneId, availableWidth: width }),
    [activePaneId, renderedPanes, width],
  );
  const visiblePanes = useMemo(
    () => renderedPanes.filter((pane) => visiblePaneIds.includes(pane.id)),
    [renderedPanes, visiblePaneIds],
  );
  const hasCollapsedPanes = visiblePanes.length < renderedPanes.length;

  const activateThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      const paneId = scopedThreadKey(threadRef);
      useChatWorkspaceStore.getState().activatePane(paneId);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate],
  );
  const closePane = useCallback(
    (paneId: string) => {
      const wasActive = useChatWorkspaceStore.getState().activePaneId === paneId;
      const nextThreadRef = useChatWorkspaceStore.getState().closePane(paneId);
      if (!wasActive) return;
      if (!nextThreadRef) {
        void navigate({ to: "/" });
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(nextThreadRef),
        replace: true,
      });
    },
    [navigate],
  );
  const openThreadToSide = useCallback(() => openCommandPalette({ open: "thread-to-side" }), []);
  // The tab strip's "+": start a fresh chat. It lands on the new-thread view;
  // once that chat is real it joins the strip as its own tab.
  const openNewChatTab = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);
  const commitSizes = useCallback((sizes: Readonly<Record<string, number>>) => {
    useChatWorkspaceStore.getState().setPaneSizes(sizes);
  }, []);

  if (renderedPanes.length === 0) return null;

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <nav
        aria-label="Open chats"
        // The strip is the topmost row, so on the frameless desktop build it
        // shares the titlebar band: reserve the OS window-control gutter on the
        // right so the "+" never hides under the min/close buttons, and let the
        // empty track drag the window (its buttons opt back out with no-drag).
        className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-muted/20 [-webkit-app-region:drag] wco:pr-[var(--workspace-native-controls-inset)]"
      >
        {renderedPanes.map((pane) => (
          <WorkspacePaneTab
            key={pane.id}
            pane={pane}
            active={pane.id === activePaneId}
            showClose={renderedPanes.length > 1}
            onActivate={activateThread}
            onClose={closePane}
          />
        ))}
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          className="flex shrink-0 items-center justify-center px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [-webkit-app-region:no-drag]"
          onClick={openNewChatTab}
        >
          <PlusIcon className="size-4" />
        </button>
      </nav>
      <SortableContext
        items={visiblePanes.map((pane) => workspacePaneDragId(pane.id))}
        strategy={horizontalListSortingStrategy}
      >
        <div
          ref={gridRef}
          className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{
            gridTemplateColumns: buildWorkspaceGridTemplate(visiblePanes.map((p) => p.size)),
          }}
        >
          {visiblePanes.flatMap((pane, index) => {
            const nextPane = visiblePanes[index + 1];
            return [
              <SortableChatPane
                key={pane.id}
                pane={pane}
                active={pane.id === activePaneId}
                multiPane={renderedPanes.length > 1}
                reserveTitleBarControlInset={index === visiblePanes.length - 1}
                reserveSidebarToggleInset={index === 0}
                canReorder={!hasCollapsedPanes && visiblePanes.length > 1}
                onActivate={activateThread}
                onOpenThreadToSide={openThreadToSide}
                onClose={closePane}
              />,
              ...(nextPane
                ? [
                    <PaneResizeHandle
                      key={`${pane.id}:${nextPane.id}:separator`}
                      before={pane}
                      after={nextPane}
                      panes={visiblePanes}
                      gridRef={gridRef}
                      availableWidth={width}
                      onCommit={commitSizes}
                    />,
                  ]
                : []),
            ];
          })}
        </div>
      </SortableContext>
    </div>
  );
}
