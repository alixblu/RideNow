/**
 * Barrel for the shared UI kit so screens import from one place.

 */

// Status / feedback primitives (stable public API).
export { Loading } from "./Loading";
export { EmptyState } from "./EmptyState";

// Tailwind component kit.
export { Button } from "./Button";
export { Input, Select } from "./Input";
export { Field } from "./Field";
export { Card, CardHeader, CardBody, CardTitle } from "./Card";
export { Skeleton } from "./Skeleton";
export { BottomSheet, nextSnap } from "./BottomSheet";
export type { SheetSnap } from "./BottomSheet";
export { Badge, toneForStatus } from "./Badge";
export type { BadgeTone } from "./Badge";
export { Avatar, initialsOf, avatarColor } from "./Avatar";
export { ErrorState } from "./ErrorState";
export { ThemeToggle } from "./ThemeToggle";
export { ToastProvider, useToast } from "./toast";
export { cn } from "./cn";
export { MOTION_DURATION, MOTION_EASE, prefersReducedMotion, motionDuration } from "./motion";
