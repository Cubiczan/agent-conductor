import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { runVerify } from "../src/cli.ts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "pipeline-pulse",
  "AGENTS.md",
);

test("runVerify compiles a real contract fixture and exits 0", () => {
  const lines: string[] = [];
  const code = runVerify([FIXTURE], (l) => lines.push(l));
  assert.equal(code, 0);
  const out = lines.join("\n");
  assert.match(out, /compiled/);
  assert.match(out, /gates:\s+\d+/);
});

test("runVerify fails closed on a missing contract file", () => {
  const lines: string[] = [];
  const code = runVerify([join(tmpdir(), "does-not-exist-AGENTS.md")], (l) => lines.push(l));
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /not found/);
});

test("runVerify --require-gates refuses a contract with no gates", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-cli-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root); // loadContract is workspace-contained: verify from inside the root
    // Minimal contract: mission present, no verification-gate section.
    const path = join(root, "AGENTS.md");
    writeFileSync(path, "# AGENTS.md — Minimal\n\n## Mission\n\nDo the thing carefully.\n");
    const lines: string[] = [];
    const code = runVerify(["--require-gates", path], (l) => lines.push(l));
    assert.equal(code, 1);
    assert.match(lines.join("\n"), /no verification gates/);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("runVerify --run-gates executes declared commands and fails on gate failure", () => {
  const root = mkdtempSync(join(tmpdir(), "aconductor-cli-gates-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root); // loadContract is workspace-contained: verify from inside the root
    const passing = join(root, "PASSING.md");
    writeFileSync(
      passing,
      [
        "# AGENTS.md — Gates",
        "",
        "## Mission",
        "",
        "Run gates.",
        "",
        "## Verification checklist",
        "",
        "```bash",
        'node -e "process.exit(0)"',
        "```",
        "",
      ].join("\n"),
    );
    const lines: string[] = [];
    assert.equal(runVerify(["--run-gates", passing], (l) => lines.push(l)), 0);
    assert.match(lines.join("\n"), /all gate commands passed/);

    const failing = join(root, "FAILING.md");
    writeFileSync(
      failing,
      [
        "# AGENTS.md — Gates",
        "",
        "## Mission",
        "",
        "Run gates.",
        "",
        "## Verification checklist",
        "",
        "```bash",
        'node -e "process.exit(3)"',
        "```",
        "",
      ].join("\n"),
    );
    const failLines: string[] = [];
    assert.equal(runVerify(["--run-gates", failing], (l) => failLines.push(l)), 1);
    assert.match(failLines.join("\n"), /gate command failed/);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
