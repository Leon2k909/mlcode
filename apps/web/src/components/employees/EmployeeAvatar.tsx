import type { ComponentType } from "react";
import {
  BinocularsIcon,
  BlocksIcon,
  BracesIcon,
  CheckCheckIcon,
  CrownIcon,
  FilePenLineIcon,
  PaletteIcon,
  SearchCodeIcon,
  ShipWheelIcon,
} from "lucide-react";

import { employeeInitials } from "../../employees";
import { cn } from "../../lib/utils";

const EMPLOYEE_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  ceo: CrownIcon,
  worker_alpha: BracesIcon,
  worker_beta: BinocularsIcon,
  worker_gamma: CheckCheckIcon,
  reviewer: SearchCodeIcon,
  architect: BlocksIcon,
  designer: PaletteIcon,
  writer: FilePenLineIcon,
  ops: ShipWheelIcon,
};

export function EmployeeAvatar(props: {
  readonly employeeId: string;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly className?: string;
}) {
  const Icon = EMPLOYEE_ICONS[props.employeeId];

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/55 text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
        props.className,
      )}
      style={
        props.accentColor ? { borderColor: props.accentColor, color: props.accentColor } : undefined
      }
    >
      {Icon ? (
        <Icon className="size-[17px]" />
      ) : (
        <span className="text-[11px] font-semibold tracking-tight">
          {employeeInitials(props.displayName)}
        </span>
      )}
    </span>
  );
}
