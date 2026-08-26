"use client";

import { CheckIcon, PawPrintIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import type { PetCatalogEntry, PetSource } from "@t3tools/contracts";
import { usePetSelection, usePrimaryPetCatalog } from "../../pets";
import { cn } from "../../lib/utils";
import { PetSprite } from "../pets/PetSprite";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { PetGalleryBrowser } from "./PetGalleryBrowser";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const SOURCE_LABELS: Readonly<Record<PetSource, string>> = {
  "micheon-custom": "Micheon",
  custom: "Codex custom",
  legacy: "Codex legacy",
  builtin: "Codex built-in",
};

function PetChoice({
  environmentId,
  pet,
  selected,
  codexDefault,
  onSelect,
}: {
  readonly environmentId: NonNullable<ReturnType<typeof usePrimaryPetCatalog>["environmentId"]>;
  readonly pet: PetCatalogEntry;
  readonly selected: boolean;
  readonly codexDefault: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group relative flex min-h-36 flex-col items-center rounded-xl border px-3 py-3 text-center transition-colors active:translate-y-px",
        selected
          ? "border-primary/60 bg-primary/8 text-foreground ring-1 ring-primary/20"
          : "border-border/65 bg-card/35 text-foreground hover:border-border hover:bg-card/70",
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {selected ? (
        <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon className="size-3" />
        </span>
      ) : null}
      <PetSprite environmentId={environmentId} pet={pet} size={76} />
      <span className="mt-1 max-w-full truncate text-sm font-medium">{pet.displayName}</span>
      <span className="mt-1 flex max-w-full flex-wrap justify-center gap-1">
        <Badge size="sm" variant="secondary">
          {SOURCE_LABELS[pet.source]}
        </Badge>
        {codexDefault ? (
          <Badge size="sm" variant="outline">
            Codex default
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

export function PetSettingsPanel() {
  const { environmentId, catalog, error, isPending, refresh } = usePrimaryPetCatalog();
  const { selectedKey, setSelectedKey } = usePetSelection(environmentId, catalog);
  const setting = searchableSetting("pets");

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...setting}
        icon={<PawPrintIcon className="size-5" />}
        headerAction={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={refresh}
            disabled={environmentId === null || isPending}
          >
            <RefreshCwIcon className={cn("size-3.5", isPending && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <div className="rounded-xl px-3 py-3 sm:px-4">
          <p className="max-w-2xl text-[13px] leading-[1.5] text-muted-foreground/80">
            ML Code finds pets installed by Micheon and Codex on this Windows server. Choose one
            here to keep it beside your workspace.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] leading-5 text-muted-foreground/65">
            <code>%MICHEON_HOME%\pets</code>
            <code>%CODEX_HOME%\pets</code>
            <code>%CODEX_HOME%\avatars</code>
            <code>Codex built-ins</code>
          </div>
        </div>

        {error ? (
          <div className="mx-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-3 text-sm sm:mx-4">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="font-medium">Pets could not be loaded</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : null}

        {isPending && catalog === null ? (
          <div className="grid grid-cols-2 gap-2 px-3 py-2 sm:grid-cols-3 sm:px-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton className="h-36 rounded-xl" key={index} />
            ))}
          </div>
        ) : null}

        {!isPending && !error && catalog?.pets.length === 0 ? (
          <div className="mx-3 rounded-xl border border-dashed border-border px-4 py-8 text-center sm:mx-4">
            <PawPrintIcon className="mx-auto size-6 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">No pets found</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              Add a Micheon or Codex pet to one of the folders above, then refresh.
            </p>
          </div>
        ) : null}

        {environmentId !== null && catalog && catalog.pets.length > 0 ? (
          <div className="px-3 pt-2 pb-3 sm:px-4">
            <button
              type="button"
              className={cn(
                "mb-2 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition-colors active:translate-y-px",
                selectedKey === null
                  ? "border-primary/60 bg-primary/8 ring-1 ring-primary/20"
                  : "border-border/65 hover:bg-card/70",
              )}
              aria-pressed={selectedKey === null}
              onClick={() => setSelectedKey(null)}
            >
              <span>
                <span className="block font-medium">No pet</span>
                <span className="block text-xs text-muted-foreground">Hide the workspace pet</span>
              </span>
              {selectedKey === null ? <CheckIcon className="size-4 text-primary" /> : null}
            </button>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {catalog.pets.map((pet) => (
                <PetChoice
                  key={pet.key}
                  environmentId={environmentId}
                  pet={pet}
                  selected={selectedKey === pet.key}
                  codexDefault={catalog.selectedPetKey === pet.key}
                  onSelect={() => setSelectedKey(pet.key)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Browse Codex Pets"
        icon={<PawPrintIcon className="size-5" />}
        headerAction={
          <a
            href="https://codex-pets.net/"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            codex-pets.net
          </a>
        }
      >
        <div className="rounded-xl px-3 pt-1 pb-2 sm:px-4">
          <p className="max-w-2xl text-[13px] leading-[1.5] text-muted-foreground/80">
            Pets shared by the community. Installing one downloads its sprite kit into your Codex
            pets folder, where it shows up in the list above.
          </p>
        </div>
        <PetGalleryBrowser environmentId={environmentId} onInstalled={refresh} />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
