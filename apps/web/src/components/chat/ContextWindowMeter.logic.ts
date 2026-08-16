import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import { getTriggerDisplayModelName, type ModelEsque } from "./providerIconUtils";

export function resolveContextWindowModelDisplayName(
  selection: ModelSelection | null | undefined,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): string | null {
  if (!selection) {
    return null;
  }

  const selectedModel = modelOptionsByInstance
    .get(selection.instanceId)
    ?.find((model) => model.slug === selection.model);

  return selectedModel ? getTriggerDisplayModelName(selectedModel) : selection.model;
}

export function formatContextWindowCompactionMessage(
  modelDisplayName: string | null | undefined,
): string {
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export function resolveContextWindowFastMode(
  selection: ModelSelection | null | undefined,
  providerDisplayName?: string | null,
): boolean | null {
  const fastMode = getModelSelectionBooleanOptionValue(selection, "fastMode");
  if (fastMode !== undefined) return fastMode;

  const serviceTier = getModelSelectionStringOptionValue(selection, "serviceTier");
  if (serviceTier === "fast") return true;
  if (serviceTier === "default" && providerDisplayName?.toLowerCase().includes("codex")) {
    return false;
  }
  return null;
}
