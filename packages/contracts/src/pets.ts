import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PetSource = Schema.Literals(["micheon-custom", "custom", "legacy", "builtin"]);
export type PetSource = typeof PetSource.Type;

export const PetFrame = Schema.Struct({
  width: PositiveInt,
  height: PositiveInt,
  columns: PositiveInt,
  rows: PositiveInt,
});
export type PetFrame = typeof PetFrame.Type;

export const PetAnimation = Schema.Struct({
  id: TrimmedNonEmptyString,
  frames: Schema.Array(NonNegativeInt),
  fps: PositiveInt,
  loop: Schema.Boolean,
  fallback: Schema.optional(TrimmedNonEmptyString),
});
export type PetAnimation = typeof PetAnimation.Type;

export const PetCatalogEntry = Schema.Struct({
  key: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  source: PetSource,
  spriteVersionNumber: Schema.Literals([1, 2]),
  frame: PetFrame,
  animations: Schema.Array(PetAnimation),
});
export type PetCatalogEntry = typeof PetCatalogEntry.Type;

export const PetCatalog = Schema.Struct({
  pets: Schema.Array(PetCatalogEntry),
  selectedPetKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type PetCatalog = typeof PetCatalog.Type;

export const PetListInput = Schema.Struct({});
export type PetListInput = typeof PetListInput.Type;
