/**
 * cn — tiny className combiner.
 *
 * Joins truthy class fragments with a space. Kept dependency-free (no clsx/twMerge)
 * since the component kit uses straightforward, non-conflicting Tailwind classes.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
