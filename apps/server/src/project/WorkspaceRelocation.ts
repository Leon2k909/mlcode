/**
 * Detection for a workspace directory that was renamed, moved, or deleted
 * out from under a project.
 *
 * A project stores an absolute `workspaceRoot`. Nothing stops a user from
 * renaming that folder in Explorer — and when they do, every turn in every
 * thread of that project fails deep inside the provider adapter, as a raw
 * `ENOENT ... FileSystem.access` on a path the error text never explains. The
 * user sees a stack trace about a spawn failure; the actual problem is that a
 * folder has a different name now.
 *
 * This module turns that into a diagnosis. The check itself is one `stat` on
 * the recorded path, cheap enough to run before every turn. Only when the path
 * is gone does it do the more expensive thing: look through the sibling
 * directories for one that is the same repository under a new name.
 *
 * The match uses the repository's canonical remote key — the same
 * `normalizeGitRemoteUrl` value `RepositoryIdentityResolver` computes — read
 * straight out of each candidate's `.git/config`. Reading the file rather than
 * shelling out to `git` matters: this runs on a path that is already failing,
 * and spawning one process per sibling directory to diagnose a spawn failure
 * is a poor trade.
 *
 * A project with no recorded repository identity (a plain folder, no git) can
 * still be reported missing; it just cannot be traced to its new home. That is
 * a smaller answer, not a wrong one.
 *
 * @module project/WorkspaceRelocation
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { normalizeGitRemoteUrl } from "@t3tools/shared/git";

/**
 * Upper bound on sibling directories inspected during a relocation search.
 *
 * A workspace usually sits in a folder of projects — tens of entries, not
 * thousands. The cap keeps a workspace parked somewhere pathological (a home
 * directory, `C:\`) from turning a failed turn into a directory crawl.
 */
const MAX_SIBLINGS_SCANNED = 200;

/** One directory that might be the workspace under a new name. */
export interface RelocationCandidate {
  readonly path: string;
  /** Canonical remote key, or `null` when the directory is not a git repo. */
  readonly canonicalKey: string | null;
}

export type WorkspacePathStatus =
  | { readonly status: "ok" }
  | {
      readonly status: "missing";
      /**
       * Where the workspace appears to have gone, when exactly one sibling
       * matches. `null` when nothing matched or when the match is ambiguous —
       * a wrong path here would send a user to the wrong repository.
       */
      readonly movedTo: string | null;
      /** Every matching directory, in scan order. */
      readonly candidates: readonly string[];
    };

/**
 * Extract the primary remote URL from the text of a `.git/config`.
 *
 * Prefers `upstream` then `origin`, matching `RepositoryIdentityResolver`'s
 * ordering so the keys computed here and there agree for a fork. Falls back to
 * the first remote in the file, and returns `null` when there is none — a repo
 * with no remote cannot be matched this way.
 *
 * Deliberately a small hand-rolled parse rather than a full INI reader: this
 * needs one value out of a well-known file shape, and a dependency that can
 * throw on an exotic config would defeat the purpose.
 */
export function parseGitConfigRemoteUrl(configText: string): string | null {
  const remotes = new Map<string, string>();
  let currentRemote: string | null = null;

  for (const rawLine of configText.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;

    const section = /^\[remote\s+"([^"]+)"]$/.exec(line);
    if (section) {
      currentRemote = section[1] ?? null;
      continue;
    }
    // Any other section header ends the remote block we were reading.
    if (line.startsWith("[")) {
      currentRemote = null;
      continue;
    }
    if (currentRemote === null) continue;

    const url = /^url\s*=\s*(.+)$/.exec(line);
    if (url?.[1] !== undefined && !remotes.has(currentRemote)) {
      remotes.set(currentRemote, url[1].trim());
    }
  }

  for (const preferred of ["upstream", "origin"] as const) {
    const url = remotes.get(preferred);
    if (url !== undefined && url.length > 0) return url;
  }
  return [...remotes.values()].find((url) => url.length > 0) ?? null;
}

/** Canonical match key for a repository, or `null` when it has no remote. */
export function canonicalKeyFromGitConfig(configText: string): string | null {
  const remoteUrl = parseGitConfigRemoteUrl(configText);
  return remoteUrl === null ? null : normalizeGitRemoteUrl(remoteUrl);
}

/**
 * Decide what happened to a workspace path, given what is on disk around it.
 *
 * Pure: every filesystem fact arrives as an argument, so the rules that decide
 * "moved" from "gone" are testable without a temp directory.
 */
export function classifyWorkspacePath(input: {
  readonly workspaceRoot: string;
  readonly exists: boolean;
  readonly canonicalKey: string | null;
  readonly siblings: readonly RelocationCandidate[];
}): WorkspacePathStatus {
  if (input.exists) return { status: "ok" };
  if (input.canonicalKey === null) {
    return { status: "missing", movedTo: null, candidates: [] };
  }

  const candidates = input.siblings
    .filter(
      (sibling) =>
        sibling.canonicalKey === input.canonicalKey &&
        NodePath.resolve(sibling.path) !== NodePath.resolve(input.workspaceRoot),
    )
    .map((sibling) => sibling.path);

  return {
    status: "missing",
    // Two directories sharing a remote is a clone, not a rename. Naming one of
    // them would be a guess, and acting on a guessed workspace path is worse
    // than admitting the ambiguity.
    movedTo: candidates.length === 1 ? (candidates[0] ?? null) : null,
    candidates,
  };
}

/** Read one directory's canonical key, or `null` if it is not a git repo. */
function readCandidate(path: string): RelocationCandidate {
  try {
    const configText = NodeFS.readFileSync(NodePath.join(path, ".git", "config"), "utf8");
    return { path, canonicalKey: canonicalKeyFromGitConfig(configText) };
  } catch {
    // Not a repository, a worktree/submodule whose `.git` is a file, or simply
    // unreadable. All three mean "cannot match", which is not an error here.
    return { path, canonicalKey: null };
  }
}

/** Sibling directories of a workspace, capped and excluding the path itself. */
function readSiblings(workspaceRoot: string): RelocationCandidate[] {
  const parent = NodePath.dirname(NodePath.resolve(workspaceRoot));
  let entries: NodeFS.Dirent[];
  try {
    entries = NodeFS.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .slice(0, MAX_SIBLINGS_SCANNED)
    .map((entry) => readCandidate(NodePath.join(parent, entry.name)));
}

/**
 * Check a workspace path against the filesystem.
 *
 * The happy path is a single `existsSync`, which is why this is safe to call
 * before every turn. The sibling scan runs only once the path is already gone.
 */
export function checkWorkspacePath(input: {
  readonly workspaceRoot: string;
  readonly canonicalKey: string | null;
}): WorkspacePathStatus {
  if (NodeFS.existsSync(input.workspaceRoot)) return { status: "ok" };
  return classifyWorkspacePath({
    workspaceRoot: input.workspaceRoot,
    exists: false,
    canonicalKey: input.canonicalKey,
    siblings: input.canonicalKey === null ? [] : readSiblings(input.workspaceRoot),
  });
}

/**
 * User-facing explanation for a missing workspace.
 *
 * Says what is wrong, what it looks like happened, and what to do — in that
 * order, because a user reading this is mid-task and wants the fix.
 */
export function describeMissingWorkspace(input: {
  readonly workspaceRoot: string;
  readonly status: Extract<WorkspacePathStatus, { status: "missing" }>;
}): string {
  const head = `The folder for this project no longer exists: '${input.workspaceRoot}'.`;
  if (input.status.movedTo !== null) {
    return `${head} It looks like it was renamed or moved to '${input.status.movedTo}' — update the project's folder to point there.`;
  }
  if (input.status.candidates.length > 1) {
    return `${head} Several folders hold the same repository (${input.status.candidates
      .map((candidate) => `'${candidate}'`)
      .join(", ")}), so pick the right one and update the project's folder.`;
  }
  return `${head} It was renamed, moved, or deleted — update the project's folder, or remove the project.`;
}
