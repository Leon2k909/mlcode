import type { ScopedProjectRef } from "@t3tools/contracts";
import { displayMlCodeProjectName } from "@t3tools/shared/productBranding";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EyeIcon, FolderPlusIcon, XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import {
  useClientSettings,
  useSetProjectHidden,
  useUpdateClientSettings,
} from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  selectVisibleProjectPickerEntries,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface DraftHeroHeadlineProps {
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

/**
 * What a project is, and where it lives. Two projects can carry the same
 * display name, so the path is the part that identifies one.
 */
function ProjectLocation({
  displayName,
  workspaceRoot,
  environmentLabel,
}: {
  readonly displayName: string;
  readonly workspaceRoot: string | null;
  readonly environmentLabel: string | null;
}) {
  return (
    <span className="block text-left">
      <span className="block">{displayName}</span>
      {workspaceRoot ? (
        <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
          {workspaceRoot}
        </span>
      ) : null}
      {environmentLabel ? (
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{environmentLabel}</span>
      ) : null}
    </span>
  );
}

export function DraftHeroHeadline({
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const hiddenProjectKeys = useClientSettings((settings) => settings.hiddenProjectKeys);
  const updateClientSettings = useUpdateClientSettings();
  const setProjectHidden = useSetProjectHidden();
  const handleNewThread = useNewThreadHandler();
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const activeProjectDisplayName =
    activeProjectName === null ? null : displayMlCodeProjectName(activeProjectName);
  const visibleProjectEntries = useMemo(
    () =>
      selectVisibleProjectPickerEntries({
        entries: projectPickerEntries,
        hiddenProjectKeys,
        alwaysVisibleProjectKey: activeProjectKey,
      }),
    [activeProjectKey, hiddenProjectKeys, projectPickerEntries],
  );
  const hiddenProjectCount = projectPickerEntries.length - visibleProjectEntries.length;

  const hideProject = useCallback(
    (projectKey: string, displayName: string) => {
      setProjectHidden(projectKey, true);
      toastManager.add({
        type: "success",
        title: `${displayName} hidden`,
        description: "Its threads stay in the sidebar. Nothing was deleted.",
        actionProps: {
          children: "Undo",
          onClick: () => {
            setProjectHidden(projectKey, false);
          },
        },
      });
    },
    [setProjectHidden],
  );
  const showHiddenProjects = useCallback(() => {
    updateClientSettings({ hiddenProjectKeys: [] });
  }, [updateClientSettings]);

  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
              className="pointer-events-auto inline-block max-w-64 truncate border-foreground/60 border-b border-dotted align-baseline text-foreground transition-colors hover:border-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          {activeProjectDisplayName ?? "Choose a project"}
        </TooltipTrigger>
        {activeProjectDisplayName ? (
          <TooltipPopup side="top" className="max-w-96">
            <ProjectLocation
              displayName={activeProjectDisplayName}
              workspaceRoot={activeProjectGroup?.workspaceRoot ?? null}
              environmentLabel={activeProjectGroup?.remoteEnvironmentLabels[0] ?? null}
            />
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            const project = entry.targetProject;
            // Changing the repo of a draft moves the typed content along:
            // the user started writing in the wrong project, not a new task.
            void handleNewThread(scopeProjectRef(project.environmentId, project.id), {
              replace: true,
              carryComposerContent: true,
            });
          }}
        >
          {visibleProjectEntries.map(({ group, targetProject }) => {
            return (
              <MenuRadioItem
                key={group.projectKey}
                value={group.projectKey}
                closeOnClick
                className="group/project-row"
                onKeyDown={(event) => {
                  // Delete on Windows, the key Mac labels delete on Mac.
                  if (event.key !== "Delete" && event.key !== "Backspace") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  hideProject(group.projectKey, group.displayName);
                }}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger render={<span className="block min-w-0 flex-1 truncate" />}>
                      {group.displayName}
                    </TooltipTrigger>
                    {/* Beside the row rather than above it, so the popup never
                      covers the entries the user is comparing against. */}
                    <TooltipPopup side="right" align="start" className="max-w-96">
                      <ProjectLocation
                        displayName={group.displayName}
                        workspaceRoot={targetProject.workspaceRoot}
                        environmentLabel={targetProject.environmentLabel}
                      />
                    </TooltipPopup>
                  </Tooltip>
                  <button
                    type="button"
                    aria-label={`Hide ${group.displayName} from this list`}
                    // Keyboard and touch never hover, so the highlighted row
                    // reveals it too rather than leaving it unreachable.
                    className="-mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity in-data-highlighted:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/project-row:opacity-100"
                    // The row it sits in switches project and closes the
                    // menu. Neither should happen from this control, and menu
                    // activation can start at either end of the click.
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      hideProject(group.projectKey, group.displayName);
                    }}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        {hiddenProjectCount > 0 ? (
          <MenuItem onClick={showHiddenProjects}>
            <EyeIcon />
            Show {hiddenProjectCount} hidden {hiddenProjectCount === 1 ? "project" : "projects"}
          </MenuItem>
        ) : null}
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle === null ? "Add a project" : displayMlCodeProjectName(activeProjectTitle)}
    </button>
  );

  return (
    <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      {hasResolvedProject ? (
        <>What should we build in {projectSelector}?</>
      ) : canChooseProject ? (
        <>{projectSelector} to start</>
      ) : (
        <>Add a project to start</>
      )}
    </h1>
  );
}
