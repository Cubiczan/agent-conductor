import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract/parser.ts";
import { parseRootsFile, resolveDeclaredRoots } from "../src/contract/roots.ts";
import { loadWorkspace } from "../src/contract/workspace.ts";
import { discoverSkills, discoverSkillsFromRoots } from "../src/skills/loader.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PULSE = join(REPO, "examples", "pipeline-pulse");
const PULSE_AGENTS = join(PULSE, "AGENTS.md");
const MULTI = join(REPO, "examples", "multimodule");
const MULTI_ROOTS = join(MULTI, "conductor.roots.json");

test("parses JSON object, JSON array, and line-oriented roots maps", () => {
  const objectForm = parseRootsFile(
    JSON.stringify({ roots: [{ id: "billing", path: "modules/billing" }, { path: "shared" }] }),
    "object",
  );
  assert.deepEqual(objectForm, [
    { id: "billing", path: "modules/billing" },
    { path: "shared" },
  ]);

  const arrayForm = parseRootsFile('[".", "shared"]', "array");
  assert.deepEqual(arrayForm, [{ path: "." }, { path: "shared" }]);

  const textForm = parseRootsFile("# comment\nworkspace: .\nbilling = modules/billing\nshared\n", "text");
  assert.deepEqual(textForm, [
    { id: "workspace", path: "." },
    { id: "billing", path: "modules/billing" },
    { path: "shared" },
  ]);
});

test("fails closed when a declared root or roots map is missing", () => {
  assert.throws(
    () => resolveDeclaredRoots({ roots: [MULTI, join(MULTI, "no-such-module")], base: MULTI }),
    /missing/i,
  );
  assert.throws(
    () => resolveDeclaredRoots({ rootsFile: join(MULTI, "does-not-exist.roots.json") }),
    /missing/i,
  );
  assert.throws(() => parseRootsFile("{}\n", "empty-object"), /must be an array/i);
  assert.throws(() => parseRootsFile('{"roots":[]}', "empty-roots"), /declares no roots/i);
});

test("fails closed when a declared root is a file rather than a directory", () => {
  assert.throws(
    () => resolveDeclaredRoots({ roots: [MULTI_ROOTS], base: MULTI }),
    /not a directory/i,
  );
});

test("compiles one contract with merged layer table and verification commands", () => {
  const contract = loadWorkspace({ path: MULTI });

  assert.match(contract.source, /conductor\.roots\.json$/);
  assert.equal(contract.title, "AGENTS.md — Multi-module workspace");
  assert.match(contract.mission, /billing product/i);
  assert.match(contract.mission, /\*\*billing:\*\*/);
  assert.ok(contract.rules.some((rule) => /Deterministic invoices/.test(rule)));
  assert.ok(contract.roots);

  const layerNames = contract.layers.map((layer) => layer.layer);
  assert.ok(layerNames.includes("modules/billing"));
  assert.ok(layerNames.includes("shared"));
  assert.ok(layerNames.includes("modules/billing/src"));
  assert.ok(contract.layers.some((layer) => layer.root === "workspace"));
  assert.ok(contract.layers.some((layer) => layer.root === "billing"));

  const commands = contract.gates.flatMap((gate) => gate.commands);
  assert.ok(commands.includes("npm test"));
  assert.ok(commands.includes("npm -C modules/billing test"));
  assert.ok(contract.gates.some((gate) => gate.root === "workspace"));
  assert.ok(contract.gates.some((gate) => gate.root === "billing"));

  const shared = contract.roots?.find((root) => root.id === "shared");
  assert.ok(shared);
  assert.equal(shared.contractPath, null);
});

test("discovers SKILL.md outside the module directory", () => {
  const moduleOnly = discoverSkills(join(MULTI, "modules", "billing"));
  assert.equal(
    moduleOnly.find((skill) => skill.name === "shared-ledger"),
    undefined,
    "a module-only walk must not see skills on the extra source root",
  );

  const workspace = loadWorkspace({ path: MULTI });
  const roots = (workspace.roots ?? []).map((root) => root.resolved);
  const skills = discoverSkillsFromRoots(roots);
  const ledger = skills.find((skill) => skill.name === "shared-ledger");
  assert.ok(ledger, "shared-ledger should be discovered from the extra source root");
  assert.equal(ledger.scope, "project");
  assert.match(ledger.path, /shared[/\\]\.conductor[/\\]skills[/\\]shared-ledger[/\\]SKILL.md$/);
  assert.ok(!("body" in ledger), "discovery must not load the body");
});

test("accepts an explicit roots list and a roots map file", () => {
  const fromFile = loadWorkspace({ rootsFile: MULTI_ROOTS });
  const fromList = loadWorkspace({
    path: MULTI,
    roots: [".", "modules/billing", "shared"],
  });
  assert.deepEqual(
    fromFile.layers.map((layer) => layer.layer),
    fromList.layers.map((layer) => layer.layer),
  );
  assert.deepEqual(
    fromFile.gates.flatMap((gate) => gate.commands),
    fromList.gates.flatMap((gate) => gate.commands),
  );
});

test("pipeline-pulse single-root compile is unchanged", () => {
  const direct = loadContract(PULSE_AGENTS);
  const viaWorkspaceFile = loadWorkspace({ path: PULSE_AGENTS });
  const viaWorkspaceDir = loadWorkspace({ path: PULSE });

  assert.deepEqual(viaWorkspaceFile, direct);
  assert.equal(viaWorkspaceDir.title, direct.title);
  assert.deepEqual(viaWorkspaceDir.rules, direct.rules);
  assert.deepEqual(viaWorkspaceDir.layers, direct.layers);
  assert.deepEqual(viaWorkspaceDir.gates, direct.gates);
  assert.deepEqual(viaWorkspaceDir.skills, direct.skills);
  assert.equal(viaWorkspaceDir.roots, undefined);

  const skills = discoverSkills(PULSE);
  assert.ok(skills.some((skill) => skill.name === "pipeline-scoring"));
  assert.equal(
    skills.find((skill) => skill.name === "shared-ledger"),
    undefined,
  );
});

test("empty roots map text fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "conductor-roots-"));
  const map = join(dir, "conductor.roots");
  writeFileSync(map, "# only comments\n\n");
  assert.throws(() => resolveDeclaredRoots({ rootsFile: map }), /declares no roots/i);
});
