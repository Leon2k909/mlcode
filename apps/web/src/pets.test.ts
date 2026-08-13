import { EnvironmentId, type PetCatalogEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolvePetSelection } from "./pets";

function pet(key: string): PetCatalogEntry {
  const [source = "custom", id = key] = key.split(":");
  return {
    key,
    id,
    displayName: id,
    source: source as PetCatalogEntry["source"],
    spriteVersionNumber: 1,
    frame: { width: 192, height: 208, columns: 8, rows: 9 },
    animations: [{ id: "idle", frames: [0], fps: 3, loop: true }],
  };
}

describe("resolvePetSelection", () => {
  const environmentId = EnvironmentId.make("primary");
  const pets = [pet("custom:michelle"), pet("micheon-custom:riley")];

  it("uses the Codex-selected pet until the user chooses one", () => {
    expect(resolvePetSelection({}, environmentId, "custom:michelle", pets)).toBe("custom:michelle");
  });

  it("keeps an explicit off selection", () => {
    expect(
      resolvePetSelection({ [environmentId]: null }, environmentId, "custom:michelle", pets),
    ).toBeNull();
  });

  it("falls back when a stored pet was removed", () => {
    expect(
      resolvePetSelection(
        { [environmentId]: "custom:missing" },
        environmentId,
        "micheon-custom:riley",
        pets,
      ),
    ).toBe("micheon-custom:riley");
  });
});
