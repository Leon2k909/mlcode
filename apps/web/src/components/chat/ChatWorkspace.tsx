import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { GripVerticalIcon, PanelRightOpenIcon, XIcon } from "lucide-react";
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
  MAX_CHAT_WORKSPACE_PANES,
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
  const atLimit = props.paneCount >= MAX_CHAT_WORKSPACE_PANES;
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
          label={atLimit ? "Maximum of 3 chat panes" : "Open another chat to the side"}
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
  readonly canReorder: boolean;
  readonly onActivate: (threadRef: ScopedThreadRef) => void;
  readonly onOpenThreadToSide: () => void;
  readonly onClose: (paneId: string) => void;
}) {
  const sortable = useSortable({ id: props.pane.id, disabled: !props.canReorder });
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
      data-workspace-pane-active={props.active ? "true" : undefined}
      className={cn(
        "relative flex min-h-0 min-w-0 overflow-hidden bg-background",
        props.active && props.multiPane && "ring-1 ring-inset ring-primary/20",
        sortable.isDragging && "z-30 opacity-90 shadow-xl",
      )}
      onPointerDownCapture={(event) => activateUnlessControl(event.target)}
      onFocusCapture={(event) => activateUnlessControl(event.target)}
    >
      <ChatThreadPane
        pane={props.pane}
        active={props.active}
        multiPane={props.multiPane}
        reserveTitleBarControlInset={props.reserveTitleBarControlInset}
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
  readonly onActivate: (threadRef: ScopedThreadRef) => void;
  readonly onClose: (paneId: string) => void;
}) {
  const shell = useThreadShell(props.pane.threadRef);
  const title = shell?.title ?? "Loading chat";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center border-r border-border",
        props.active ? "bg-background text-foreground" : "bg-muted/35 text-muted-foreground",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-current={props.active ? "page" : undefined}
        onClick={() => props.onActivate(props.pane.threadRef)}
      >
        {title}
      </button>
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="mr-1 inline-flex size-6 items-center justify-center rounded-[var(--control-radius)] hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => props.onClose(props.pane.id)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

function PaneResizeHandle(props: {
  readonly before: ChatWorkspacePane;
  readonly after: ChatWorkspacePane;
  readonly containerWidth: number;
  readonly onPreview: (sizes: Readonly<Record<string, number>>) => void;
  readonly onCommit: (sizes: Readonly<Record<string, number>>) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    beforeSize: number;
    afterSize: number;
    pending: Readonly<Record<string, number>>;
    rafId: number | null;
    target: HTMLElement;
  } | null>(null);
  const safeContainerWidth = Math.max(props.containerWidth, MIN_CHAT_WORKSPACE_PANE_WIDTH * 2);
  const total = props.before.size + props.after.size;
  const minimum = Math.min(total / 2, MIN_CHAT_WORKSPACE_PANE_WIDTH / safeContainerWidth);

  const resize = useCallback(
    (deltaPixels: number): Readonly<Record<string, number>> => {
      const nextBefore = Math.max(
        minimum,
        Math.min(total - minimum, props.before.size + deltaPixels / safeContainerWidth),
      );
      return {
        [props.before.id]: nextBefore,
        [props.after.id]: total - nextBefore,
      };
    },
    [minimum, props.after.id, props.before.id, props.before.size, safeContainerWidth, total],
  );
  const release = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.rafId !== null) cancelAnimationFrame(drag.rafId);
    if (drag.target.hasPointerCapture(pointerId)) drag.target.releasePointerCapture(pointerId);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    dragRef.current = null;
  }, []);
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        beforeSize: props.before.size,
        afterSize: props.after.size,
        pending: {},
        rafId: null,
        target: event.currentTarget,
      };
    },
    [props.after.size, props.before.size],
  );
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.pending = resize(event.clientX - drag.startX);
      if (drag.rafId !== null) return;
      drag.rafId = requestAnimationFrame(() => {
        const current = dragRef.current;
        if (!current) return;
        current.rafId = null;
        props.onPreview(current.pending);
      });
    },
    [props, resize],
  );
  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const sizes = resize(event.clientX - drag.startX);
      release(event.pointerId);
      props.onPreview(sizes);
      props.onCommit(sizes);
    },
    [props, release, resize],
  );
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const sizes = resize(event.key === "ArrowLeft" ? -24 : 24);
      props.onPreview(sizes);
      props.onCommit(sizes);
    },
    [props, resize],
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
      className="group relative z-20 -mx-1 w-2 cursor-col-resize select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => release(event.pointerId)}
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
  const [previewSizes, setPreviewSizes] = useState<Readonly<Record<string, number>>>({});

  useLayoutEffect(() => {
    useChatWorkspaceStore.getState().replaceActiveThread(activeThreadRef);
  }, [activeRoutePaneId, activeThreadRef]);

  useEffect(() => {
    if (!allBootstrapped) return;
    useChatWorkspaceStore
      .getState()
      .reconcilePanes(new Set([...allThreadRefs.map(scopedThreadKey), activeRoutePaneId]));
  }, [activeRoutePaneId, allBootstrapped, allThreadRefs]);

  useEffect(() => {
    setPreviewSizes({});
  }, [panes]);

  const renderedPanes = useMemo(
    () =>
      normalizePaneSizes(
        panes.map((pane) => ({ ...pane, size: previewSizes[pane.id] ?? pane.size })),
      ),
    [panes, previewSizes],
  );
  const visiblePaneIds = useMemo(
    () => visibleWorkspacePaneIds({ panes: renderedPanes, activePaneId, availableWidth: width }),
    [activePaneId, renderedPanes, width],
  );
  const visiblePanes = useMemo(
    () => renderedPanes.filter((pane) => visiblePaneIds.includes(pane.id)),
    [renderedPanes, visiblePaneIds],
  );
  const hasCollapsedPanes = visiblePanes.length < renderedPanes.length;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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
  const onDragEnd = useCallback((event: DragEndEvent) => {
    if (!event.over) return;
    useChatWorkspaceStore.getState().reorderPane(String(event.active.id), String(event.over.id));
  }, []);
  const openThreadToSide = useCallback(() => openCommandPalette({ open: "thread-to-side" }), []);
  const commitSizes = useCallback((sizes: Readonly<Record<string, number>>) => {
    useChatWorkspaceStore.getState().setPaneSizes(sizes);
    setPreviewSizes({});
  }, []);

  if (renderedPanes.length === 0) return null;

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {hasCollapsedPanes ? (
        <nav
          aria-label="Open chat panes"
          className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-muted/20"
        >
          {renderedPanes.map((pane) => (
            <WorkspacePaneTab
              key={pane.id}
              pane={pane}
              active={pane.id === activePaneId}
              onActivate={activateThread}
              onClose={closePane}
            />
          ))}
        </nav>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={visiblePanes.map((pane) => pane.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
            style={{
              gridTemplateColumns: visiblePanes
                .map((pane) => `minmax(0, ${pane.size}fr)`)
                .join(" 0px "),
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
                        containerWidth={width}
                        onPreview={(sizes) =>
                          setPreviewSizes((current) => ({ ...current, ...sizes }))
                        }
                        onCommit={commitSizes}
                      />,
                    ]
                  : []),
              ];
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
