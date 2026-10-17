/**
 * Barrel for the shared UI kit so screens import from one place.
 *
 * The status/feedback primitives (Loading, ErrorBanner, Unavailable, NotFound,
 * EmptyState, IdentityPrompt) keep their original names/props/aria — they are now
 * reimplemented on the Tailwind primitive kit below.
 */

// Status / feedback primitives (stable public API).
export { Loading } from "./Loading";
export { ErrorBanner } from "./ErrorBanner";
export { Unavailable } from "./Unavailable";
export { NotFound } from "./NotFound";
export { EmptyState } from "./EmptyState";
export { IdentityPrompt } from "./IdentityPrompt";

// Tailwind component kit.
export { Button } from "./Button";
export { Input, Select } from "./Input";
export { Field } from "./Field";
export { Card, CardHeader, CardBody, CardTitle } from "./Card";
export { StatusPill } from "./StatusPill";
export { Skeleton } from "./Skeleton";
export { ThemeToggle } from "./ThemeToggle";
export { ToastProvider, useToast } from "./toast";
export { cn } from "./cn";
