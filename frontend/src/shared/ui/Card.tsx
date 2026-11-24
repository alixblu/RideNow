/**
 * Card — a rounded (16 px minimum), softly elevated surface that groups content.
 *
 * No hairline border: separation comes from the surface color and `shadow-card`.
 * `CardHeader`/`CardTitle`/`CardBody` are light helpers for consistent spacing.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn("rounded-2xl bg-surface shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn("px-5 pt-5 pb-3", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn("px-5 pb-5", className)} {...rest}>
      {children}
    </div>
  );
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

export function CardTitle({ className, children, ...rest }: CardTitleProps) {
  return (
    <h3 className={cn("text-lg font-bold text-content", className)} {...rest}>
      {children}
    </h3>
  );
}
