/**
 * Agent Conductor — AGENTS.md contract parser.
 *
 * Compiles an AGENTS.md operating manual into an AgentContract. The parser
 * is convention-based, not schema-based: it walks the markdown heading tree
 * and extracts the patterns the AGENTS.md ecosystem has converged on —
 * mission statements, non-negotiable rule lists, layer-responsibility
 * tables, verification command blocks, skill recommendation tables, and
 * out-of-scope lists. Sections it does not recognize are preserved
 * verbatim in `sections` so nothing is lost.
 *
 * No markdown library: AGENTS.md files are regular enough that a small
 * line-walker keeps the dependency surface at zero.
 */

import { readFileSync } from "node:fs";
import type { ContractSpendMandate, ModelClass } from "../budget/types.ts";
import { resolveContained } from "../utils/containedPath.ts";
import type {
  AgentContract,
  ContractSection,
  LayerRule,
  SkillRecommendation,
  VerificationGate,
} from "./types.ts";

// ─── Section splitting ───────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Split markdown into flat sections keyed by heading. */
export function splitSections(markdown: string): ContractSection[] {
  const sections: ContractSection[] = [];
  let heading = "";
  let level = 0;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (heading || buffer.some((l) => l.trim() !== "")) {
      sections.push({ heading, level, content: buffer.join("\n").trim() });
    }
    buffer = [];
  };

  for (const line of markdown.split("\n")) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    const match = !inFence ? line.match(HEADING_RE) : null;
    if (match) {
      flush();
      level = match[1].length;
      heading = match[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Find the first section whose heading matches the pattern. */
function findSection(sections: ContractSection[], pattern: RegExp): ContractSection | undefined {
  return sections.find((s) => pattern.test(s.heading));
}

/** All sections nested under a matching heading (until a heading of equal or higher level). */
function sectionsUnder(sections: ContractSection[], pattern: RegExp): ContractSection[] {
  const start = sections.findIndex((s) => pattern.test(s.heading));
  if (start === -1) return [];
  const parentLevel = sections[start].level;
  const nested: ContractSection[] = [sections[start]];
  for (let i = start + 1; i < sections.length; i++) {
    if (sections[i].level <= parentLevel) break;
    nested.push(sections[i]);
  }
  return nested;
}

// ─── Block extractors ────────────────────────────────────────────────────────

/** Parse a markdown pipe table into row objects keyed by lower-cased header. */
export function parseTable(content: string): Array<Record<string, string>> {
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] =>
    line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().replace(/\*/g, ""));
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    if (/^\|?[\s:|-]+\|?$/.test(line)) continue; // separator row
    const cells = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    rows.push(row);
  }
  return rows;
}

/** Extract list items (numbered or bulleted), markdown emphasis stripped. */
export function parseListItems(content: string): string[] {
  const items: string[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    if (inFence) continue;
    const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (match) items.push(stripMarkdown(match[1]));
  }
  return items;
}

/** Extract fenced code blocks, with their language tag. */
export function parseCodeFences(content: string): Array<{ lang: string; code: string }> {
  const fences: Array<{ lang: string; code: string }> = [];
  const re = /(?:```|~~~)([^\n]*)\n([\s\S]*?)(?:```|~~~)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    fences.push({ lang: match[1].trim(), code: match[2].trimEnd() });
  }
  return fences;
}

/** Resolve `[text](url)` to its parts; otherwise return the text with no url. */
function parseLink(cell: string): { text: string; url: string } {
  const match = cell.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return match ? { text: match[1], url: match[2] } : { text: stripMarkdown(cell), url: "" };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// ─── Contract compilation ────────────────────────────────────────────────────

const MISSION_RE = /mission|purpose|overview/i;
// Tried in priority order: a generic "rules" heading must not shadow an
// explicit non-negotiables section that appears later in the document.
const RULES_PATTERNS = [/non-negotiable/i, /engineering rules/i, /\brules\b/i, /principles/i];
const LAYERS_RE = /layer responsibilit|architecture/i;
const GATES_RE = /checklist|before completion|verification|before handing off/i;
const SKILLS_RE = /recommended skills|skills for this repo|agent skills/i;
const OUT_OF_SCOPE_RE = /out of scope|non-goals|do not/i;
const SPEND_RE = /spend mandate|spend cap|cost ceiling|budget ceiling/i;
const HIGH_IMPACT_RE = /high-impact tool|pause-and-approve|approval[- ]required/i;
const MODEL_CLASSES = new Set<ModelClass>(["small", "mid", "high", "frontier"]);

/** Compile markdown text into an AgentContract. */
export function compileContract(markdown: string, source = "AGENTS.md"): AgentContract {
  const sections = splitSections(markdown);

  const title = sections.find((s) => s.level === 1)?.heading ?? source;
  const mission = findSection(sections, MISSION_RE)?.content ?? "";

  // Non-negotiables: highest-priority rules-like section that contains a list.
  let rules: string[] = [];
  outer: for (const pattern of RULES_PATTERNS) {
    for (const section of sectionsUnder(sections, pattern)) {
      const items = parseListItems(section.content);
      if (items.length > 0) {
        rules = items;
        break outer;
      }
    }
  }

  // Layer table: first table under an architecture-like heading with a layer column.
  let layers: LayerRule[] = [];
  for (const section of sectionsUnder(sections, LAYERS_RE)) {
    const rows = parseTable(section.content);
    if (rows.length > 0 && "layer" in rows[0]) {
      layers = rows.map((r) => ({
        layer: stripMarkdown(r["layer"] ?? ""),
        role: r["role"] ?? "",
        do: r["do"] ?? "",
        dont: r["don't"] ?? r["dont"] ?? "",
      }));
      break;
    }
  }

  // Verification gates: every checklist-like section contributes its shell blocks.
  const gates: VerificationGate[] = [];
  const seenGateSections = new Set<string>();
  for (const section of sections) {
    if (!GATES_RE.test(section.heading) || seenGateSections.has(section.heading)) continue;
    seenGateSections.add(section.heading);
    const shellBlocks = parseCodeFences(section.content).filter(
      (f) => f.lang === "" || /^(bash|sh|shell|zsh)$/.test(f.lang),
    );
    const commands = shellBlocks
      .flatMap((f) => f.code.split("\n"))
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    const listNotes = parseListItems(section.content);
    if (commands.length > 0 || listNotes.length > 0) {
      gates.push({
        name: section.heading,
        commands,
        notes: listNotes.join("\n"),
      });
    }
  }

  // Skill recommendations: first table with task+skill columns under a skills heading.
  let skills: SkillRecommendation[] = [];
  for (const section of sectionsUnder(sections, SKILLS_RE)) {
    const rows = parseTable(section.content);
    if (rows.length > 0 && "skill" in rows[0]) {
      skills = rows.map((r) => {
        const link = parseLink(r["skill"] ?? "");
        return {
          task: stripMarkdown(r["task"] ?? ""),
          skill: link.text,
          url: link.url,
          why: stripMarkdown(r["why"] ?? ""),
        };
      });
      break;
    }
  }

  const outOfScope = parseListItems(findSection(sections, OUT_OF_SCOPE_RE)?.content ?? "");
  const spendMandate = extractSpendMandate(sections);

  return { source, title, mission, rules, layers, gates, skills, outOfScope, spendMandate, sections };
}

function extractSpendMandate(sections: ContractSection[]): ContractSpendMandate | null {
  const spendSections = sectionsUnder(sections, SPEND_RE);
  const highImpactSections = sectionsUnder(sections, HIGH_IMPACT_RE);
  if (spendSections.length === 0 && highImpactSections.length === 0) return null;

  let runUsd: number | null = null;
  let tenantDayUsd: number | null = null;
  let defaultToolUsd: number | null = null;
  let maxTurns: number | null = null;
  let maxModelClass: ModelClass | null = null;
  let preferredModelClass: ModelClass | null = null;
  const toolUsd: Record<string, number> = {};
  const highImpactTools: string[] = [];

  const applyRow = (key: string, raw: string, rawKey: string) => {
    const limit = parseUsd(raw);
    if (key === "run" || key === "run-usd" || key === "per-run") {
      if (limit !== null) runUsd = limit;
      return;
    }
    if (key === "tenant-day" || key === "tenant/day" || key === "per-tenant-day" || key === "daily") {
      if (limit !== null) tenantDayUsd = limit;
      return;
    }
    if (key === "tool-default" || key === "default-tool" || key === "tool-default-usd") {
      if (limit !== null) defaultToolUsd = limit;
      return;
    }
    if (key === "max-turns" || key === "turns" || key === "max turns") {
      const turns = Number(raw.replace(/[$,]/g, "").trim());
      if (Number.isFinite(turns) && turns >= 0) maxTurns = Math.floor(turns);
      return;
    }
    if (key === "max-model-class" || key === "max-class") {
      const klass = raw.trim().toLowerCase();
      if (MODEL_CLASSES.has(klass as ModelClass)) maxModelClass = klass as ModelClass;
      return;
    }
    if (key === "preferred-model-class" || key === "preferred-class") {
      const klass = raw.trim().toLowerCase();
      if (MODEL_CLASSES.has(klass as ModelClass)) preferredModelClass = klass as ModelClass;
      return;
    }
    if (key === "high-impact" || key === "high-impact-tools") {
      for (const name of raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        highImpactTools.push(name);
      }
      return;
    }
    const toolMatch = rawKey.match(/^tool[:/]\s*(.+)$/i);
    if (toolMatch && limit !== null) {
      toolUsd[toolMatch[1].trim()] = limit;
    }
  };

  for (const section of spendSections) {
    for (const row of parseTable(section.content)) {
      const rawKey = stripMarkdown(row["ceiling"] ?? row["kind"] ?? row["cap"] ?? "");
      const key = rawKey.toLowerCase();
      const limit = stripMarkdown(row["limit"] ?? row["usd"] ?? row["value"] ?? row["cap"] ?? "");
      if (key) applyRow(key, limit, rawKey);
    }
  }

  for (const section of [...spendSections, ...highImpactSections]) {
    if (HIGH_IMPACT_RE.test(section.heading) || /high-impact/i.test(section.heading)) {
      for (const item of parseListItems(section.content)) {
        if (item) highImpactTools.push(item);
      }
    }
  }

  return {
    runUsd,
    tenantDayUsd,
    toolUsd,
    defaultToolUsd,
    maxTurns,
    highImpactTools: unique(highImpactTools),
    maxModelClass,
    preferredModelClass,
  };
}

function parseUsd(raw: string): number | null {
  const n = Number(raw.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Read and compile an AGENTS.md file from disk. */
export function loadContract(path: string): AgentContract {
  const contained = resolveContained(path);
  return compileContract(readFileSync(contained, "utf8"), contained);
}
