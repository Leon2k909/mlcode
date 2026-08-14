import type { ContextMenuItem } from "@t3tools/contracts";

import { usePetSelection, usePrimaryPetCatalog } from "../../pets";
import { isElectron } from "../../env";
import { ensureLocalApi } from "../../localApi";
import { PetSprite } from "./PetSprite";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

const PET_POSITION_KEY = "t3code:pet-position:v1";
const PET_SIZE_KEY = "t3code:pet-size:v1";
const PET_SIZE_DEFAULT = 104;
const PET_SIZE_OPTIONS = [
  { label: "Small (80px)", value: 80 },
  { label: "Default (104px)", value: PET_SIZE_DEFAULT },
  { label: "Large (128px)", value: 128 },
] as const;
const PET_OVERLAY_SIZE = 128;
const EDGE_GAP = 12;
const isDesktopOverlay =
  isElectron && new URLSearchParams(window.location.search).get("pet-overlay") === "1";

type Position = { x: number; y: number };
type PetContextMenuAction =
  | "resize"
  | "resize-small"
  | "resize-default"
  | "resize-large"
  | "reset-position"
  | "close";

const PET_CONTEXT_MENU_ITEMS: readonly ContextMenuItem<PetContextMenuAction>[] = [
  {
    id: "resize",
    label: "Resize",
    children: [
      { id: "resize-small", label: PET_SIZE_OPTIONS[0].label },
      { id: "resize-default", label: PET_SIZE_OPTIONS[1].label },
      { id: "resize-large", label: PET_SIZE_OPTIONS[2].label },
    ],
  },
  { id: "reset-position", label: "Reset position" },
  { id: "close", label: "Close pet", destructive: true },
];

function storedPetSize(): number {
  try {
    const stored = Number(window.localStorage.getItem(PET_SIZE_KEY));
    if (PET_SIZE_OPTIONS.some((option) => option.value === stored)) return stored;
  } catch {
    // Ignore malformed or unavailable local storage.
  }
  return PET_SIZE_DEFAULT;
}

function clampPosition(position: Position, size: number): Position {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(
      Math.max(EDGE_GAP, position.x),
      Math.max(EDGE_GAP, window.innerWidth - size - EDGE_GAP),
    ),
    y: Math.min(
      Math.max(EDGE_GAP, position.y),
      Math.max(EDGE_GAP, window.innerHeight - size - EDGE_GAP),
    ),
  };
}

function defaultPosition(size: number): Position {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return clampPosition(
    {
      x: window.innerWidth - size - 24,
      y: window.innerHeight - size - 20,
    },
    size,
  );
}

function storedPosition(size: number): Position {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PET_POSITION_KEY) ?? "null",
    ) as Partial<Position> | null;
    if (typeof parsed?.x === "number" && typeof parsed.y === "number")
      return clampPosition(parsed as Position, size);
  } catch {
    // Ignore malformed or unavailable local storage.
  }
  return defaultPosition(size);
}

export function PetMascot() {
  const { environmentId, catalog } = usePrimaryPetCatalog();
  const { selectedPet, setSelectedKey } = usePetSelection(environmentId, catalog);
  const initialPetSize = storedPetSize();
  const [petSize, setPetSize] = useState(initialPetSize);
  const [position, setPosition] = useState<Position>(() => storedPosition(initialPetSize));
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const onResize = () => setPosition((current) => clampPosition(current, petSize));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [petSize]);

  if (environmentId === null || selectedPet === null) return null;
  if (isElectron && !isDesktopOverlay) return null;

  const updatePosition = (next: Position, size = petSize) => {
    const clamped = clampPosition(next, size);
    setPosition(clamped);
    try {
      window.localStorage.setItem(PET_POSITION_KEY, JSON.stringify(clamped));
    } catch {
      // Persistence is best effort.
    }
  };

  const resizePet = (nextSize: number) => {
    const clampedSize = PET_SIZE_OPTIONS.some((option) => option.value === nextSize)
      ? nextSize
      : PET_SIZE_DEFAULT;
    const nextPosition = clampPosition(position, clampedSize);
    setPetSize(clampedSize);
    setPosition(nextPosition);
    try {
      window.localStorage.setItem(PET_SIZE_KEY, String(clampedSize));
      window.localStorage.setItem(PET_POSITION_KEY, JSON.stringify(nextPosition));
    } catch {
      // Persistence is best effort.
    }
  };

  const resetPosition = () => updatePosition(defaultPosition(petSize));
  const overlayInset = Math.max(0, (PET_OVERLAY_SIZE - petSize) / 2);
  const contextMenuItems = isDesktopOverlay
    ? PET_CONTEXT_MENU_ITEMS.filter((item) => item.id !== "reset-position")
    : PET_CONTEXT_MENU_ITEMS;

  const openContextMenu = async (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position = { x: event.clientX, y: event.clientY };
    try {
      // Native Electron menus use the current pointer when no page-relative
      // position is supplied. The pet lives in its own transparent window, so
      // passing renderer coordinates would anchor the menu to the main window.
      const action = await ensureLocalApi().contextMenu.show(
        contextMenuItems,
        isElectron ? undefined : position,
      );
      switch (action) {
        case "resize-small":
          resizePet(80);
          break;
        case "resize-default":
          resizePet(PET_SIZE_DEFAULT);
          break;
        case "resize-large":
          resizePet(128);
          break;
        case "reset-position":
          resetPosition();
          break;
        case "close":
          setSelectedKey(null);
          break;
      }
    } catch (error) {
      console.error("Could not open the pet context menu.", error);
    }
  };

  return (
    <div
      className={`fixed z-30 cursor-grab touch-none select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.22)] active:cursor-grabbing ${isDesktopOverlay ? "block" : "hidden lg:block"}`}
      data-pet-mascot={selectedPet.key}
      style={
        isDesktopOverlay
          ? ({
              left: overlayInset,
              top: overlayInset,
              WebkitAppRegion: "no-drag",
            } as CSSProperties)
          : { left: position.x, top: position.y }
      }
      onContextMenu={(event) => void openContextMenu(event)}
      onPointerDown={(event) => {
        if (isDesktopOverlay) return;
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - position.x,
          offsetY: event.clientY - position.y,
        };
      }}
      onPointerMove={(event) => {
        if (isDesktopOverlay) return;
        if (drag.current?.pointerId !== event.pointerId) return;
        updatePosition({
          x: event.clientX - drag.current.offsetX,
          y: event.clientY - drag.current.offsetY,
        });
      }}
      onPointerUp={(event) => {
        if (isDesktopOverlay) return;
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        if (isDesktopOverlay) return;
        drag.current = null;
      }}
    >
      <PetSprite environmentId={environmentId} pet={selectedPet} animate size={petSize} />
    </div>
  );
}
