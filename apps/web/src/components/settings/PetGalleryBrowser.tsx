"use client";

import type { PetGalleryEntry, PetGallerySort } from "@t3tools/contracts";
import { CheckIcon, DownloadIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { petEnvironment } from "../../state/pets";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const SORTS: ReadonlyArray<{ readonly id: PetGallerySort; readonly label: string }> = [
  { id: "popular", label: "Popular" },
  { id: "recent", label: "Newest" },
];

function PetCard({
  pet,
  busy,
  onInstall,
  onUninstall,
}: {
  readonly pet: PetGalleryEntry;
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}) {
  // Poster first: it is a still frame and much cheaper than the animation, and a
  // grid of animated webp is exactly the kind of thing that pegs a GPU.
  const image = pet.posterUrl ?? pet.previewUrl;
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/65 bg-card/35">
      <div className="flex aspect-square items-center justify-center bg-muted/30">
        {image === null ? (
          <span className="text-xs text-muted-foreground">No preview</span>
        ) : (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <span className="truncate text-sm font-medium text-foreground">{pet.displayName}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {pet.authorName === null ? "Unknown author" : `by ${pet.authorName}`}
          {pet.likeCount > 0 ? ` · ${pet.likeCount} ♥` : ""}
        </span>
        <div className="mt-1 flex items-center justify-between gap-2">
          {pet.installed ? (
            <>
              <Badge size="sm" variant="secondary" className="gap-1">
                <CheckIcon className="size-3" />
                Installed
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onUninstall}
                className="gap-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon className="size-3.5" />
                Remove
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onInstall}
              className="ml-auto gap-1.5"
            >
              <DownloadIcon className="size-3.5" />
              Install
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Browse and install pets published on codex-pets.net.
 *
 * The client only ever names a pet id; the server resolves where that pet
 * actually lives and refuses anything off the gallery's own origin, so nothing
 * here can be pointed at another host.
 */
export function PetGalleryBrowser({
  environmentId,
  onInstalled,
}: {
  readonly environmentId: string | null;
  readonly onInstalled: () => void;
}) {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PetGallerySort>("popular");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Typing a query should not fire a request per keystroke at somebody else's
  // server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(draftSearch.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [draftSearch]);

  const input = useMemo(
    () => ({ page, sort, ...(search.length > 0 ? { search } : {}) }),
    [page, search, sort],
  );

  const gallery = useEnvironmentQuery(
    environmentId === null
      ? null
      : petEnvironment.gallery({ environmentId: environmentId as never, input }),
  );
  const install = useAtomCommand(petEnvironment.install, { reportFailure: false });
  const uninstall = useAtomCommand(petEnvironment.uninstall, { reportFailure: false });

  const run = (id: string, action: "install" | "uninstall") => {
    if (environmentId === null) return;
    setBusyId(id);
    setActionError(null);
    const command = action === "install" ? install : uninstall;
    void command({ environmentId: environmentId as never, input: { id } })
      .then((result) => {
        if (result._tag === "Success") {
          gallery.refresh();
          onInstalled();
          return;
        }
        setActionError(
          action === "install"
            ? `Could not install ${id}. It may have been removed, or the download was rejected.`
            : `Could not remove ${id}.`,
        );
      })
      .finally(() => setBusyId(null));
  };

  const pets = gallery.data?.pets ?? [];
  const totalPages = gallery.data?.totalPages ?? 0;
  const isLoading = gallery.isPending && gallery.data === null;

  return (
    <div className="space-y-3 px-3 pb-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search pets"
            className="pl-8"
            disabled={environmentId === null}
          />
        </div>
        <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border/70">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sort === option.id}
              onClick={() => {
                setSort(option.id);
                setPage(1);
              }}
              className={cn(
                "px-2.5 py-1.5 text-xs transition-colors",
                sort === option.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {actionError === null ? null : <p className="text-xs text-destructive">{actionError}</p>}

      {gallery.error !== null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Could not reach codex-pets.net. Check your connection and try again.
        </p>
      ) : isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading pets…</p>
      ) : pets.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {search.length > 0 ? `No pets match “${search}”.` : "No pets to show."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {pets.map((pet) => (
            <PetCard
              key={pet.id}
              pet={pet}
              busy={busyId === pet.id}
              onInstall={() => run(pet.id, "install")}
              onUninstall={() => run(pet.id, "uninstall")}
            />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
