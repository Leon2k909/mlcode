/**
 * Browsing and installing pets published on codex-pets.net.
 *
 * The gallery is somebody else's server handing us an archive to unpack into
 * the user's home directory, so everything here is written from that premise.
 * Three rules do the work:
 *
 * 1. **The client never names a URL.** Installing takes a pet id; this module
 *    asks the gallery where that pet lives and refuses any answer that resolves
 *    off the gallery's own origin. A client cannot use us as a fetcher.
 * 2. **The archive is validated before a single byte is written.** Entry paths,
 *    extensions, counts, and sizes are all checked up front, so a rejected
 *    archive leaves nothing behind.
 * 3. **Only data comes out.** JSON and images, never anything executable, and
 *    never a path that escapes the pet's own directory.
 */
// @effect-diagnostics nodeBuiltinImport:off - Pets are files owned by Codex, mirrored the way PetCatalog does.
import * as NodePath from "node:path";

import {
  type PetGalleryEntry,
  PetGalleryError,
  type PetGalleryPage,
  type PetGallerySort,
  type PetsBrowseGalleryInput,
  type PetsInstallResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { discoverPetCatalog, resolvePetDiscoveryRoots } from "./PetCatalog.ts";

/** The only host this module will fetch from, for listings and archives alike. */
const GALLERY_ORIGIN = "https://codex-pets.net";
const GALLERY_PAGE_SIZE = 30;

/**
 * Limits on an untrusted archive. Generous enough for a real sprite kit — the
 * gallery's own pets run to a couple of megabytes — and small enough that a
 * hostile one cannot fill a disk.
 */
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_COUNT = 64;
const ALLOWED_EXTENSIONS = [".json", ".png", ".webp"] as const;

/**
 * Pet ids become a directory name, so they are restricted to a shape that
 * cannot traverse, hide, or collide case-insensitively.
 */
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const REQUIRED_MANIFEST_NAME = "pet.json";

const galleryError = (reason: PetGalleryError["reason"], message: string) =>
  new PetGalleryError({ reason, message });

const isPetGalleryError = Schema.is(PetGalleryError);

/**
 * Decoded permissively: the gallery is free to add fields and we should keep
 * working when it does, so anything we do not understand is ignored rather than
 * treated as a failure.
 */
const GalleryPet = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(Schema.NullOr(Schema.String)),
  ownerName: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  previewUrl: Schema.optional(Schema.NullOr(Schema.String)),
  posterUrl: Schema.optional(Schema.NullOr(Schema.String)),
  likeCount: Schema.optional(Schema.Number),
  downloadCount: Schema.optional(Schema.Number),
  downloadUrl: Schema.optional(Schema.NullOr(Schema.String)),
});
type GalleryPet = typeof GalleryPet.Type;

const GalleryListResponse = Schema.Struct({
  pets: Schema.Array(GalleryPet),
  page: Schema.optional(Schema.Number),
  total: Schema.optional(Schema.Number),
  totalPages: Schema.optional(Schema.Number),
});

const GalleryDetailResponse = Schema.Struct({
  pet: GalleryPet,
});

const nonNegative = (value: number | undefined): number =>
  Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value ?? 0) : 0;

const trimmedOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
};

export interface PetGalleryShape {
  readonly browse: (
    input: PetsBrowseGalleryInput,
  ) => Effect.Effect<PetGalleryPage, PetGalleryError>;
  readonly install: (id: string) => Effect.Effect<PetsInstallResult, PetGalleryError>;
  readonly uninstall: (id: string) => Effect.Effect<void, PetGalleryError>;
}

export class PetGallery extends Context.Service<PetGallery, PetGalleryShape>()(
  "t3/pets/PetGallery",
) {}

/**
 * Rejects an entry path that would land outside the pet's own directory.
 *
 * Zip entries are attacker-controlled strings, and the interesting attacks are
 * all spelling tricks: a leading slash, a `..` segment, a Windows drive letter,
 * or a backslash separator that only becomes one after the path is joined.
 */
export function safeArchiveEntryPath(entryName: string): string | null {
  const normalized = entryName.replaceAll("\\", "/").trim();
  if (normalized.length === 0 || normalized.endsWith("/")) {
    return null;
  }
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) {
    return null;
  }
  const extension = segments[segments.length - 1]?.toLowerCase().replace(/^.*(?=\.)/, "") ?? "";
  if (!ALLOWED_EXTENSIONS.some((allowed) => extension === allowed)) {
    return null;
  }
  return segments.join("/");
}

/** True when `candidate` is `root` itself or sits underneath it. */
export function isInsideDirectory(root: string, candidate: string): boolean {
  const resolvedRoot = NodePath.resolve(root);
  const resolvedCandidate = NodePath.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${NodePath.sep}`)
  );
}

export function isValidPetId(id: string): boolean {
  return PET_ID_PATTERN.test(id) && !NodePath.isAbsolute(id);
}

/**
 * Accepts a download location only when it resolves onto the gallery's own
 * origin, so a redirected or rewritten `downloadUrl` cannot point us elsewhere.
 */
export function resolveGalleryDownloadUrl(downloadUrl: string): string | null {
  try {
    const resolved = new URL(downloadUrl, `${GALLERY_ORIGIN}/`);
    return resolved.origin === GALLERY_ORIGIN ? resolved.toString() : null;
  } catch {
    return null;
  }
}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;

  const petsDirectory = () => NodePath.join(resolvePetDiscoveryRoots().codexHome, "pets");

  const installedIds = Effect.sync(
    () => new Set(discoverPetCatalog().pets.map((pet) => pet.id.toLowerCase())),
  ).pipe(Effect.catchCause(() => Effect.succeed(new Set<string>())));

  const requestJson = <A, I>(url: string, schema: Schema.Codec<A, I>) =>
    HttpClientRequest.get(url).pipe(
      httpClient.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout("20 seconds"),
      Effect.mapError(() =>
        galleryError("unreachable", "Could not reach codex-pets.net. Check your connection."),
      ),
    );

  const toEntry = (pet: GalleryPet, installed: ReadonlySet<string>): PetGalleryEntry => ({
    id: pet.id,
    displayName: trimmedOrNull(pet.displayName) ?? pet.id,
    description: trimmedOrNull(pet.description),
    kind: trimmedOrNull(pet.kind),
    authorName: trimmedOrNull(pet.ownerName),
    tags: (pet.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    previewUrl: trimmedOrNull(pet.previewUrl),
    posterUrl: trimmedOrNull(pet.posterUrl),
    likeCount: nonNegative(pet.likeCount),
    downloadCount: nonNegative(pet.downloadCount),
    installed: installed.has(pet.id.toLowerCase()),
  });

  const browse: PetGalleryShape["browse"] = (input) =>
    Effect.gen(function* () {
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const sort: PetGallerySort = input.sort ?? "popular";
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(GALLERY_PAGE_SIZE),
        sort,
      });
      const search = input.search?.trim();
      if (search !== undefined && search.length > 0) {
        query.set("q", search);
      }
      const response = yield* requestJson(
        `${GALLERY_ORIGIN}/api/pets?${query.toString()}`,
        GalleryListResponse,
      );
      const installed = yield* installedIds;
      // Ids are the directory name, so a pet we could never install is one we
      // should not offer either.
      const pets = response.pets
        .filter((pet) => isValidPetId(pet.id))
        .map((pet) => toEntry(pet, installed));
      return {
        pets,
        page,
        total: nonNegative(response.total),
        totalPages: nonNegative(response.totalPages),
      } satisfies PetGalleryPage;
    });

  const install: PetGalleryShape["install"] = (id) =>
    Effect.gen(function* () {
      if (!isValidPetId(id)) {
        return yield* galleryError("not-found", `'${id}' is not a valid pet id.`);
      }

      const detail = yield* requestJson(
        `${GALLERY_ORIGIN}/api/pets/${encodeURIComponent(id)}`,
        GalleryDetailResponse,
      );
      const downloadUrl =
        detail.pet.downloadUrl === null || detail.pet.downloadUrl === undefined
          ? null
          : resolveGalleryDownloadUrl(detail.pet.downloadUrl);
      if (downloadUrl === null) {
        return yield* galleryError(
          "not-found",
          `codex-pets.net has no downloadable package for '${id}'.`,
        );
      }

      const archive = yield* HttpClientRequest.get(downloadUrl).pipe(
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.timeout("60 seconds"),
        Effect.mapError(() =>
          galleryError("unreachable", `Could not download '${id}' from codex-pets.net.`),
        ),
      );
      if (archive.byteLength > MAX_ARCHIVE_BYTES) {
        return yield* galleryError("rejected-archive", `The package for '${id}' is too large.`);
      }

      const files = yield* readPetArchive(new Uint8Array(archive), id);

      const destination = NodePath.join(petsDirectory(), id);
      if (!isInsideDirectory(petsDirectory(), destination)) {
        return yield* galleryError("rejected-archive", `'${id}' resolves outside the pets folder.`);
      }

      const write = Effect.gen(function* () {
        yield* fileSystem.makeDirectory(destination, { recursive: true });
        yield* Effect.forEach(
          files,
          (file) =>
            Effect.gen(function* () {
              const filePath = NodePath.join(destination, file.path);
              // Re-checked after joining: validation proved the entry name was
              // well formed, this proves the resulting path really landed where
              // it was supposed to.
              if (!isInsideDirectory(destination, filePath)) {
                return yield* galleryError(
                  "rejected-archive",
                  `'${id}' contains a path that escapes its folder.`,
                );
              }
              const parent = filePath.slice(0, filePath.lastIndexOf(NodePath.sep));
              yield* fileSystem.makeDirectory(parent, { recursive: true });
              yield* fileSystem.writeFile(filePath, file.contents);
            }),
          { discard: true },
        );
      }).pipe(
        Effect.catchIf(isPetGalleryError, (error) => Effect.fail(error)),
        Effect.catchCause(() =>
          Effect.fail(galleryError("write-failed", `Could not save '${id}' to the pets folder.`)),
        ),
      );
      yield* write;

      return {
        id,
        displayName: trimmedOrNull(detail.pet.displayName) ?? id,
      } satisfies PetsInstallResult;
    });

  const uninstall: PetGalleryShape["uninstall"] = (id) =>
    Effect.gen(function* () {
      if (!isValidPetId(id)) {
        return yield* galleryError("not-found", `'${id}' is not a valid pet id.`);
      }
      const root = petsDirectory();
      const target = NodePath.join(root, id);
      if (!isInsideDirectory(root, target) || NodePath.resolve(target) === NodePath.resolve(root)) {
        return yield* galleryError("not-installed", `'${id}' is not an installed pet.`);
      }
      const exists = yield* fileSystem
        .exists(target)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (!exists) {
        return yield* galleryError("not-installed", `'${id}' is not installed.`);
      }
      yield* fileSystem
        .remove(target, { recursive: true })
        .pipe(
          Effect.mapError(() =>
            galleryError("write-failed", `Could not remove '${id}' from the pets folder.`),
          ),
        );
    });

  return { browse, install, uninstall } satisfies PetGalleryShape;
});

export interface ArchiveFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

/**
 * Validates the whole archive and returns its files, or fails without touching
 * the disk. Nothing is written until every entry has passed, so a rejected
 * package cannot leave a half-installed pet behind.
 */
const readPetArchive = (archive: Uint8Array, id: string) =>
  Effect.tryPromise({
    try: async (): Promise<ReadonlyArray<ArchiveFile>> => {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(archive);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      if (entries.length === 0 || entries.length > MAX_ENTRY_COUNT) {
        throw new Error("entry count");
      }

      const files: ArchiveFile[] = [];
      let totalBytes = 0;
      for (const entry of entries) {
        const safePath = safeArchiveEntryPath(entry.name);
        if (safePath === null) {
          throw new Error(`unsafe entry: ${entry.name}`);
        }
        const contents = await entry.async("uint8array");
        if (contents.byteLength > MAX_ENTRY_BYTES) {
          throw new Error("entry too large");
        }
        totalBytes += contents.byteLength;
        if (totalBytes > MAX_ARCHIVE_BYTES) {
          throw new Error("archive too large");
        }
        files.push({ path: safePath, contents });
      }

      // Without a manifest the pet catalog would never surface it, so an
      // archive that lacks one is not a pet however well formed it looks.
      if (!files.some((file) => file.path.split("/").pop() === REQUIRED_MANIFEST_NAME)) {
        throw new Error("missing manifest");
      }
      return files;
    },
    catch: () => galleryError("rejected-archive", `The package for '${id}' is not a usable pet.`),
  });

export const layer = Layer.effect(PetGallery, make);
