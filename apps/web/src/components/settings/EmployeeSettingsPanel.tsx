"use client";

import { PlusIcon, TriangleAlertIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  EMPLOYEE_INSTRUCTIONS_MAX_CHARS,
  Employee,
  employeeUsesModelOverride,
  type EmployeeModelMode,
  type EmployeeId,
  type EmployeeMap,
  ProviderDriverKind,
  type ProviderOptionSelection,
  type ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";

import {
  usePrimarySettings,
  useUpdatePrimarySettings,
  type SettingsUpdateResult,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { getProviderModelCapabilities } from "../../providerModels";
import { primaryServerProvidersAtom } from "../../state/server";
import {
  buildEmployeeRemovalPatch,
  buildEmployeeRenamePatch,
  buildSuggestedEmployeePatch,
  deriveAvailableSuggestions,
  deriveEmployeeEntries,
  slugifyEmployeeName,
  validateEmployeeId,
  type EmployeeEntry,
  type SuggestedEmployee,
} from "../../employees";
import { Badge } from "../ui/badge";
import { TraitsPicker } from "../chat/TraitsPicker";
import { EmployeeAvatar } from "../employees/EmployeeAvatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  EMPLOYEE_MODEL_AUTO,
  EMPLOYEE_MODEL_CUSTOM,
  EMPLOYEE_MODEL_FOLLOW_THREAD,
  getEmployeeModelPickerLabel,
} from "./EmployeeSettingsPanel.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const decodeEmployee = Schema.decodeUnknownOption(Employee);

function withoutFastModeOption(
  options: ReadonlyArray<ProviderOptionSelection>,
): ReadonlyArray<ProviderOptionSelection> {
  return options.filter((option) => option.id !== "fastMode");
}

interface EmployeeDraft {
  readonly employeeId: string;
  readonly displayName: string;
  readonly role: string;
  readonly avatar: string;
  readonly instructions: string;
  readonly providerInstanceId: string;
  readonly modelMode: EmployeeModelMode;
  readonly model: string;
  readonly modelOptions: ReadonlyArray<ProviderOptionSelection>;
  readonly fastMode: boolean;
  readonly enabled: boolean;
}

const emptyDraft = (providerInstanceId: string): EmployeeDraft => ({
  employeeId: "",
  displayName: "",
  role: "",
  avatar: "",
  instructions: "",
  providerInstanceId,
  modelMode: "auto",
  model: "",
  modelOptions: [],
  fastMode: false,
  enabled: true,
});

const draftFromEntry = (entry: EmployeeEntry): EmployeeDraft => ({
  employeeId: entry.employeeId,
  displayName: entry.employee.displayName,
  role: entry.employee.role ?? "",
  avatar: entry.employee.avatar ?? "",
  instructions: entry.employee.instructions,
  providerInstanceId: entry.employee.providerInstanceId,
  modelMode: employeeUsesModelOverride(entry.employee) ? "override" : "auto",
  model: entry.employee.model ?? "",
  modelOptions: withoutFastModeOption(entry.employee.modelOptions ?? []),
  fastMode: entry.employee.fastMode === true,
  enabled: entry.employee.enabled,
});

/**
 * Decode a draft through the same schema the server uses, so the panel cannot
 * persist a shape the server would reject. Optional text fields collapse to
 * absent when blank rather than being stored as empty strings.
 */
function decodeDraft(draft: EmployeeDraft): { employee: Employee } | { error: string } {
  const modelOptions = withoutFastModeOption(draft.modelOptions);
  const result = decodeEmployee({
    displayName: draft.displayName,
    providerInstanceId: draft.providerInstanceId,
    instructions: draft.instructions,
    enabled: draft.enabled,
    modelMode: draft.modelMode,
    ...(draft.role.trim() ? { role: draft.role } : {}),
    ...(draft.avatar.trim() ? { avatar: draft.avatar } : {}),
    ...(draft.model.trim() ? { model: draft.model } : {}),
    // Send both states explicitly. Server settings patches deep-merge nested
    // objects, so omitting false or an empty options array would leave the
    // previously saved value in place after the user clears it.
    modelOptions,
    fastMode: draft.fastMode,
  });
  if (Option.isSome(result)) return { employee: result.value };
  return { error: "Check the highlighted fields — this employee could not be saved." };
}

function EmployeeForm({
  draft,
  onDraftChange,
  instanceOptions,
  modelOptions,
  provider,
  idError,
  saveError,
  onSave,
  onCancel,
  saveLabel,
  saving,
}: {
  draft: EmployeeDraft;
  onDraftChange: (next: EmployeeDraft) => void;
  instanceOptions: readonly { readonly instanceId: string; readonly label: string }[];
  modelOptions: ReadonlyArray<ServerProviderModel>;
  provider: ProviderDriverKind;
  idError: string | null;
  saveError: string | null;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  saveLabel: string;
  saving: boolean;
}) {
  const set = <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) =>
    onDraftChange({ ...draft, [key]: value });

  const nameMissing = draft.displayName.trim().length === 0;
  const instructionsOverCap = draft.instructions.length > EMPLOYEE_INSTRUCTIONS_MAX_CHARS;
  const selectedProviderLabel =
    instanceOptions.find((option) => option.instanceId === draft.providerInstanceId)?.label ??
    draft.providerInstanceId;
  const selectedModelIsKnown = modelOptions.some((model) => model.slug === draft.model);
  const [customModelMode, setCustomModelMode] = useState(
    () => draft.model.length > 0 && !selectedModelIsKnown,
  );
  const modelPickerValue =
    draft.modelMode === "auto"
      ? EMPLOYEE_MODEL_AUTO
      : customModelMode || (draft.model.length > 0 && !selectedModelIsKnown)
        ? EMPLOYEE_MODEL_CUSTOM
        : draft.model || EMPLOYEE_MODEL_FOLLOW_THREAD;
  const modelPickerLabel = getEmployeeModelPickerLabel(modelPickerValue, modelOptions);
  const traitModels = useMemo(
    () =>
      modelOptions.map((model) => {
        const descriptors = model.capabilities?.optionDescriptors;
        if (descriptors === undefined || model.capabilities === null) return model;
        return {
          ...model,
          capabilities: {
            ...model.capabilities,
            optionDescriptors: descriptors.filter((descriptor) => descriptor.id !== "fastMode"),
          },
        };
      }),
    [modelOptions],
  );
  const traitModel =
    draft.model || modelOptions.find((model) => model.isDefault)?.slug || modelOptions[0]?.slug;
  const hasProviderOptions =
    getProviderModelCapabilities(traitModels, traitModel, provider).optionDescriptors?.length ?? 0;

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Name</span>
          <Input
            value={draft.displayName}
            aria-invalid={nameMissing || undefined}
            placeholder="Ada Lovelace"
            onChange={(event) => {
              const displayName = event.target.value;
              // Keep the id tracking the name until the user edits it directly.
              const autoId = slugifyEmployeeName(draft.displayName);
              const idIsAuto = draft.employeeId === autoId || draft.employeeId === "";
              onDraftChange({
                ...draft,
                displayName,
                ...(idIsAuto ? { employeeId: slugifyEmployeeName(displayName) } : {}),
              });
            }}
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Employee ID</span>
          <Input
            value={draft.employeeId}
            aria-invalid={idError !== null || undefined}
            placeholder="ada_lovelace"
            onChange={(event) => set("employeeId", event.target.value)}
          />
          {idError ? <span className="block text-xs text-destructive">{idError}</span> : null}
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Role</span>
          <Input
            value={draft.role}
            placeholder="Frontend engineer"
            onChange={(event) => set("role", event.target.value)}
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Avatar</span>
          <Input
            value={draft.avatar}
            placeholder="🎨"
            onChange={(event) => set("avatar", event.target.value)}
          />
        </label>

        <div className="space-y-1.5 text-sm">
          <span className="font-medium">Default provider</span>
          <Select
            value={draft.providerInstanceId}
            onValueChange={(next) => {
              if (!next || next === draft.providerInstanceId) return;
              setCustomModelMode(false);
              onDraftChange({
                ...draft,
                providerInstanceId: next,
                modelMode: "auto",
                model: "",
                modelOptions: [],
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Default provider instance" />
            </SelectTrigger>
            <SelectContent>
              {instanceOptions.map((option) => (
                <SelectItem key={option.instanceId} value={option.instanceId}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Model routing</span>
          <Select
            value={modelPickerValue}
            onValueChange={(next) => {
              if (!next || next === EMPLOYEE_MODEL_AUTO || next === EMPLOYEE_MODEL_FOLLOW_THREAD) {
                setCustomModelMode(false);
                onDraftChange({ ...draft, modelMode: "auto", model: "", modelOptions: [] });
                return;
              }
              if (next === EMPLOYEE_MODEL_CUSTOM) {
                setCustomModelMode(true);
                onDraftChange({
                  ...draft,
                  modelMode: "override",
                  model: selectedModelIsKnown ? "" : draft.model,
                  modelOptions: [],
                });
                return;
              }
              setCustomModelMode(false);
              onDraftChange({ ...draft, modelMode: "override", model: next, modelOptions: [] });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{modelPickerLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPLOYEE_MODEL_AUTO}>Auto</SelectItem>
              <SelectItem value={EMPLOYEE_MODEL_FOLLOW_THREAD}>Follow chat model</SelectItem>
              {modelOptions.map((model) => (
                <SelectItem key={model.slug} value={model.slug}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{model.name}</span>
                    {model.name !== model.slug ? (
                      <span className="truncate text-xs text-muted-foreground">{model.slug}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={EMPLOYEE_MODEL_CUSTOM}>Custom model slug…</SelectItem>
            </SelectContent>
          </Select>
          {draft.modelMode === "override" && customModelMode ? (
            <Input
              value={draft.model}
              placeholder="claude-opus-5"
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  modelMode: "override",
                  model: event.target.value,
                  modelOptions: [],
                })
              }
              spellCheck={false}
            />
          ) : null}
          <span className="block text-xs text-muted-foreground">
            {draft.modelMode === "auto"
              ? "The CEO chooses the active model and reasoning for this employee. Choose a model below to override it."
              : modelOptions.length > 0
                ? `Fallbacks for ${selectedProviderLabel}. Other chat providers use the model selected in the composer.`
                : "Provider models are not available yet. Follow the chat model or enter a custom slug."}
          </span>
        </label>

        {draft.modelMode === "override" && hasProviderOptions > 0 ? (
          <div className="space-y-1.5 text-sm">
            <span className="font-medium">Provider defaults</span>
            <TraitsPicker
              provider={provider}
              instanceId={draft.providerInstanceId as ProviderInstanceId}
              models={traitModels}
              model={traitModel}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={draft.modelOptions}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="w-full justify-between"
              onModelOptionsChange={(nextOptions) =>
                set("modelOptions", withoutFastModeOption(nextOptions ?? []))
              }
            />
            <span className="block text-xs text-muted-foreground">
              Saved for this employee&apos;s default provider. Other providers follow the chat
              selection.
            </span>
          </div>
        ) : null}
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
        <span className="min-w-0 space-y-1">
          <span className="block font-medium">Fast mode</span>
          <span className="block text-xs text-muted-foreground">
            Prefer the provider's faster service tier for this employee. Providers without fast mode
            support ignore this preference.
          </span>
        </span>
        <Switch
          checked={draft.fastMode}
          aria-label={`Use fast mode for ${draft.displayName || "this employee"}`}
          onCheckedChange={(checked) => set("fastMode", checked)}
        />
      </label>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Standing instructions</span>
        <Textarea
          rows={6}
          value={draft.instructions}
          aria-invalid={instructionsOverCap || undefined}
          placeholder="How this employee works. Sent once, at the start of each session."
          onChange={(event) => set("instructions", event.target.value)}
        />
        <span
          className={cn(
            "block text-xs",
            instructionsOverCap ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {draft.instructions.length} / {EMPLOYEE_INSTRUCTIONS_MAX_CHARS}
        </span>
      </label>

      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={
            saving ||
            nameMissing ||
            instructionsOverCap ||
            idError !== null ||
            draft.providerInstanceId.length === 0
          }
        >
          {saving ? "Saving..." : saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function EmployeeSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);

  const employees = settings.employees;
  const entries = useMemo(() => deriveEmployeeEntries(employees), [employees]);

  const instanceOptions = useMemo(
    () =>
      serverProviders.map((provider) => ({
        instanceId: String(provider.instanceId),
        label: provider.displayName ?? String(provider.instanceId),
      })),
    [serverProviders],
  );
  const modelOptionsByInstance = useMemo(
    () =>
      new Map(
        serverProviders.map((provider) => [String(provider.instanceId), provider.models] as const),
      ),
    [serverProviders],
  );
  const providerDriversByInstance = useMemo(
    () =>
      new Map(
        serverProviders.map((provider) => [String(provider.instanceId), provider.driver] as const),
      ),
    [serverProviders],
  );
  const configuredInstanceIds = useMemo(
    () => new Set(instanceOptions.map((option) => option.instanceId)),
    [instanceOptions],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EmployeeDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isCreating = editingId === "";

  const takenIds = useMemo(
    () =>
      new Set(
        entries
          .map((entry) => String(entry.employeeId))
          // A rename must not collide with itself.
          .filter((id) => isCreating || id !== editingId),
      ),
    [entries, editingId, isCreating],
  );

  const idError = draft ? validateEmployeeId(draft.employeeId, takenIds) : null;

  const startCreate = useCallback(() => {
    setSaveError(null);
    setEditingId("");
    setDraft(emptyDraft(instanceOptions[0]?.instanceId ?? ""));
  }, [instanceOptions]);

  const startEdit = useCallback((entry: EmployeeEntry) => {
    setSaveError(null);
    setEditingId(String(entry.employeeId));
    setDraft(draftFromEntry(entry));
  }, []);

  const cancel = useCallback(() => {
    setEditingId(null);
    setDraft(null);
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (!draft || editingId === null) return;
    const decoded = decodeDraft(draft);
    if ("error" in decoded) {
      setSaveError(decoded.error);
      return;
    }
    const patch = buildEmployeeRenamePatch({
      employees,
      fromId: (isCreating ? draft.employeeId : editingId) as EmployeeId,
      toId: draft.employeeId as EmployeeId,
      employee: decoded.employee,
    });
    setSaveError(null);
    setSaving(true);
    try {
      const result: SettingsUpdateResult = await updateSettings(patch);
      if (!result.ok) {
        setSaveError(
          result.reason === "no-primary-environment"
            ? "Connect to a primary environment before saving employees."
            : "Employee settings could not be saved. Check the connection and try again.",
        );
        return;
      }
      cancel();
    } catch {
      setSaveError("Employee settings could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [cancel, draft, editingId, employees, isCreating, updateSettings]);

  const remove = useCallback(
    (employeeId: EmployeeId) => {
      updateSettings(buildEmployeeRemovalPatch({ employees, employeeId }));
      if (editingId === String(employeeId)) cancel();
    },
    [cancel, editingId, employees, updateSettings],
  );

  const suggestions = useMemo(() => deriveAvailableSuggestions(employees), [employees]);
  const defaultInstanceId = instanceOptions[0]?.instanceId;

  const hire = useCallback(
    (suggestion: SuggestedEmployee) => {
      if (defaultInstanceId === undefined) return;
      updateSettings(
        buildSuggestedEmployeePatch({
          employees,
          suggestion,
          providerInstanceId: defaultInstanceId as ProviderInstanceId,
        }),
      );
    },
    [defaultInstanceId, employees, updateSettings],
  );

  const toggleEnabled = useCallback(
    (entry: EmployeeEntry, enabled: boolean) => {
      updateSettings({
        employees: {
          ...employees,
          [entry.employeeId]: { ...entry.employee, enabled },
        } as EmployeeMap,
      });
    },
    [employees, updateSettings],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="employees"
        title="Employees"
        headerAction={
          <Button size="sm" variant="outline" onClick={startCreate} disabled={isCreating}>
            <PlusIcon className="size-3.5" />
            Add employee
          </Button>
        }
      >
        <SettingsRow
          title="Named personas that do the work"
          description="An employee is a name, an avatar, and standing instructions with a default provider. Pick Claude or another configured provider in the composer for any employee."
        />

        {isCreating && draft ? (
          <div className="px-3 sm:px-4">
            <EmployeeForm
              draft={draft}
              onDraftChange={setDraft}
              instanceOptions={instanceOptions}
              modelOptions={modelOptionsByInstance.get(draft.providerInstanceId) ?? []}
              provider={
                providerDriversByInstance.get(draft.providerInstanceId) ??
                ProviderDriverKind.make("codex")
              }
              idError={idError}
              saveError={saveError}
              onSave={save}
              onCancel={cancel}
              saveLabel="Add employee"
              saving={saving}
            />
          </div>
        ) : null}

        {entries.length === 0 && !isCreating ? (
          <SettingsRow
            title="No employees yet"
            description="Add one to give a persona a name, a role, and instructions it carries into every session."
          />
        ) : null}

        {entries.map((entry) => {
          const employeeId = String(entry.employeeId);
          const isEditing = editingId === employeeId;
          const orphaned = !configuredInstanceIds.has(entry.employee.providerInstanceId);
          return (
            <div key={employeeId} className="space-y-3">
              <SettingsRow
                title={
                  <span className="flex items-center gap-2.5">
                    <EmployeeAvatar
                      employeeId={employeeId}
                      displayName={entry.employee.displayName}
                      accentColor={entry.employee.accentColor}
                    />
                    <span className="flex flex-col">
                      <span>{entry.employee.displayName}</span>
                      {entry.employee.role ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {entry.employee.role}
                        </span>
                      ) : null}
                    </span>
                  </span>
                }
                description={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      {String(entry.employee.providerInstanceId as ProviderInstanceId)}
                    </Badge>
                    {!employeeUsesModelOverride(entry.employee) ? (
                      <Badge variant="outline">Auto — CEO decides</Badge>
                    ) : entry.employee.model ? (
                      <Badge variant="outline">{entry.employee.model}</Badge>
                    ) : null}
                    {orphaned ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                        <TriangleAlertIcon className="size-3.5" />
                        Default provider not configured here — choose another provider in the
                        composer.
                      </span>
                    ) : null}
                  </span>
                }
                control={
                  <span className="flex items-center gap-2">
                    <Switch
                      checked={entry.employee.enabled}
                      aria-label={`Enable ${entry.employee.displayName}`}
                      onCheckedChange={(checked) => toggleEnabled(entry, checked)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => (isEditing ? cancel() : startEdit(entry))}
                    >
                      {isEditing ? "Close" : "Edit"}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Delete ${entry.employee.displayName}`}
                      onClick={() => remove(entry.employeeId)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </span>
                }
              />
              {isEditing && draft ? (
                <div className="px-3 sm:px-4">
                  <EmployeeForm
                    draft={draft}
                    onDraftChange={setDraft}
                    instanceOptions={instanceOptions}
                    modelOptions={modelOptionsByInstance.get(draft.providerInstanceId) ?? []}
                    provider={
                      providerDriversByInstance.get(draft.providerInstanceId) ??
                      ProviderDriverKind.make("codex")
                    }
                    idError={idError}
                    saveError={saveError}
                    onSave={save}
                    onCancel={cancel}
                    saveLabel="Save changes"
                    saving={saving}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </SettingsSection>

      {suggestions.length > 0 ? (
        <SettingsSection id="employees-suggested" title="Suggested employees">
          <SettingsRow
            title="People you could add"
            description="Not part of your team until you add one. Each arrives with editable instructions and your first configured provider as its fallback."
          />
          {suggestions.map((suggestion) => (
            <SettingsRow
              key={suggestion.employeeId}
              title={
                <span className="flex items-center gap-2.5">
                  <EmployeeAvatar
                    employeeId={String(suggestion.employeeId)}
                    displayName={suggestion.displayName}
                  />
                  <span className="flex flex-col">
                    <span>{suggestion.displayName}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {suggestion.role}
                    </span>
                  </span>
                </span>
              }
              description={suggestion.summary}
              control={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={defaultInstanceId === undefined}
                  onClick={() => hire(suggestion)}
                >
                  <PlusIcon className="size-3.5" />
                  Add
                </Button>
              }
            />
          ))}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
