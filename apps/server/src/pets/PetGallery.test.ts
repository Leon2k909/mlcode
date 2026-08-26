// @effect-diagnostics nodeBuiltinImport:off - Path assertions mirror the module under test.
import { describe, expect, it } from "@effect/vitest";
import * as NodePath from "node:path";

import {
  isInsideDirectory,
  isValidPetId,
  resolveGalleryDownloadUrl,
  safeArchiveEntryPath,
} from "./PetGallery.ts";

describe("safeArchiveEntryPath", () => {
  it("accepts the files a real sprite kit contains", () => {
    expect(safeArchiveEntryPath("pet.json")).toBe("pet.json");
    expect(safeArchiveEntryPath("spritesheet.webp")).toBe("spritesheet.webp");
    expect(safeArchiveEntryPath("art/poster.png")).toBe("art/poster.png");
  });

  it("normalizes Windows separators rather than rejecting them", () => {
    // Some zip writers emit backslashes; that alone is not hostile.
    expect(safeArchiveEntryPath("art\\poster.png")).toBe("art/poster.png");
  });

  it("refuses paths that climb out of the pet folder", () => {
    for (const name of [
      "../pet.json",
      "art/../../pet.json",
      "./pet.json",
      "..\\..\\pet.json",
      "a/../../../etc/pet.json",
    ]) {
      expect(safeArchiveEntryPath(name)).toBeNull();
    }
  });

  it("refuses absolute paths and drive letters", () => {
    expect(safeArchiveEntryPath("/etc/pet.json")).toBeNull();
    expect(safeArchiveEntryPath("C:/Windows/pet.json")).toBeNull();
    expect(safeArchiveEntryPath("c:\\windows\\pet.json")).toBeNull();
  });

  it("refuses anything that is not data", () => {
    // The whole point of the allowlist: a pet is JSON and images, so an archive
    // offering something executable is not a pet.
    for (const name of [
      "install.sh",
      "pet.json.exe",
      "hook.js",
      "payload.dll",
      "notes.txt",
      "spritesheet",
    ]) {
      expect(safeArchiveEntryPath(name)).toBeNull();
    }
  });

  it("refuses empty names and directory entries", () => {
    expect(safeArchiveEntryPath("")).toBeNull();
    expect(safeArchiveEntryPath("   ")).toBeNull();
    expect(safeArchiveEntryPath("art/")).toBeNull();
  });
});

describe("isInsideDirectory", () => {
  const root = NodePath.resolve("/tmp/pets");

  it("accepts the directory itself and its descendants", () => {
    expect(isInsideDirectory(root, root)).toBe(true);
    expect(isInsideDirectory(root, NodePath.join(root, "shoebill"))).toBe(true);
    expect(isInsideDirectory(root, NodePath.join(root, "shoebill", "pet.json"))).toBe(true);
  });

  it("rejects siblings and ancestors", () => {
    expect(isInsideDirectory(root, NodePath.resolve("/tmp"))).toBe(false);
    expect(isInsideDirectory(root, NodePath.join(root, "..", "other"))).toBe(false);
  });

  it("rejects a sibling whose name merely starts with the root", () => {
    // The prefix check has to be separator-aware or "/tmp/pets-evil" passes.
    expect(isInsideDirectory(root, `${root}-evil`)).toBe(false);
  });
});

describe("isValidPetId", () => {
  it("accepts the ids the gallery publishes", () => {
    for (const id of ["shoebill", "chak-chak", "heart-gromi", "pet.2", "a"]) {
      expect(isValidPetId(id)).toBe(true);
    }
  });

  it("rejects ids that would escape or hide a directory", () => {
    for (const id of ["..", ".", "../evil", "a/b", "a\\b", "/abs", "", " leading", "C:evil"]) {
      expect(isValidPetId(id)).toBe(false);
    }
  });

  it("rejects an id long enough to be a denial of service on the filesystem", () => {
    expect(isValidPetId("a".repeat(65))).toBe(false);
  });
});

describe("resolveGalleryDownloadUrl", () => {
  it("resolves the relative path the gallery returns", () => {
    expect(resolveGalleryDownloadUrl("/api/pets/shoebill/download?v=123")).toBe(
      "https://codex-pets.net/api/pets/shoebill/download?v=123",
    );
  });

  it("accepts an absolute URL that stays on the gallery", () => {
    expect(resolveGalleryDownloadUrl("https://codex-pets.net/api/pets/x/download")).toBe(
      "https://codex-pets.net/api/pets/x/download",
    );
  });

  it("refuses to fetch from anywhere else", () => {
    // A rewritten downloadUrl must not turn the server into a fetcher for an
    // arbitrary host, including a lookalike or the local network.
    for (const url of [
      "https://evil.example.com/payload.zip",
      "http://codex-pets.net/api/pets/x/download",
      "https://codex-pets.net.evil.com/x",
      "http://127.0.0.1:8080/x",
      "file:///etc/passwd",
      "//evil.example.com/payload.zip",
    ]) {
      expect(resolveGalleryDownloadUrl(url)).toBeNull();
    }
  });

  it("keeps a nonsense value on the gallery rather than rejecting it", () => {
    // The guarantee is about the origin, not about the path being sensible. A
    // garbage path resolves onto codex-pets.net and 404s there, which is a
    // harmless outcome and simpler than trying to validate paths as well.
    expect(resolveGalleryDownloadUrl("not a url")).toBe("https://codex-pets.net/not%20a%20url");
  });
});
