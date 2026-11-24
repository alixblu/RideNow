/**
 * PhoneColumn — constrains app content to a centered phone-width column.
 * Full width on mobile viewports, max 480 px and centered on wider ones.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/cn";

interface PhoneColumnProps {
  children: ReactNode;
  className?: string;
}

export function PhoneColumn({ children, className }: PhoneColumnProps) {
  return (
    <div
      data-testid="phone-column"
      className={cn(
        "relative mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
