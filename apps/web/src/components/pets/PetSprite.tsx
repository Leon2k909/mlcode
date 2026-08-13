import type { EnvironmentId, PetCatalogEntry } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { useAssetUrl } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";

function animationForPet(pet: PetCatalogEntry, animationId: string) {
  return (
    pet.animations.find((animation) => animation.id === animationId) ??
    pet.animations.find((animation) => animation.id === "idle") ??
    pet.animations[0] ?? { id: "idle", frames: [0], fps: 3, loop: true }
  );
}

export function PetSprite({
  environmentId,
  pet,
  animationId = "idle",
  animate = false,
  size = 96,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly pet: PetCatalogEntry;
  readonly animationId?: string;
  readonly animate?: boolean;
  readonly size?: number;
  readonly className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resource = useMemo(() => ({ _tag: "pet-spritesheet" as const, key: pet.key }), [pet.key]);
  const spritesheetUrl = useAssetUrl(environmentId, resource);
  const animation = animationForPet(pet, animationId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || spritesheetUrl === null) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const image = new Image();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frameCursor = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = animation.frames.length > 0 ? animation.frames : [0];
    const frameIntervalMs = Math.max(1000 / Math.min(animation.fps, 60), 16);

    const draw = () => {
      if (cancelled || document.hidden) return;
      const frameIndex = frames[frameCursor % frames.length] ?? 0;
      const sourceX = (frameIndex % pet.frame.columns) * pet.frame.width;
      const sourceY = Math.floor(frameIndex / pet.frame.columns) * pet.frame.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const outputSize = Math.round(size * pixelRatio);
      if (canvas.width !== outputSize || canvas.height !== outputSize) {
        canvas.width = outputSize;
        canvas.height = outputSize;
      }
      context.clearRect(0, 0, outputSize, outputSize);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        pet.frame.width,
        pet.frame.height,
        0,
        0,
        outputSize,
        outputSize,
      );
      frameCursor = (frameCursor + 1) % frames.length;
    };

    const schedule = () => {
      if (cancelled || document.hidden || reducedMotion || !animate || frames.length <= 1) return;
      timer = setTimeout(() => {
        draw();
        schedule();
      }, frameIntervalMs);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      draw();
      schedule();
    };
    image.onload = () => {
      if (cancelled) return;
      draw();
      schedule();
    };
    image.src = spritesheetUrl;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      image.onload = null;
    };
  }, [animate, animation.fps, animation.frames, pet.frame, size, spritesheetUrl]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("block shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${pet.displayName} pet`}
    />
  );
}
