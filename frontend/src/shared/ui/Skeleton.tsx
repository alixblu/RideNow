/**
 * Skeleton — a shimmering placeholder block for loading states.
 *
 * Reserve layout while content loads: give it the height/width (and radius, for
 * avatars or pills) of the final content via className so the placeholder has the
 * shape of what will replace it (Req 3.7).
 */
import { cn } from "./cn";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-xl bg-surface-raised",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:animate-shimmer motion-reduce:before:animate-none before:bg-gradient-to-r",
        "before:from-transparent before:via-content/10 before:to-transparent",
        className,
      )}
    />
  );
}
