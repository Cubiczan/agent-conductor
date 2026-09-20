import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  SKILLS_LOCK_FILENAME,
  SkillLockError,
  computeLockEntry,
  loadSkillsLock,
  verifySkillAgainstLock,
} from "../src/skills/lock.ts";
import { discoverSkills, loadSkill } from "../src/skills/loader.ts";
import type { SkillMetadata } from "../src/skills/types.ts";

function makeSkill(root: string, name: string, body: string): SkillMetadata {
  const dir = join(root, ".conductor", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`);
  return {
    name,
    description: `${name} skill`,
    version: "0.0.0",
    tools: [],
    scope: "project",
    path: join(dir, "SKILL.md"),
  };
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("loadSkillsLock: absent lockfile -> null (verification opt-in)", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-lock-"));
  try {
    assert.equal(loadSkillsLock(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSkillsLock: malformed or wrong-version lockfile fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-lock-"));
  try {
    writeFileSync(join(root, SKILLS_LOCK_FILENAME), "{ not json");
    assert.throws(() => loadSkillsLock(root), SkillLockError);

    writeFileSync(
      join(root, SKILLS_LOCK_FILENAME),
      JSON.stringify({ version: 2, skills: {} }),
    );
    assert.throws(() => loadSkillsLock(root), SkillLockError);

    writeFileSync(
      join(root, SKILLS_LOCK_FILENAME),
      JSON.stringify({ version: 1, skills: { s: { path: "x", sha256: "nothex" } } }),
    );
    assert.throws(() => loadSkillsLock(root), SkillLockError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifySkillAgainstLock: missing entry, digest drift, and missing file all refuse", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-lock-"));
  try {
    const meta = makeSkill(root, "pinned-skill", "hello");
    const lock = {
      version: 1,
      skills: {
        "pinned-skill": {
          path: ".conductor/skills/pinned-skill/SKILL.md",
          sha256: digest(meta.path),
        },
      },
    };
    // Pinned and untampered: quiet pass.
    verifySkillAgainstLock(meta, lock, root);

    // Digest drift (tampered bytes) refuses.
    writeFileSync(meta.path, "hello-tampered");
    assert.throws(() => verifySkillAgainstLock(meta, lock, root), SkillLockError);
    writeFileSync(meta.path, "hello");

    // Missing lock entry refuses even when the file is clean.
    const { "pinned-skill": _drop, ...empty } = lock;
    assert.throws(() => verifySkillAgainstLock(meta, empty, root), SkillLockError);

    // Locked file missing on disk refuses.
    rmSync(meta.path);
    assert.throws(() => verifySkillAgainstLock(meta, lock, root), SkillLockError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSkill end-to-end: pinned skill loads; tampered skill refuses", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-lock-e2e-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const meta = makeSkill(root, "e2e-skill", "safe body");
    const lock = {
      version: 1,
      skills: { "e2e-skill": computeLockEntry(meta, root) },
    };
    writeFileSync(join(root, SKILLS_LOCK_FILENAME), JSON.stringify(lock, null, 2));

    const loaded = loadSkill(meta);
    assert.match(loaded.body, /safe body/);

    // Tamper after pinning: the body must not load.
    writeFileSync(meta.path, "injected instructions");
    assert.throws(() => loadSkill(meta), SkillLockError);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverSkills still works without a lockfile (progressive disclosure unchanged)", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-lock-disc-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root); // discovery is workspace-contained: run from inside the root
    makeSkill(root, "plain-skill", "body");
    const found = discoverSkills(root);
    assert.equal(found.filter((s) => s.name === "plain-skill").length, 1);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
