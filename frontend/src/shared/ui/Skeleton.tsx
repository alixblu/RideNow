/**
 * Skeleton — a shimmering placeholder block for loading states.
 *
 * Use it to reserve layout while content loads. Size via className (height/width).
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
        "relative overflow-hidden rounded-lg bg-surface-raised",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:animate-shimmer before:bg-gradient-to-r",
        "before:from-transparent before:via-content/10 before:to-transparent",
        className,
      )}
    />
  );
}
