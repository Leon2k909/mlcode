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

// ---------------------------------------------------------------------------
// Gallery — pets published on codex-pets.net
// ---------------------------------------------------------------------------

/**
 * One pet as the gallery offers it.
 *
 * Deliberately carries no download URL. Installing takes an id and nothing
 * else, so the server resolves the archive location from the gallery itself
 * rather than fetching whatever address a client hands it.
 */
export const PetGalleryEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  kind: Schema.NullOr(TrimmedNonEmptyString),
  authorName: Schema.NullOr(TrimmedNonEmptyString),
  tags: Schema.Array(TrimmedNonEmptyString),
  /** Animated preview, when the gallery has one. */
  previewUrl: Schema.NullOr(TrimmedNonEmptyString),
  /** Still frame, cheaper to render in a grid. */
  posterUrl: Schema.NullOr(TrimmedNonEmptyString),
  likeCount: NonNegativeInt,
  downloadCount: NonNegativeInt,
  /** True when a pet with this id already exists locally. */
  installed: Schema.Boolean,
});
export type PetGalleryEntry = typeof PetGalleryEntry.Type;

export const PetGallerySort = Schema.Literals(["popular", "recent"]);
export type PetGallerySort = typeof PetGallerySort.Type;

export const PetGalleryPage = Schema.Struct({
  pets: Schema.Array(PetGalleryEntry),
  page: PositiveInt,
  totalPages: NonNegativeInt,
  total: NonNegativeInt,
});
export type PetGalleryPage = typeof PetGalleryPage.Type;

export const PetsBrowseGalleryInput = Schema.Struct({
  page: Schema.optionalKey(PositiveInt),
  search: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(PetGallerySort),
});
export type PetsBrowseGalleryInput = typeof PetsBrowseGalleryInput.Type;

export const PetsInstallInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type PetsInstallInput = typeof PetsInstallInput.Type;

export const PetsUninstallInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type PetsUninstallInput = typeof PetsUninstallInput.Type;

export const PetsInstallResult = Schema.Struct({
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
});
export type PetsInstallResult = typeof PetsInstallResult.Type;

export const PetsEmptyResult = Schema.Struct({});
export type PetsEmptyResult = typeof PetsEmptyResult.Type;

export const PetGalleryFailureReason = Schema.Literals([
  "unreachable",
  "not-found",
  "rejected-archive",
  "not-installed",
  "write-failed",
]);
export type PetGalleryFailureReason = typeof PetGalleryFailureReason.Type;

export class PetGalleryError extends Schema.TaggedErrorClass<PetGalleryError>()("PetGalleryError", {
  reason: PetGalleryFailureReason,
  message: Schema.String,
}) {}
