/**
 * Agent Conductor — contract and roots-map path conventions.
 *
 * Shared by the single-file parser and the multi-root workspace loader so
 * both sides look for the same filenames.
 */

import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** Contract filenames, in search order. */
export const CONTRACT_FILENAMES = ["AGENTS.md", "CLAUDE.md", ".agents.md"] as const;

/** Roots-map filenames relative to a project directory, in search order. */
export const ROOTS_FILENAMES = [
  ".conductor/roots.json",
  ".conductor/roots",
  "conductor.roots.json",
  "conductor.roots",
] as const;

/** True when a path looks like a declared-roots map file. */
export function isRootsMapFile(filePath: string): boolean {
  const name = basename(filePath);
  return (
    name === "roots.json" ||
    name === "roots" ||
    name === "conductor.roots.json" ||
    name === "conductor.roots"
  );
}

/** First contract file under a directory, or null if none of the names exist. */
export function findContractFile(dir: string): string | null {
  for (const filename of CONTRACT_FILENAMES) {
    const candidate = join(dir, filename);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** First roots-map file under a directory, or null if none exist. */
export function findRootsFile(dir: string): string | null {
  for (const rel of ROOTS_FILENAMES) {
    const candidate = join(dir, rel);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}
