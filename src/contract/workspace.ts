/**
 * Agent Conductor — multi-root workspace contract loader.
 *
 * Walks declared roots (inline list or map file), compiles each AGENTS.md
 * it finds, and emits one AgentContract whose layer table and verification
 * gates are the concatenation of every root. Skill-only extra roots are
 * allowed; a declared root that is missing from the filesystem is not.
 *
 * Single-root callers — a path to an AGENTS.md file, or a directory with
 * no roots map — keep the existing compileContract / loadContract shape.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTRACT_FILENAMES, findContractFile, findRootsFile, isRootsMapFile } from "./paths.ts";
import { loadContract } from "./parser.ts";
import { type DeclaredRoot, resolveDeclaredRoots } from "./roots.ts";
import type { AgentContract, WorkspaceRoot } from "./types.ts";

/** Inputs accepted by the workspace loader and the MCP contract tools. */
export interface WorkspaceInput {
  /** AGENTS.md file, project directory, or a roots map file. */
  readonly path?: string;
  /** Explicit list of roots (relative paths resolve against `path` or cwd). */
  readonly roots?: readonly string[];
  /** Path to a JSON or line-oriented roots map. */
  readonly rootsFile?: string;
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Merge compiled contracts from several roots into one lossless contract. */
export function mergeContracts(
  loaded: Array<{ root: DeclaredRoot; contract: AgentContract }>,
): Omit<AgentContract, "source" | "roots"> {
  const first = loaded[0]?.contract;
  if (!first) {
    throw new Error("mergeContracts requires at least one compiled contract");
  }

  const withMission = loaded.filter((item) => item.contract.mission.trim() !== "");
  const mission =
    withMission.length <= 1
      ? (withMission[0]?.contract.mission ?? "")
      : withMission
          .map((item) => `**${item.root.id}:** ${item.contract.mission}`)
          .join("\n\n");

  const skillSeen = new Set<string>();
  const skills: AgentContract["skills"] = [];
  for (const { contract } of loaded) {
    for (const skill of contract.skills) {
      if (skillSeen.has(skill.skill)) continue;
      skillSeen.add(skill.skill);
      skills.push(skill);
    }
  }

  return {
    title: first.title,
    mission,
    rules: uniqueStrings(loaded.flatMap((item) => item.contract.rules)),
    layers: loaded.flatMap((item) =>
      item.contract.layers.map((layer) => ({ ...layer, root: item.root.id })),
    ),
    gates: loaded.flatMap((item) =>
      item.contract.gates.map((gate) => ({ ...gate, root: item.root.id })),
    ),
    skills,
    outOfScope: uniqueStrings(loaded.flatMap((item) => item.contract.outOfScope)),
    sections: loaded.flatMap((item) => item.contract.sections),
  };
}

/**
 * Resolve the workspace's declared roots without compiling contracts.
 * Used by skill discovery so extra source roots (outside a module dir)
 * are walked with the same fail-closed rules.
 */
export function resolveWorkspaceRoots(input: WorkspaceInput = {}): DeclaredRoot[] {
  const pathArg = input.path ? resolve(input.path) : undefined;

  if (input.roots && input.roots.length > 0) {
    const base = directoryBase(pathArg);
    return resolveDeclaredRoots({ roots: input.roots, base });
  }

  if (input.rootsFile) {
    return resolveDeclaredRoots({ rootsFile: resolve(input.rootsFile) });
  }

  if (pathArg && existsSync(pathArg) && statSync(pathArg).isFile()) {
    if (isRootsMapFile(pathArg)) {
      return resolveDeclaredRoots({ rootsFile: pathArg });
    }
    return [
      {
        id: "workspace",
        path: dirname(pathArg),
        resolved: dirname(pathArg),
      },
    ];
  }

  const dir = pathArg ?? resolve(process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `No agent contract found under ${dir} (looked for ${CONTRACT_FILENAMES.join(", ")})`,
    );
  }

  const rootsFile = findRootsFile(dir);
  if (rootsFile) {
    return resolveDeclaredRoots({ rootsFile });
  }

  return [{ id: "workspace", path: input.path ?? dir, resolved: dir }];
}

function directoryBase(pathArg: string | undefined): string {
  if (!pathArg) return resolve(process.cwd());
  if (existsSync(pathArg) && statSync(pathArg).isDirectory()) return pathArg;
  if (existsSync(pathArg)) return dirname(pathArg);
  return resolve(process.cwd());
}

function loadFromRoots(declared: DeclaredRoot[], source: string): AgentContract {
  const loaded: Array<{ root: DeclaredRoot; contract: AgentContract }> = [];
  const roots: WorkspaceRoot[] = [];

  for (const root of declared) {
    const contractPath = findContractFile(root.resolved);
    roots.push({ ...root, contractPath });
    if (contractPath) {
      loaded.push({ root, contract: loadContract(contractPath) });
    }
  }

  if (loaded.length === 0) {
    throw new Error(
      `No agent contract found under declared roots (looked for ${CONTRACT_FILENAMES.join(", ")} in ${declared
        .map((root) => root.resolved)
        .join(", ")})`,
    );
  }

  // One declared root with one contract: identical shape to loadContract().
  if (loaded.length === 1 && declared.length === 1) {
    return loaded[0].contract;
  }

  return { ...mergeContracts(loaded), source, roots };
}

/**
 * Compile a single-root or multi-root workspace into one AgentContract.
 *
 * - `path` to an `.md` file → `loadContract` (single-root, unchanged).
 * - `roots` / `rootsFile` / a directory containing a roots map → walk every
 *   declared root, fail closed if one is missing, merge layer tables and
 *   verification gates.
 * - otherwise → existing single-directory contract lookup.
 */
export function loadWorkspace(input: WorkspaceInput = {}): AgentContract {
  const pathArg = input.path ? resolve(input.path) : undefined;

  if (
    !input.roots &&
    !input.rootsFile &&
    pathArg &&
    existsSync(pathArg) &&
    statSync(pathArg).isFile() &&
    pathArg.toLowerCase().endsWith(".md") &&
    !isRootsMapFile(pathArg)
  ) {
    return loadContract(pathArg);
  }

  const declared = resolveWorkspaceRoots(input);
  const source = input.rootsFile
    ? resolve(input.rootsFile)
    : pathArg && existsSync(pathArg) && isRootsMapFile(pathArg)
      ? pathArg
      : findRootsFile(declared[0]?.resolved ?? "") ?? pathArg ?? declared[0]?.resolved ?? "workspace";
  return loadFromRoots(declared, source);
}
