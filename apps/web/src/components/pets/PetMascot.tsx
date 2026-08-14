import { usePetSelection, usePrimaryPetCatalog } from "../../pets";
import { isElectron } from "../../env";
import { PetSprite } from "./PetSprite";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const PET_POSITION_KEY = "t3code:pet-position:v1";
const PET_SIZE = 104;
const EDGE_GAP = 12;
const isDesktopOverlay =
  isElectron && new URLSearchParams(window.location.search).get("pet-overlay") === "1";

type Position = { x: number; y: number };

function clampPosition(position: Position): Position {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(
      Math.max(EDGE_GAP, position.x),
      Math.max(EDGE_GAP, window.innerWidth - PET_SIZE - EDGE_GAP),
    ),
    y: Math.min(
      Math.max(EDGE_GAP, position.y),
      Math.max(EDGE_GAP, window.innerHeight - PET_SIZE - EDGE_GAP),
    ),
  };
}

function defaultPosition(): Position {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return clampPosition({
    x: window.innerWidth - PET_SIZE - 24,
    y: window.innerHeight - PET_SIZE - 20,
  });
}

function storedPosition(): Position {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PET_POSITION_KEY) ?? "null",
    ) as Partial<Position> | null;
    if (typeof parsed?.x === "number" && typeof parsed.y === "number")
      return clampPosition(parsed as Position);
  } catch {
    // Ignore malformed or unavailable local storage.
  }
  return defaultPosition();
}

export function PetMascot() {
  const { environmentId, catalog } = usePrimaryPetCatalog();
  const { selectedPet } = usePetSelection(environmentId, catalog);
  const [position, setPosition] = useState<Position>(storedPosition);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const onResize = () => setPosition((current) => clampPosition(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (environmentId === null || selectedPet === null) return null;
  if (isElectron && !isDesktopOverlay) return null;

  const updatePosition = (next: Position) => {
    const clamped = clampPosition(next);
    setPosition(clamped);
    try {
      window.localStorage.setItem(PET_POSITION_KEY, JSON.stringify(clamped));
    } catch {
      // Persistence is best effort.
    }
  };

  return (
    <div
      className={`fixed z-30 cursor-grab touch-none select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.22)] active:cursor-grabbing ${isDesktopOverlay ? "block" : "hidden lg:block"}`}
      data-pet-mascot={selectedPet.key}
      style={
        isDesktopOverlay
          ? ({ left: EDGE_GAP, top: EDGE_GAP, WebkitAppRegion: "drag" } as CSSProperties)
          : { left: position.x, top: position.y }
      }
      onPointerDown={(event) => {
        if (isDesktopOverlay) return;
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
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (isDesktopOverlay) return;
        drag.current = null;
      }}
    >
      <PetSprite environmentId={environmentId} pet={selectedPet} animate size={PET_SIZE} />
    </div>
  );
}
