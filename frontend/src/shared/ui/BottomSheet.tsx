/**
 * BottomSheet — a panel anchored to the bottom of its (relatively positioned)
 * container, typically the phone column over a full-bleed map.
 *
 * Snap points: peek | half | full. A drag-handle button cycles peek -> half -> full ->
 * peek, so the sheet is fully keyboard accessible. Works controlled (`snap` +
 * `onSnapChange`) or uncontrolled (`defaultSnap`).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type SheetSnap = "peek" | "half" | "full";

const ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

const HEIGHT: Record<SheetSnap, string> = {
  peek: "max-h-[30%]",
  half: "max-h-[55%]",
  full: "max-h-[90%]",
};

export function nextSnap(snap: SheetSnap): SheetSnap {
  return ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]!;
}

interface BottomSheetProps {
  /** Accessible name of the sheet landmark. */
  label: string;
  snap?: SheetSnap;
  defaultSnap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  children: ReactNode;
  className?: string;
}

export function BottomSheet({
  label,
  snap,
  defaultSnap = "half",
  onSnapChange,
  children,
  className,
}: BottomSheetProps) {
  const [internal, setInternal] = useState<SheetSnap>(defaultSnap);
  const current = snap ?? internal;

  const cycle = () => {
    const next = nextSnap(current);
    if (snap === undefined) setInternal(next);
    onSnapChange?.(next);
  };

  return (
    <section
      aria-label={label}
      data-snap={current}
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden",
        "rounded-t-3xl bg-surface shadow-sheet transition-[max-height] duration-200",
        HEIGHT[current],
        className,
      )}
    >
      <button
        type="button"
        onClick={cycle}
        aria-label={`Resize panel (currently ${current})`}
        className="flex min-h-11 w-full shrink-0 items-center justify-center"
      >
        <span className="h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
    </section>
  );
}
