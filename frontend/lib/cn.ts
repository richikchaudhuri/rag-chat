/** Tiny classname joiner — drops falsy values so conditional classes read cleanly.
 *  (A dependency-free stand-in for `clsx`; we don't need anything heavier.) */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
