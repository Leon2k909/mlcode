// @effect-diagnostics nodeBuiltinImport:off - Pet discovery mirrors files owned by Codex and Micheon.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { PetAnimation, PetCatalogEntry, PetFrame, PetSource } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const MANIFEST_MAX_BYTES = 64 * 1024;
const MAX_ANIMATION_FRAMES = 256;
const DEFAULT_FRAME_WIDTH = 192;
const DEFAULT_FRAME_HEIGHT = 208;
const DEFAULT_COLUMNS = 8;
const DEFAULT_ROWS_BY_VERSION = { 1: 9, 2: 11 } as const;
const SUPPORTED_SPRITESHEET_EXTENSIONS = new Set([".png", ".webp"]);

const BUILTIN_PET_IDS = [
  "codex",
  "dewey",
  "fireball",
  "rocky",
  "seedy",
  "stacky",
  "bsod",
  "null-signal",
] as const;

const ManifestAnimation = Schema.Struct({
  frames: Schema.optional(Schema.Array(Schema.Number)),
  fps: Schema.optional(Schema.Number),
  loop: Schema.optional(Schema.Boolean),
  fallback: Schema.optional(Schema.String),
});

const PetManifest = Schema.Struct({
  id: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  spritesheetPath: Schema.optional(Schema.String),
  spriteVersionNumber: Schema.optional(Schema.Number),
  frameWidth: Schema.optional(Schema.Number),
  frameHeight: Schema.optional(Schema.Number),
  columns: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Number),
  frame: Schema.optional(
    Schema.Struct({
      width: Schema.optional(Schema.Number),
      height: Schema.optional(Schema.Number),
      columns: Schema.optional(Schema.Number),
      rows: Schema.optional(Schema.Number),
    }),
  ),
  animations: Schema.optional(Schema.Record(Schema.String, ManifestAnimation)),
});
type PetManifest = typeof PetManifest.Type;

const decodePetManifest = Schema.decodeUnknownOption(Schema.fromJsonString(PetManifest));

const DEFAULT_ANIMATIONS: ReadonlyArray<PetAnimation> = [
  { id: "idle", frames: [0, 1, 2, 3, 4, 5], fps: 3, loop: true },
  { id: "running-right", frames: [8, 9, 10, 11, 12, 13, 14, 15], fps: 10, loop: true },
  { id: "running-left", frames: [16, 17, 18, 19, 20, 21, 22, 23], fps: 10, loop: true },
  { id: "waving", frames: [24, 25, 26, 27], fps: 7, loop: false, fallback: "idle" },
  { id: "jumping", frames: [32, 33, 34, 35, 36], fps: 8, loop: false, fallback: "idle" },
  { id: "failed", frames: [40, 41, 42, 43, 44, 45, 46, 47], fps: 7, loop: false },
  { id: "waiting", frames: [48, 49, 50, 51, 52, 53], fps: 4, loop: true },
  { id: "running", frames: [56, 57, 58, 59, 60, 61], fps: 7, loop: true },
  { id: "review", frames: [64, 65, 66, 67, 68, 69], fps: 5, loop: true },
];

export interface PetDiscoveryRoots {
  readonly codexHome: string;
  readonly micheonHome: string;
}

export interface DiscoveredPet extends PetCatalogEntry {
  readonly spritesheetPath: string;
}

export interface DiscoveredPetCatalog {
  readonly pets: ReadonlyArray<DiscoveredPet>;
  readonly selectedPetKey: string | null;
}

function environmentPath(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  return NodePath.resolve(candidate && candidate.length > 0 ? candidate : fallback);
}

export function resolvePetDiscoveryRoots(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = NodeOS.homedir(),
): PetDiscoveryRoots {
  return {
    codexHome: environmentPath(environment.CODEX_HOME, NodePath.join(homeDirectory, ".codex")),
    micheonHome: environmentPath(
      environment.MICHEON_HOME,
      NodePath.join(homeDirectory, ".micheon"),
    ),
  };
}

function clampString(value: string | undefined, fallback: string, maximumLength: number): string {
  const trimmed = value?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : fallback).slice(0, maximumLength);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toLocaleUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function readManifest(manifestPath: string): PetManifest | null {
  try {
    const info = NodeFS.statSync(manifestPath);
    if (!info.isFile() || info.size <= 0 || info.size > MANIFEST_MAX_BYTES) return null;
    return Option.getOrNull(decodePetManifest(NodeFS.readFileSync(manifestPath, "utf8")));
  } catch {
    return null;
  }
}

function resolveContainedSpritesheet(petDirectory: string, requestedPath: string): string | null {
  if (NodePath.isAbsolute(requestedPath)) return null;
  try {
    const canonicalDirectory = NodeFS.realpathSync(petDirectory);
    const candidate = NodePath.resolve(canonicalDirectory, requestedPath);
    const canonicalCandidate = NodeFS.realpathSync(candidate);
    const relativePath = NodePath.relative(canonicalDirectory, canonicalCandidate);
    if (
      relativePath.length === 0 ||
      relativePath.startsWith("..") ||
      NodePath.isAbsolute(relativePath) ||
      !SUPPORTED_SPRITESHEET_EXTENSIONS.has(
        NodePath.extname(canonicalCandidate).toLocaleLowerCase(),
      )
    ) {
      return null;
    }
    return NodeFS.statSync(canonicalCandidate).isFile() ? canonicalCandidate : null;
  } catch {
    return null;
  }
}

function normalizeFrame(manifest: PetManifest, spriteVersionNumber: 1 | 2): PetFrame {
  return {
    width: positiveInteger(manifest.frame?.width ?? manifest.frameWidth, DEFAULT_FRAME_WIDTH),
    height: positiveInteger(manifest.frame?.height ?? manifest.frameHeight, DEFAULT_FRAME_HEIGHT),
    columns: positiveInteger(manifest.frame?.columns ?? manifest.columns, DEFAULT_COLUMNS),
    rows: positiveInteger(
      manifest.frame?.rows ?? manifest.rows,
      DEFAULT_ROWS_BY_VERSION[spriteVersionNumber],
    ),
  };
}

function normalizeAnimations(manifest: PetManifest, frame: PetFrame): ReadonlyArray<PetAnimation> {
  if (!manifest.animations) return DEFAULT_ANIMATIONS;
  const maximumFrameIndex = frame.columns * frame.rows - 1;
  const animations = Object.entries(manifest.animations).flatMap(([id, animation]) => {
    const animationId = id.trim().slice(0, 128);
    const frames = (animation.frames ?? [])
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= maximumFrameIndex)
      .slice(0, MAX_ANIMATION_FRAMES);
    if (animationId.length === 0 || frames.length === 0) return [];
    const fps = Math.min(60, positiveInteger(animation.fps, 3));
    const fallback = animation.fallback?.trim().slice(0, 128);
    return [
      {
        id: animationId,
        frames,
        fps,
        loop: animation.loop ?? true,
        ...(fallback && fallback.length > 0 ? { fallback } : {}),
      } satisfies PetAnimation,
    ];
  });
  return animations.length > 0 ? animations : DEFAULT_ANIMATIONS;
}

function manifestPet(
  petDirectory: string,
  folderName: string,
  source: PetSource,
  manifestFileName: "pet.json" | "avatar.json",
): DiscoveredPet | null {
  const manifest = readManifest(NodePath.join(petDirectory, manifestFileName));
  if (!manifest) return null;
  const id = clampString(manifest.id, folderName, 256);
  const spritesheetPath = resolveContainedSpritesheet(
    petDirectory,
    clampString(manifest.spritesheetPath, "spritesheet.webp", 1024),
  );
  if (!spritesheetPath) return null;
  const spriteVersionNumber = manifest.spriteVersionNumber === 2 ? 2 : 1;
  const frame = normalizeFrame(manifest, spriteVersionNumber);
  const description = manifest.description?.trim().slice(0, 1024);
  return {
    key: `${source}:${id}`,
    id,
    displayName: clampString(manifest.displayName, titleFromId(id), 256),
    ...(description && description.length > 0 ? { description } : {}),
    source,
    spriteVersionNumber,
    frame,
    animations: normalizeAnimations(manifest, frame),
    spritesheetPath,
  };
}

function discoverManifestPets(
  rootDirectory: string,
  source: PetSource,
  manifestFileName: "pet.json" | "avatar.json",
): ReadonlyArray<DiscoveredPet> {
  try {
    return NodeFS.readdirSync(rootDirectory, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const pet = manifestPet(
        NodePath.join(rootDirectory, entry.name),
        entry.name,
        source,
        manifestFileName,
      );
      return pet ? [pet] : [];
    });
  } catch {
    return [];
  }
}

function discoverBuiltinPets(codexHome: string): ReadonlyArray<DiscoveredPet> {
  const assetsDirectory = NodePath.join(codexHome, "cache", "tui-pets", "v1", "assets");
  let fileNames: ReadonlyArray<string>;
  try {
    fileNames = NodeFS.readdirSync(assetsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  return BUILTIN_PET_IDS.flatMap((id) => {
    const expectedName = `${id}-spritesheet-v4.webp`;
    const fileName =
      fileNames.find((candidate) => candidate === expectedName) ??
      fileNames.find(
        (candidate) =>
          candidate.startsWith(`${id}-spritesheet-`) &&
          SUPPORTED_SPRITESHEET_EXTENSIONS.has(NodePath.extname(candidate).toLocaleLowerCase()),
      );
    if (!fileName) return [];
    const spritesheetPath = resolveContainedSpritesheet(assetsDirectory, fileName);
    if (!spritesheetPath) return [];
    return [
      {
        key: `builtin:${id}`,
        id,
        displayName: titleFromId(id),
        description: "Built-in Codex pet.",
        source: "builtin",
        spriteVersionNumber: 1,
        frame: {
          width: DEFAULT_FRAME_WIDTH,
          height: DEFAULT_FRAME_HEIGHT,
          columns: DEFAULT_COLUMNS,
          rows: DEFAULT_ROWS_BY_VERSION[1],
        },
        animations: DEFAULT_ANIMATIONS,
        spritesheetPath,
      } satisfies DiscoveredPet,
    ];
  });
}

function readSelectedPetKey(codexHome: string, pets: ReadonlyArray<DiscoveredPet>): string | null {
  let selected: string | null = null;
  try {
    const configPath = NodePath.join(codexHome, "config.toml");
    if (!NodeFS.existsSync(configPath) || NodeFS.statSync(configPath).size > MANIFEST_MAX_BYTES * 4)
      return null;
    const match = /^\s*selected-avatar-id\s*=\s*"([^"]+)"/m.exec(
      NodeFS.readFileSync(configPath, "utf8"),
    );
    selected = match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
  if (!selected) return null;
  const exact = pets.find((pet) => pet.key === selected);
  if (exact) return exact.key;
  const id = selected.includes(":") ? selected.slice(selected.indexOf(":") + 1) : selected;
  return pets.find((pet) => pet.id === id)?.key ?? null;
}

export function discoverPetCatalog(
  roots: PetDiscoveryRoots = resolvePetDiscoveryRoots(),
): DiscoveredPetCatalog {
  const micheonPets = discoverManifestPets(
    NodePath.join(roots.micheonHome, "pets"),
    "micheon-custom",
    "pet.json",
  );
  const micheonIds = new Set(micheonPets.map((pet) => pet.id));
  const codexPets = [
    ...discoverManifestPets(NodePath.join(roots.codexHome, "pets"), "custom", "pet.json"),
    ...discoverManifestPets(NodePath.join(roots.codexHome, "avatars"), "legacy", "avatar.json"),
    ...discoverBuiltinPets(roots.codexHome),
  ].filter((pet) => !micheonIds.has(pet.id));
  const seenKeys = new Set<string>();
  const pets = [...micheonPets, ...codexPets]
    .filter((pet) => {
      if (seenKeys.has(pet.key)) return false;
      seenKeys.add(pet.key);
      return true;
    })
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }),
    );
  return {
    pets,
    selectedPetKey: readSelectedPetKey(roots.codexHome, pets),
  };
}

export function resolvePetSpritesheet(
  key: string,
  roots: PetDiscoveryRoots = resolvePetDiscoveryRoots(),
): string | null {
  return discoverPetCatalog(roots).pets.find((pet) => pet.key === key)?.spritesheetPath ?? null;
}

export function petSpritesheetFileName(pet: DiscoveredPet): string {
  return NodePath.basename(pet.spritesheetPath);
}
