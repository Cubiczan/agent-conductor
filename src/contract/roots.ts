/**
 * Agent Conductor — declared workspace roots.
 *
 * Accepts an inline list or a map file (JSON object/array, or a
 * line-oriented `id: path` listing). Every declared root is resolved and
 * must exist as a directory — missing roots fail closed instead of being
 * skipped. Relative paths resolve against the map file's directory, or
 * against an explicit base when the caller passes a list.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, normalize, resolve } from "node:path";

/** A declared root after fail-closed filesystem resolution. */
export interface DeclaredRoot {
  readonly id: string;
  readonly path: string;
  readonly resolved: string;
}

export interface ResolveRootsOptions {
  readonly roots?: readonly (string | { id?: string; path: string })[];
  readonly rootsFile?: string;
  /** Directory used to resolve relative list entries (defaults to cwd). */
  readonly base?: string;
}

/** Parse a roots map (JSON or line-oriented) into path entries. */
export function parseRootsFile(
  text: string,
  source = "roots map",
): Array<{ id?: string; path: string }> {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error(`Roots map ${source} is empty`);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseRootsJson(trimmed, source);
  }
  return parseRootsText(trimmed, source);
}

function parseRootsJson(
  text: string,
  source: string,
): Array<{ id?: string; path: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Roots map ${source} is not valid JSON: ${message}`);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error(`Roots map ${source} declares no roots`);
    }
    return parsed.map((item, index) => coerceRootEntry(item, source, index));
  }
  if (parsed && typeof parsed === "object" && "roots" in parsed) {
    const roots = (parsed as { roots: unknown }).roots;
    if (!Array.isArray(roots)) {
      throw new Error(`Roots map ${source} field "roots" must be an array`);
    }
    if (roots.length === 0) {
      throw new Error(`Roots map ${source} declares no roots`);
    }
    return roots.map((item, index) => coerceRootEntry(item, source, index));
  }
  throw new Error(`Roots map ${source} must be an array or an object with a "roots" array`);
}

function coerceRootEntry(
  item: unknown,
  source: string,
  index: number,
): { id?: string; path: string } {
  if (typeof item === "string") {
    return { path: item };
  }
  if (item && typeof item === "object" && "path" in item) {
    const path = (item as { path: unknown }).path;
    if (typeof path !== "string") {
      throw new Error(`Roots map ${source} entry ${index} field "path" must be a string`);
    }
    const rawId = (item as { id?: unknown }).id;
    const id = typeof rawId === "string" && rawId.trim() !== "" ? rawId : undefined;
    return id ? { id, path } : { path };
  }
  throw new Error(
    `Roots map ${source} entry ${index} must be a path string or { id?, path }`,
  );
}

function parseRootsText(
  text: string,
  source: string,
): Array<{ id?: string; path: string }> {
  const entries: Array<{ id?: string; path: string }> = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9._-]+)\s*[=:]\s*(.+)$/);
    if (kv) {
      entries.push({ id: kv[1], path: kv[2].trim() });
    } else {
      entries.push({ path: line });
    }
  }
  if (entries.length === 0) {
    throw new Error(`Roots map ${source} declares no roots`);
  }
  return entries;
}

function allocateId(requested: string | undefined, declaredPath: string, used: Set<string>): string {
  const fallback =
    declaredPath === "." || declaredPath === ""
      ? "workspace"
      : basename(normalize(declaredPath)) || "root";
  let id = (requested && requested.trim() !== "" ? requested.trim() : fallback) || "root";
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  const suffixed = `${id}-${n}`;
  used.add(suffixed);
  return suffixed;
}

/**
 * Resolve a declared roots list or map file. Missing, empty, or non-directory
 * entries throw — callers must not invent or skip roots.
 */
export function resolveDeclaredRoots(options: ResolveRootsOptions): DeclaredRoot[] {
  let entries: Array<{ id?: string; path: string }>;
  let base: string;

  if (options.roots && options.roots.length > 0) {
    entries = options.roots.map((root) => (typeof root === "string" ? { path: root } : root));
    base = resolve(options.base ?? process.cwd());
  } else if (options.rootsFile) {
    const rootsFile = resolve(options.rootsFile);
    if (!existsSync(rootsFile)) {
      throw new Error(`Declared roots map is missing: ${rootsFile}`);
    }
    if (!statSync(rootsFile).isFile()) {
      throw new Error(`Declared roots map is not a file: ${rootsFile}`);
    }
    entries = parseRootsFile(readFileSync(rootsFile, "utf8"), rootsFile);
    base = dirname(rootsFile);
  } else {
    throw new Error("No roots or roots map file declared");
  }

  if (entries.length === 0) {
    throw new Error("Roots map declares no roots");
  }

  const usedIds = new Set<string>();
  const usedResolved = new Set<string>();
  const declared: DeclaredRoot[] = [];

  for (const entry of entries) {
    const declaredPath = entry.path.trim();
    if (declaredPath === "") {
      throw new Error("Declared root path is empty");
    }
    const resolvedPath = resolve(base, declaredPath);
    if (!existsSync(resolvedPath)) {
      const label = entry.id ? `"${entry.id}" ` : "";
      throw new Error(
        `Declared root ${label}is missing: ${declaredPath} (resolved: ${resolvedPath})`,
      );
    }
    if (!statSync(resolvedPath).isDirectory()) {
      const label = entry.id ? `"${entry.id}" ` : "";
      throw new Error(
        `Declared root ${label}is not a directory: ${declaredPath} (resolved: ${resolvedPath})`,
      );
    }
    if (usedResolved.has(resolvedPath)) {
      throw new Error(`Declared roots resolve to the same path: ${resolvedPath}`);
    }
    usedResolved.add(resolvedPath);
    declared.push({
      id: allocateId(entry.id, declaredPath, usedIds),
      path: declaredPath,
      resolved: resolvedPath,
    });
  }

  return declared;
}
