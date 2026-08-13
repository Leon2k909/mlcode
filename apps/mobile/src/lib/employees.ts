import {
  type Employee,
  type EmployeeId,
  type EmployeeMap,
  type ModelSelection,
  type ServerConfig,
  resolveEmployee,
} from "@t3tools/contracts";

const EMPLOYEE_HANDOFF_PATTERN =
  /<handoff\s+to\s*=\s*["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?\s*>([\s\S]*?)<\/handoff>/i;

export interface MobileEmployeeEntry {
  readonly employeeId: EmployeeId;
  readonly employee: Employee;
}

export function deriveMobileEmployeeEntries(
  employees: EmployeeMap | null | undefined,
): MobileEmployeeEntry[] {
  return Object.entries(employees ?? {})
    .filter(([, employee]) => employee.enabled)
    .map(([employeeId, employee]) => ({
      employeeId: employeeId as EmployeeId,
      employee,
    }))
    .sort((a, b) => {
      const byName = a.employee.displayName.localeCompare(b.employee.displayName);
      return byName === 0 ? a.employeeId.localeCompare(b.employeeId) : byName;
    });
}

export function employeeSelectionLabel(
  employees: EmployeeMap | null | undefined,
  selection: Pick<ModelSelection, "employeeId" | "employeeIds">,
): string | undefined {
  if (selection.employeeId === undefined) return undefined;
  const employee = resolveEmployee(employees ?? ({} as EmployeeMap), selection.employeeId);
  const displayName = employee?.displayName ?? selection.employeeId;
  const groupSize = selection.employeeIds?.length ?? 0;
  return groupSize >= 2 ? `${displayName} +${groupSize - 1}` : displayName;
}

export function employeeInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]!].slice(0, 2).join("").toUpperCase();
  return `${[...words[0]!][0] ?? ""}${[...words[words.length - 1]!][0] ?? ""}`.toUpperCase();
}

export function deriveEmployeeHandoffDisplay(text: string): {
  readonly visibleText: string;
  readonly toEmployeeId: EmployeeId | undefined;
} {
  const match = EMPLOYEE_HANDOFF_PATTERN.exec(text);
  if (match === null) return { visibleText: text, toEmployeeId: undefined };
  return {
    visibleText: text
      .replace(EMPLOYEE_HANDOFF_PATTERN, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      .trim(),
    toEmployeeId: match[1] as EmployeeId,
  };
}

export function resolveEmployeeModelSelection(input: {
  readonly config: ServerConfig | null | undefined;
  readonly currentSelection: ModelSelection;
  readonly employeeId: EmployeeId | undefined;
  readonly employeeIds: ReadonlyArray<EmployeeId> | undefined;
}): ModelSelection | null {
  const {
    employeeId: _removedEmployeeId,
    employeeIds: _removedEmployeeIds,
    options,
    ...selectionWithoutEmployee
  } = input.currentSelection;
  if (input.employeeId === undefined) {
    return {
      ...selectionWithoutEmployee,
      ...(options !== undefined ? { options } : {}),
    };
  }

  const employee = resolveEmployee(
    input.config?.settings.employees ?? ({} as EmployeeMap),
    input.employeeId,
  );
  if (employee === undefined || input.config === null || input.config === undefined) return null;
  const provider = input.config.providers.find(
    (candidate) =>
      candidate.instanceId === employee.providerInstanceId &&
      candidate.enabled &&
      candidate.installed &&
      candidate.auth.status !== "unauthenticated",
  );
  if (provider === undefined) return null;
  const targetModel =
    employee.model ??
    (input.currentSelection.instanceId === employee.providerInstanceId
      ? input.currentSelection.model
      : (provider.models.find((model) => model.isDefault)?.slug ??
        provider.models.find((model) => model.isLegacy !== true)?.slug ??
        provider.models[0]?.slug));
  if (!targetModel) return null;

  return {
    ...selectionWithoutEmployee,
    instanceId: employee.providerInstanceId,
    model: targetModel,
    employeeId: input.employeeId,
    ...(input.employeeIds !== undefined && input.employeeIds.length >= 2
      ? { employeeIds: [...input.employeeIds] }
      : {}),
    ...(input.currentSelection.instanceId === employee.providerInstanceId && options !== undefined
      ? { options }
      : {}),
  };
}

export function preserveEmployeeRoutingForProvider(input: {
  readonly currentSelection: ModelSelection;
  readonly nextSelection: ModelSelection;
  readonly employees: EmployeeMap | null | undefined;
}): ModelSelection {
  const employee = resolveEmployee(
    input.employees ?? ({} as EmployeeMap),
    input.currentSelection.employeeId,
  );
  if (employee?.providerInstanceId !== input.nextSelection.instanceId) return input.nextSelection;
  return {
    ...input.nextSelection,
    ...(input.currentSelection.employeeId !== undefined
      ? { employeeId: input.currentSelection.employeeId }
      : {}),
    ...(input.currentSelection.employeeIds !== undefined
      ? { employeeIds: input.currentSelection.employeeIds }
      : {}),
  };
}
