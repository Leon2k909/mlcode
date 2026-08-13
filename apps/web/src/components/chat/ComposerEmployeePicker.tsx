import { memo, useMemo } from "react";
import { UserRoundIcon, UsersRoundIcon } from "lucide-react";
import type { EmployeeId } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { employeeInitials, type EmployeeEntry } from "../../employees";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlChevron } from "./ComposerControl";

function EmployeeGlyph({ entry }: { entry: EmployeeEntry }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border/60 text-[8px] leading-none"
      style={entry.employee.accentColor ? { borderColor: entry.employee.accentColor } : undefined}
    >
      {entry.employee.avatar?.trim()
        ? entry.employee.avatar
        : employeeInitials(entry.employee.displayName)}
    </span>
  );
}

/**
 * Picks either one employee for a private work thread or several employees
 * for a group chat. `activeEmployeeId` is the current speaker; `employeeIds`
 * is present only for a group.
 */
export const ComposerEmployeePicker = memo(function ComposerEmployeePicker(props: {
  entries: ReadonlyArray<EmployeeEntry>;
  activeEmployeeId: EmployeeId | undefined;
  activeEmployeeIds: ReadonlyArray<EmployeeId> | undefined;
  appliesNextTurn?: boolean;
  compact?: boolean;
  disabled?: boolean;
  onEmployeeSelect: (
    employeeId: EmployeeId | undefined,
    employeeIds: ReadonlyArray<EmployeeId> | undefined,
  ) => void;
}) {
  const selectable = useMemo(
    () => props.entries.filter((entry) => entry.employee.enabled),
    [props.entries],
  );
  const selectableIds = useMemo(
    () => new Set(selectable.map((entry) => entry.employeeId)),
    [selectable],
  );
  const groupIds = useMemo(
    () => (props.activeEmployeeIds ?? []).filter((employeeId) => selectableIds.has(employeeId)),
    [props.activeEmployeeIds, selectableIds],
  );
  const selectedIds =
    groupIds.length >= 2
      ? groupIds
      : props.activeEmployeeId !== undefined && selectableIds.has(props.activeEmployeeId)
        ? [props.activeEmployeeId]
        : [];

  if (selectable.length === 0) return null;

  const active = selectable.find((entry) => entry.employeeId === props.activeEmployeeId);
  const isGroup = groupIds.length >= 2;
  const groupEntries = groupIds
    .map((employeeId) => selectable.find((entry) => entry.employeeId === employeeId))
    .filter((entry): entry is EmployeeEntry => entry !== undefined);
  const groupNames = groupEntries.map((entry) => entry.employee.displayName);
  const selectionLabel = isGroup
    ? groupNames.length === 2
      ? groupNames.join(" + ")
      : `${active?.employee.displayName ?? groupNames[0] ?? "Team"} +${groupIds.length - 1}`
    : (active?.employee.displayName ?? "No employee");
  const visibleLabel =
    active === undefined
      ? selectionLabel
      : props.appliesNextTurn
        ? `Next turn: ${selectionLabel}`
        : isGroup
          ? `Employees: ${selectionLabel}`
          : `Employee: ${selectionLabel}`;
  const selectionDescription = isGroup
    ? `T3 employees in this chat: ${groupNames.join(", ")}`
    : active
      ? `T3 employee in this chat: ${active.employee.displayName}`
      : "No T3 employee selected";

  const toggleGroupMember = (employeeId: EmployeeId, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedIds, employeeId])]
      : selectedIds.filter((id) => id !== employeeId);
    if (next.length === 0) {
      props.onEmployeeSelect(undefined, undefined);
      return;
    }
    if (next.length === 1) {
      props.onEmployeeSelect(next[0], undefined);
      return;
    }
    const nextSpeaker =
      props.activeEmployeeId !== undefined && next.includes(props.activeEmployeeId)
        ? props.activeEmployeeId
        : next[0];
    props.onEmployeeSelect(nextSpeaker, next);
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <ComposerControl
            aria-label={`${selectionDescription}. Select employee or group chat`}
            title={
              props.appliesNextTurn
                ? `${selectionDescription}. Applies next turn.`
                : selectionDescription
            }
            variant="ghost"
            data-chat-employee-picker="true"
            className={cn(
              "min-w-0 justify-between whitespace-nowrap",
              props.compact ? "max-w-44 shrink-0" : "max-w-60 shrink",
            )}
            disabled={props.disabled}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {isGroup ? (
            <UsersRoundIcon className="size-4 shrink-0" />
          ) : active ? (
            <EmployeeGlyph entry={active} />
          ) : (
            <UserRoundIcon className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 overflow-hidden truncate">{visibleLabel}</span>
        </span>
        <span aria-hidden="true" className="flex items-center">
          <ComposerControlChevron />
        </span>
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-60">
        <MenuItem onClick={() => props.onEmployeeSelect(undefined, undefined)}>
          <UserRoundIcon className="size-4" />
          <span className="flex-1 truncate">No employee</span>
        </MenuItem>

        <MenuGroup>
          <MenuGroupLabel>Private work chat</MenuGroupLabel>
          {selectable.map((entry) => (
            <MenuItem
              key={`solo:${entry.employeeId}`}
              onClick={() => props.onEmployeeSelect(entry.employeeId, undefined)}
            >
              <EmployeeGlyph entry={entry} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{entry.employee.displayName}</span>
                {entry.employee.role ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.employee.role}
                  </span>
                ) : null}
              </span>
            </MenuItem>
          ))}
        </MenuGroup>

        {selectable.length >= 2 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Group chat</MenuGroupLabel>
              <MenuItem
                onClick={() =>
                  props.onEmployeeSelect(
                    props.activeEmployeeId && selectableIds.has(props.activeEmployeeId)
                      ? props.activeEmployeeId
                      : selectable[0]!.employeeId,
                    selectable.map((entry) => entry.employeeId),
                  )
                }
              >
                <UsersRoundIcon className="size-4" />
                <span className="flex-1 truncate">Start with everyone</span>
              </MenuItem>
              {selectable.map((entry) => (
                <MenuCheckboxItem
                  key={`group:${entry.employeeId}`}
                  checked={selectedIds.includes(entry.employeeId)}
                  onCheckedChange={(checked) => toggleGroupMember(entry.employeeId, checked)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <EmployeeGlyph entry={entry} />
                    <span className="truncate">{entry.employee.displayName}</span>
                  </span>
                </MenuCheckboxItem>
              ))}
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
