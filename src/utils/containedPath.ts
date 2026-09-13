/**
 * Agent Conductor — confine user-supplied paths to an allowed directory.
 *
 * SAST (Aikido) flags resolve() + fs reads on caller-controlled strings as
 * relative path traversal / file inclusion. Resolve first, then reject
 * anything that lands outside the base (default: process.cwd()).
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

/** True when `candidate` is `base` or a path inside it (after resolve). */
export function isInside(base: string, candidate: string): boolean {
  const root = resolve(base);
  const resolved = resolve(candidate);
  const rel = relative(root, resolved);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve `userPath` against `base` and throw if the result escapes `base`.
 * Absolute inputs are allowed only when they still resolve inside `base`.
 */
export function resolveContained(userPath: string, base: string = process.cwd()): string {
  const root = resolve(base);
  const resolved = resolve(root, userPath);
  if (!isInside(root, resolved)) {
    throw new Error(`Path is outside the allowed directory: ${userPath}`);
  }
  return resolved;
}

/** Throw unless `candidate` (already resolved or not) stays under `base`. */
export function assertContained(candidate: string, base: string = process.cwd()): string {
  const resolved = resolve(candidate);
  if (!isInside(base, resolved)) {
    throw new Error(`Path is outside the allowed directory: ${candidate}`);
  }
  return resolved;
}
