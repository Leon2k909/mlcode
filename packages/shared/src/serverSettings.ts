import {
  DEFAULT_EMPLOYEES,
  isProviderDriverKind,
  isProviderAvailable,
  resolveProviderInstanceEnabled,
  type ModelSelection,
  type Employee,
  type ProviderDriverKind,
  type ServerProvider,
  ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection } from "./model.ts";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];

const getLegacyProviderSettings = (
  settings: ServerSettings,
  provider: ProviderDriverKind,
): LegacyProviderSettings | undefined =>
  (settings.providers as Record<string, LegacyProviderSettings | undefined>)[provider];

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  const instanceConfig = settings.providerInstances[selection.instanceId];
  if (instanceConfig !== undefined) {
    return resolveProviderInstanceEnabled(instanceConfig);
  }

  return (
    isProviderDriverKind(selection.instanceId) &&
    getLegacyProviderSettings(settings, selection.instanceId)?.enabled === true
  );
}

export function resolveSourceControlWriterModelSelection(
  settings: ServerSettings,
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.sourceControlWriterModelSelection;
  if (!selection || !isModelSelectionProviderEnabled(settings, selection)) {
    return settings.textGenerationModelSelection;
  }
  if (providers === undefined) {
    return selection;
  }

  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return provider?.enabled === true && isProviderAvailable(provider)
    ? selection
    : settings.textGenerationModelSelection;
}

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

/**
 * Repair required employee fields that older/sparse settings patches may omit
 * before the strict server-settings encoder sees them. Valid entries are
 * returned unchanged; missing names use the persisted id as a last-resort
 * label, while provider ids use the current or shipped roster when available.
 */
function repairEmployeeRequiredFields(
  employeeId: string,
  employee: Employee,
  fallbackEmployee: Employee | undefined,
): Employee {
  const rawEmployee = employee as unknown as {
    displayName?: unknown;
    providerInstanceId?: unknown;
  };
  const repairedFields: {
    displayName?: string;
    providerInstanceId?: Employee["providerInstanceId"];
  } = {};
  if (typeof rawEmployee.displayName !== "string" || rawEmployee.displayName.trim().length === 0) {
    repairedFields.displayName = fallbackEmployee?.displayName ?? employeeId;
  }
  if (
    (typeof rawEmployee.providerInstanceId !== "string" ||
      rawEmployee.providerInstanceId.trim().length === 0) &&
    fallbackEmployee?.providerInstanceId !== undefined
  ) {
    repairedFields.providerInstanceId = fallbackEmployee.providerInstanceId;
  }
  const repairedEmployee =
    Object.keys(repairedFields).length === 0
      ? employee
      : ({ ...employee, ...repairedFields } as Employee);
  const isLegacyDefaultCeo =
    employeeId === "ceo" &&
    fallbackEmployee !== undefined &&
    repairedEmployee.displayName === fallbackEmployee.displayName &&
    repairedEmployee.providerInstanceId === fallbackEmployee.providerInstanceId &&
    repairedEmployee.role === fallbackEmployee.role &&
    repairedEmployee.instructions === fallbackEmployee.instructions &&
    repairedEmployee.avatar === fallbackEmployee.avatar &&
    repairedEmployee.accentColor === fallbackEmployee.accentColor &&
    repairedEmployee.fastMode === fallbackEmployee.fastMode &&
    repairedEmployee.enabled === fallbackEmployee.enabled &&
    repairedEmployee.model === fallbackEmployee.model &&
    repairedEmployee.modelMode === undefined &&
    (repairedEmployee.modelOptions?.length ?? 0) === 0;
  return isLegacyDefaultCeo
    ? {
        ...repairedEmployee,
        modelMode: fallbackEmployee.modelMode,
        ...(fallbackEmployee.modelOptions !== undefined
          ? { modelOptions: [...fallbackEmployee.modelOptions] }
          : {}),
      }
    : repairedEmployee;
}

function repairEmployeeMap(employees: ServerSettings["employees"]): ServerSettings["employees"] {
  return Object.fromEntries(
    Object.entries(employees).map(([employeeId, employee]) => {
      const defaultEmployee = (DEFAULT_EMPLOYEES as unknown as Record<string, Employee>)[
        employeeId
      ];
      return [employeeId, repairEmployeeRequiredFields(employeeId, employee, defaultEmployee)];
    }),
  ) as ServerSettings["employees"];
}

/** Upgrade only shipped/default-shaped employee records while preserving custom personas. */
export function normalizeServerSettingsEmployees(settings: ServerSettings): ServerSettings {
  return { ...settings, employees: repairEmployeeMap(settings.employees) };
}

function repairEmployeePatch(
  currentEmployees: ServerSettings["employees"],
  employeesPatch: NonNullable<ServerSettingsPatch["employees"]>,
): NonNullable<ServerSettingsPatch["employees"]> {
  return Object.fromEntries(
    Object.entries(employeesPatch).map(([employeeId, employee]) => {
      const currentEmployee = (currentEmployees as unknown as Record<string, Employee>)[employeeId];
      const defaultEmployee = (DEFAULT_EMPLOYEES as unknown as Record<string, Employee>)[
        employeeId
      ];
      return [
        employeeId,
        repairEmployeeRequiredFields(employeeId, employee, currentEmployee ?? defaultEmployee),
      ];
    }),
  ) as NonNullable<ServerSettingsPatch["employees"]>;
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const {
    automaticGitFetchInterval,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    employees,
    ...patchForMerge
  } = patch;
  const currentWithRepairedEmployees = normalizeServerSettingsEmployees(current);
  const patchForMergeWithRepairedEmployees = {
    ...patchForMerge,
    ...(employees !== undefined
      ? {
          employees: repairEmployeePatch(currentWithRepairedEmployees.employees, employees),
        }
      : {}),
  };
  const currentBackgroundActivity = normalizeServerBackgroundActivitySettings(current);
  const backgroundActivityPatch =
    backgroundActivityProfile !== undefined
      ? {
          schemaVersion: 1 as const,
          profile:
            automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
              ? ("custom" as const)
              : backgroundActivityProfile,
          ...(automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
            ? { baseProfile: backgroundActivityProfile }
            : {}),
          overrides: {
            ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
            ...(providerHealthRefreshInterval !== undefined
              ? { providerHealthRefreshInterval }
              : {}),
          },
        }
      : automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
        ? {
            schemaVersion: 1 as const,
            profile: "custom" as const,
            baseProfile: getBackgroundActivityBaseProfile(currentBackgroundActivity),
            overrides: {
              ...(currentBackgroundActivity.profile === "custom"
                ? currentBackgroundActivity.overrides
                : {}),
              ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
              ...(providerHealthRefreshInterval !== undefined
                ? { providerHealthRefreshInterval }
                : {}),
            },
          }
        : undefined;
  const next = deepMerge(currentWithRepairedEmployees, patchForMergeWithRepairedEmployees);
  const nextWithReplacementsBase = {
    ...next,
    ...(backgroundActivity !== undefined
      ? {
          backgroundActivity: {
            ...deepMerge(currentBackgroundActivity, backgroundActivity),
            ...(backgroundActivity.overrides !== undefined
              ? { overrides: backgroundActivity.overrides }
              : {}),
          },
        }
      : { backgroundActivity: currentBackgroundActivity }),
    ...(backgroundActivity === undefined && backgroundActivityPatch !== undefined
      ? { backgroundActivity: backgroundActivityPatch }
      : {}),
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(patch.sourceControlWriterModelSelection !== undefined
      ? { sourceControlWriterModelSelection: patch.sourceControlWriterModelSelection }
      : {}),
    ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
    ...(providerHealthRefreshInterval !== undefined ? { providerHealthRefreshInterval } : {}),
  };
  const normalizedBackgroundActivity = normalizeBackgroundActivitySettings(
    nextWithReplacementsBase.backgroundActivity,
  );
  const resolvedBackgroundActivity = resolveBackgroundActivitySettings(
    normalizedBackgroundActivity,
  );
  const nextWithReplacements = {
    ...nextWithReplacementsBase,
    backgroundActivity: normalizedBackgroundActivity,
    automaticGitFetchInterval: resolvedBackgroundActivity.automaticGitFetchInterval,
    providerHealthRefreshInterval: resolvedBackgroundActivity.providerHealthRefreshInterval,
    backgroundActivityProfile: resolvedBackgroundActivity.profile,
  };
  if (!selectionPatch) {
    return nextWithReplacements;
  }

  const instanceId = selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
  const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
    ? selectionPatch.options
    : mergeModelSelectionOptionsById({
        current: current.textGenerationModelSelection.options,
        patch: selectionPatch.options,
      });

  return {
    ...nextWithReplacements,
    textGenerationModelSelection: createModelSelection(instanceId, model, options),
  };
}
