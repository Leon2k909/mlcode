import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PetCatalog, PetCatalogEntry } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback } from "react";

import { useLocalStorage } from "./hooks/useLocalStorage";
import { petEnvironment } from "./state/pets";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { useEnvironmentQuery } from "./state/query";

const PET_SELECTION_STORAGE_KEY = "ml-code:pet-selections:v1";
const PetSelections = Schema.Record(Schema.String, Schema.NullOr(Schema.String));
type PetSelections = typeof PetSelections.Type;
const EMPTY_SELECTIONS: PetSelections = {};

export interface PrimaryPetCatalogView {
  readonly environmentId: EnvironmentId | null;
  readonly catalog: PetCatalog | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export function usePrimaryPetCatalog(): PrimaryPetCatalogView {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : petEnvironment.list({
          environmentId,
          input: {},
        }),
  );
  return {
    environmentId,
    catalog: query.data,
    error: query.error,
    isPending: query.isPending,
    refresh: query.refresh,
  };
}

export function resolvePetSelection(
  selections: PetSelections,
  environmentId: EnvironmentId | null,
  defaultPetKey: string | null,
  pets: ReadonlyArray<PetCatalogEntry>,
): string | null {
  if (environmentId === null) return null;
  const availableKeys = new Set(pets.map((pet) => pet.key));
  const hasStoredSelection = Object.hasOwn(selections, environmentId);
  const storedSelection = hasStoredSelection ? selections[environmentId] : undefined;
  if (storedSelection === null) return null;
  if (storedSelection !== undefined && availableKeys.has(storedSelection)) return storedSelection;
  return defaultPetKey !== null && availableKeys.has(defaultPetKey) ? defaultPetKey : null;
}

export function usePetSelection(
  environmentId: EnvironmentId | null,
  catalog: PetCatalog | null,
): {
  readonly selectedKey: string | null;
  readonly selectedPet: PetCatalogEntry | null;
  readonly setSelectedKey: (key: string | null) => void;
} {
  const [selections, setSelections] = useLocalStorage(
    PET_SELECTION_STORAGE_KEY,
    EMPTY_SELECTIONS,
    PetSelections,
  );
  const pets = catalog?.pets ?? [];
  const selectedKey = resolvePetSelection(
    selections,
    environmentId,
    catalog?.selectedPetKey ?? null,
    pets,
  );
  const selectedPet = pets.find((pet) => pet.key === selectedKey) ?? null;
  const setSelectedKey = useCallback(
    (key: string | null) => {
      if (environmentId === null) return;
      setSelections((current) => ({ ...current, [environmentId]: key }));
    },
    [environmentId, setSelections],
  );
  return { selectedKey, selectedPet, setSelectedKey };
}
