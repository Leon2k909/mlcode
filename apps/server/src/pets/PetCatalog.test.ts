// @effect-diagnostics nodeBuiltinImport:off
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { discoverPetCatalog, resolvePetSpritesheet } from "./PetCatalog.ts";

const temporaryDirectories: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ml-code-pets-"));
  temporaryDirectories.push(root);
  return root;
}

function writePet(
  home: string,
  folder: string,
  manifest: Record<string, unknown>,
  location: "pets" | "avatars" = "pets",
): string {
  const directory = join(home, location, folder);
  mkdirSync(directory, { recursive: true });
  const manifestName = location === "avatars" ? "avatar.json" : "pet.json";
  writeFileSync(join(directory, manifestName), JSON.stringify(manifest));
  const spritesheetPath = join(directory, "spritesheet.webp");
  writeFileSync(spritesheetPath, "sprite");
  return spritesheetPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("discoverPetCatalog", () => {
  it("discovers Micheon and Codex pets with Micheon taking duplicate ids", () => {
    const root = temporaryRoot();
    const micheonHome = join(root, "micheon");
    const codexHome = join(root, "codex");
    writePet(micheonHome, "riley", {
      id: "riley",
      displayName: "Riley from Micheon",
    });
    writePet(codexHome, "riley", {
      id: "riley",
      displayName: "Riley from Codex",
    });
    writePet(codexHome, "michelle", {
      id: "michelle",
      displayName: "Michelle",
      spriteVersionNumber: 2,
    });
    writeFileSync(join(codexHome, "config.toml"), 'selected-avatar-id = "custom:michelle"');

    const catalog = discoverPetCatalog({ codexHome, micheonHome });

    expect(catalog.pets.map((pet) => pet.key)).toEqual(["custom:michelle", "micheon-custom:riley"]);
    expect(catalog.pets.find((pet) => pet.id === "riley")?.displayName).toBe("Riley from Micheon");
    expect(catalog.pets.find((pet) => pet.id === "michelle")?.frame.rows).toBe(11);
    expect(catalog.selectedPetKey).toBe("custom:michelle");
  });

  it("ignores spritesheets that escape their pet directory", () => {
    const root = temporaryRoot();
    const micheonHome = join(root, "micheon");
    const codexHome = join(root, "codex");
    const petDirectory = join(codexHome, "pets", "unsafe");
    mkdirSync(petDirectory, { recursive: true });
    writeFileSync(join(codexHome, "pets", "outside.webp"), "sprite");
    writeFileSync(
      join(petDirectory, "pet.json"),
      JSON.stringify({ id: "unsafe", spritesheetPath: "../outside.webp" }),
    );

    const catalog = discoverPetCatalog({ codexHome, micheonHome });

    expect(catalog.pets).toEqual([]);
    expect(resolvePetSpritesheet("custom:unsafe", { codexHome, micheonHome })).toBeNull();
  });

  it("supports legacy Codex avatars and custom animation metadata", () => {
    const root = temporaryRoot();
    const micheonHome = join(root, "micheon");
    const codexHome = join(root, "codex");
    writePet(
      codexHome,
      "dewey",
      {
        id: "dewey",
        displayName: "Dewey",
        animations: {
          idle: { frames: [0, 2, 4], fps: 5, loop: true },
        },
      },
      "avatars",
    );

    const catalog = discoverPetCatalog({ codexHome, micheonHome });

    expect(catalog.pets).toHaveLength(1);
    expect(catalog.pets[0]?.source).toBe("legacy");
    expect(catalog.pets[0]?.animations[0]).toEqual({
      id: "idle",
      frames: [0, 2, 4],
      fps: 5,
      loop: true,
    });
  });
});
