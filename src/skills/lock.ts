/**
 * Agent Conductor — skills-lock integrity verification.
 *
 * A project may pin the skills it trusts in a `skills-lock.json` at the
 * project root. When that lockfile is present, loading a skill's body is
 * fail-closed: the SKILL.md bytes are hashed (SHA-256) and compared
 * against the pinned digest, and any drift — tampered file, missing
 * entry, stale hash — refuses the load with a typed error naming the
 * skill and both digests. Discovery (frontmatter only) stays unverified:
 * the threat boundary is the moment skill *content* enters the agent.
 *
 * Lock format (version 1):
 *
 * ```json
 * {
 *   "version": 1,
 *   "skills": {
 *     "pipeline-scoring": {
 *       "path": ".conductor/skills/pipeline-scoring/SKILL.md",
 *       "sha256": "<hex digest of the SKILL.md bytes>"
 *     }
 *   }
 * }
 * ```
 *
 * No lockfile → verification is disabled (documented posture; projects
 * opt in by committing a lock). Hashing is over raw file bytes so any
 * byte of drift is caught.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { SkillMetadata } from "./types.ts";

export const SKILLS_LOCK_FILENAME = "skills-lock.json";

/** Error thrown when a skill fails lock verification. Fail-closed by design. */
export class SkillLockError extends Error {
  readonly skill: string;
  readonly reason: string;

  constructor(skill: string, reason: string) {
    super(`skills-lock verification failed for "${skill}": ${reason}`);
    this.name = "SkillLockError";
    this.skill = skill;
    this.reason = reason;
  }
}

export interface SkillLockEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface SkillsLock {
  readonly version: number;
  readonly skills: Record<string, SkillLockEntry>;
}

/** Read and shape-check `skills-lock.json` under `projectRoot`; null when absent. */
export function loadSkillsLock(projectRoot: string): SkillsLock | null {
  const lockPath = join(projectRoot, SKILLS_LOCK_FILENAME);
  if (!existsSync(lockPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    throw new SkillLockError(
      SKILLS_LOCK_FILENAME,
      `lockfile is not valid JSON (${(error as Error).message})`,
    );
  }
  const lock = parsed as Partial<SkillsLock> | null;
  if (!lock || lock.version !== 1 || typeof lock.skills !== "object" || lock.skills === null) {
    throw new SkillLockError(
      SKILLS_LOCK_FILENAME,
      'lockfile must be {"version": 1, "skills": {name: {path, sha256}}}',
    );
  }
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      throw new SkillLockError(
        name,
        'entry must carry {"path": string, "sha256": 64-hex lowercase digest}',
      );
    }
  }
  return { version: 1, skills: lock.skills };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Verify `metadata` against `lock`. `projectRoot` is the root the skill was
 * discovered from — lock paths are resolved relative to it. Missing entry or
 * digest mismatch throws `SkillLockError`; a matching digest returns quietly.
 */
export function verifySkillAgainstLock(
  metadata: SkillMetadata,
  lock: SkillsLock,
  projectRoot: string,
): void {
  const entry = lock.skills[metadata.name];
  if (!entry) {
    throw new SkillLockError(
      metadata.name,
      "no lock entry — every skill loaded under a lockfile must be pinned",
    );
  }
  if (isAbsolute(entry.path)) {
    throw new SkillLockError(metadata.name, "lock paths must be relative to the project root");
  }
  const lockPathAbs = resolve(projectRoot, entry.path);
  const actualAbs = resolve(metadata.path);
  if (
    lockPathAbs !== actualAbs &&
    relative(projectRoot, lockPathAbs) !== relative(projectRoot, actualAbs)
  ) {
    throw new SkillLockError(
      metadata.name,
      `locked path ${entry.path} does not resolve to the discovered skill at ${metadata.path}`,
    );
  }
  if (!existsSync(lockPathAbs)) {
    throw new SkillLockError(metadata.name, `locked file is missing: ${entry.path}`);
  }
  const actual = sha256File(lockPathAbs);
  if (actual !== entry.sha256) {
    throw new SkillLockError(
      metadata.name,
      `sha256 mismatch: locked ${entry.sha256.slice(0, 12)}…, actual ${actual.slice(0, 12)}…`,
    );
  }
}

/** Compute the lock entry for one discovered skill (the lockfile authoring half). */
export function computeLockEntry(metadata: SkillMetadata, projectRoot: string): SkillLockEntry {
  return {
    path: relative(projectRoot, metadata.path).split("\\").join("/") || basename(metadata.path),
    sha256: sha256File(metadata.path),
  };
}
