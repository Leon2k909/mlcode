import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import {
  canonicalKeyFromGitConfig,
  checkWorkspacePath,
  classifyWorkspacePath,
  describeMissingWorkspace,
  parseGitConfigRemoteUrl,
} from "./WorkspaceRelocation.ts";

const gitConfig = (remotes: ReadonlyArray<readonly [string, string]>): string =>
  [
    "[core]",
    "\trepositoryformatversion = 0",
    ...remotes.flatMap(([name, url]) => [
      `[remote "${name}"]`,
      `\turl = ${url}`,
      `\tfetch = +refs/heads/*:refs/remotes/${name}/*`,
    ]),
    '[branch "main"]',
    "\tremote = origin",
  ].join("\n");

const tempRoots: string[] = [];
const makeTempDir = (): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-relocation-"));
  tempRoots.push(dir);
  return dir;
};

afterAll(() => {
  for (const root of tempRoots) {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

describe("parseGitConfigRemoteUrl", () => {
  it("prefers upstream, then origin, then the first remote", () => {
    expect(
      parseGitConfigRemoteUrl(
        gitConfig([
          ["origin", "https://github.com/me/fork.git"],
          ["upstream", "https://github.com/them/repo.git"],
        ]),
      ),
    ).toBe("https://github.com/them/repo.git");
    expect(
      parseGitConfigRemoteUrl(
        gitConfig([
          ["backup", "https://example.com/backup.git"],
          ["origin", "https://github.com/me/repo.git"],
        ]),
      ),
    ).toBe("https://github.com/me/repo.git");
    expect(parseGitConfigRemoteUrl(gitConfig([["backup", "https://example.com/b.git"]]))).toBe(
      "https://example.com/b.git",
    );
  });

  it("returns null for a config with no remote, and ignores comments", () => {
    expect(parseGitConfigRemoteUrl("[core]\n\tbare = false")).toBeNull();
    expect(parseGitConfigRemoteUrl("")).toBeNull();
    expect(
      parseGitConfigRemoteUrl('# [remote "origin"]\n#\turl = https://example.com/x.git'),
    ).toBeNull();
  });

  it("does not read a url that belongs to a later section", () => {
    expect(
      parseGitConfigRemoteUrl(
        ['[remote "origin"]', '[submodule "vendor"]', "\turl = https://example.com/v.git"].join(
          "\n",
        ),
      ),
    ).toBeNull();
  });

  it("matches an ssh and an https remote to the same canonical key", () => {
    expect(canonicalKeyFromGitConfig(gitConfig([["origin", "git@github.com:me/repo.git"]]))).toBe(
      canonicalKeyFromGitConfig(gitConfig([["origin", "https://github.com/me/repo.git"]])),
    );
  });
});

describe("classifyWorkspacePath", () => {
  const base = { workspaceRoot: "/w/t3code", canonicalKey: "github.com/me/repo" } as const;

  it("reports ok while the folder is there", () => {
    expect(classifyWorkspacePath({ ...base, exists: true, siblings: [] })).toEqual({
      status: "ok",
    });
  });

  it("names the new folder when exactly one sibling holds the same repository", () => {
    expect(
      classifyWorkspacePath({
        ...base,
        exists: false,
        siblings: [
          { path: "/w/unrelated", canonicalKey: "github.com/me/other" },
          { path: "/w/mlcode", canonicalKey: "github.com/me/repo" },
          { path: "/w/notes", canonicalKey: null },
        ],
      }),
    ).toEqual({ status: "missing", movedTo: "/w/mlcode", candidates: ["/w/mlcode"] });
  });

  it("refuses to guess between two clones of the same repository", () => {
    const result = classifyWorkspacePath({
      ...base,
      exists: false,
      siblings: [
        { path: "/w/mlcode", canonicalKey: "github.com/me/repo" },
        { path: "/w/repo-copy", canonicalKey: "github.com/me/repo" },
      ],
    });
    expect(result).toEqual({
      status: "missing",
      movedTo: null,
      candidates: ["/w/mlcode", "/w/repo-copy"],
    });
  });

  it("never proposes the missing path itself", () => {
    expect(
      classifyWorkspacePath({
        ...base,
        exists: false,
        siblings: [{ path: "/w/t3code", canonicalKey: "github.com/me/repo" }],
      }),
    ).toEqual({ status: "missing", movedTo: null, candidates: [] });
  });

  it("still reports missing for a project with no repository identity", () => {
    expect(
      classifyWorkspacePath({
        workspaceRoot: "/w/plain",
        canonicalKey: null,
        exists: false,
        siblings: [{ path: "/w/other", canonicalKey: "github.com/me/repo" }],
      }),
    ).toEqual({ status: "missing", movedTo: null, candidates: [] });
  });
});

describe("checkWorkspacePath", () => {
  it("finds the renamed folder on disk", () => {
    const parent = makeTempDir();
    const renamed = NodePath.join(parent, "mlcode");
    NodeFS.mkdirSync(NodePath.join(renamed, ".git"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(renamed, ".git", "config"),
      gitConfig([["origin", "https://github.com/pingdotgg/t3code.git"]]),
    );
    // A sibling that is a different repository, and one that is not a repo.
    NodeFS.mkdirSync(NodePath.join(parent, "elsewhere", ".git"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(parent, "elsewhere", ".git", "config"),
      gitConfig([["origin", "https://github.com/someone/else.git"]]),
    );
    NodeFS.mkdirSync(NodePath.join(parent, "just-a-folder"), { recursive: true });

    const status = checkWorkspacePath({
      workspaceRoot: NodePath.join(parent, "t3code"),
      canonicalKey: "github.com/pingdotgg/t3code",
    });

    expect(status.status).toBe("missing");
    expect(status.status === "missing" ? status.movedTo : null).toBe(renamed);
  });

  it("reports ok for a folder that exists", () => {
    expect(checkWorkspacePath({ workspaceRoot: makeTempDir(), canonicalKey: null }).status).toBe(
      "ok",
    );
  });
});

describe("describeMissingWorkspace", () => {
  it("points at the new folder when it knows one", () => {
    expect(
      describeMissingWorkspace({
        workspaceRoot: "/w/t3code",
        status: { status: "missing", movedTo: "/w/mlcode", candidates: ["/w/mlcode"] },
      }),
    ).toContain("renamed or moved to '/w/mlcode'");
  });

  it("says what it does not know rather than guessing", () => {
    const message = describeMissingWorkspace({
      workspaceRoot: "/w/t3code",
      status: { status: "missing", movedTo: null, candidates: [] },
    });
    expect(message).toContain("'/w/t3code'");
    expect(message).toContain("renamed, moved, or deleted");
  });
});
