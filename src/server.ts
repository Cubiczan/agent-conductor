/**
 * Agent Conductor — MCP server.
 *
 * Exposes three capability groups to any MCP client (Claude Code, Cursor,
 * Copilot, ...):
 *
 *   contract_*  — compile an AGENTS.md operating manual into actionable
 *                 rules, layer boundaries, and verification gates
 *   skills_*    — discover and progressively load SKILL.md skills
 *   decision_*  — gate high-stakes changes through the vendored
 *                 Consensus Hardening Protocol engine
 *
 * Server shape adapted from onchainmind's MCPServer
 * (https://codeberg.org/cubiczan/onchainmind, MIT).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadWorkspace, resolveWorkspaceRoots, type WorkspaceInput } from "./contract/workspace.ts";
import { chpBridge } from "./engine/chpBridge.ts";
import { skillRegistry } from "./skills/registry.ts";
import { logger } from "./utils/logger.ts";

const workspaceInputShape = {
  path: z
    .string()
    .optional()
    .describe("AGENTS.md path, project root, or directory containing a roots map"),
  roots: z
    .array(z.string())
    .optional()
    .describe("Explicit list of workspace roots to walk (fail closed if any is missing)"),
  rootsFile: z
    .string()
    .optional()
    .describe("Path to a roots map file (JSON object/array or line-oriented id: path)"),
};

function workspaceInput(args: {
  path?: string;
  projectRoot?: string;
  roots?: string[];
  rootsFile?: string;
}): WorkspaceInput {
  return {
    path: args.path ?? args.projectRoot,
    roots: args.roots,
    rootsFile: args.rootsFile,
  };
}

function jsonContent(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorContent(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "agent-conductor",
    version: "0.1.0",
    description:
      "Agent Conductor — compiles AGENTS.md contracts and SKILL.md skills into " +
      "governed, consensus-gated agent operations.",
  });

  // ─── Contract tools ────────────────────────────────────────────────────

  server.tool(
    "contract_load",
    "Compile an AGENTS.md operating manual into a structured agent contract: " +
      "mission, non-negotiable rules, layer responsibilities, verification gates, " +
      "recommended skills, and out-of-scope list. Pass a file path, a project " +
      "directory, an explicit roots list, or a roots map file (defaults to cwd). " +
      "Returns a summary without section bodies so callers stay inside progressive-disclosure budgets.",
    workspaceInputShape,
    async ({ path, roots, rootsFile }) => {
      try {
        const contract = loadWorkspace({ path, roots, rootsFile });
        const { sections, ...summary } = contract;
        return jsonContent({ ...summary, sectionCount: sections.length });
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "contract_verification",
    "Return the verification gates from a project's agent contract — the named " +
      "checklists and shell commands that must pass before work is handed off. " +
      "Run these and confirm success before declaring any task complete. Accepts " +
      "the same single-root or multi-root inputs as contract_load.",
    workspaceInputShape,
    async ({ path, roots, rootsFile }) => {
      try {
        const contract = loadWorkspace({ path, roots, rootsFile });
        return jsonContent({
          source: contract.source,
          gates: contract.gates,
          ...(contract.roots ? { roots: contract.roots } : {}),
        });
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  // ─── Skill tools ───────────────────────────────────────────────────────

  server.tool(
    "skills_list",
    "Discover SKILL.md skills visible from a project root or declared multi-root " +
      "workspace (project-scope .conductor/.claude/.cursor skill dirs per root, " +
      "then personal ones). Extra source roots outside a module directory are " +
      "included when declared. Returns metadata only (~100 tokens per skill); " +
      "use skill_load for the full body.",
    {
      projectRoot: z.string().optional().describe("Project root (defaults to cwd)"),
      ...workspaceInputShape,
    },
    async ({ projectRoot, path, roots, rootsFile }) => {
      try {
        const declared = resolveWorkspaceRoots(workspaceInput({ projectRoot, path, roots, rootsFile }));
        skillRegistry.refresh(declared.map((root) => root.resolved));
        return jsonContent({ skills: skillRegistry.getSummary() });
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "skill_load",
    "Load the full SKILL.md body for a named skill — the on-demand half of " +
      "progressive disclosure. Call only when the current task matches the " +
      "skill's description.",
    {
      name: z.string().describe("Skill name as returned by skills_list"),
      projectRoot: z.string().optional().describe("Project root (defaults to cwd)"),
      ...workspaceInputShape,
    },
    async ({ name, projectRoot, path, roots, rootsFile }) => {
      try {
        if (!skillRegistry.has(name)) {
          const declared = resolveWorkspaceRoots(
            workspaceInput({ projectRoot, path, roots, rootsFile }),
          );
          skillRegistry.refresh(declared.map((root) => root.resolved));
        }
        const skill = skillRegistry.load(name);
        if (!skill) {
          return errorContent(
            new Error(`Skill "${name}" not found. Available: ${skillRegistry.listNames().join(", ") || "none"}`),
          );
        }
        return jsonContent(skill);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  // ─── Decision tools (CHP engine) ───────────────────────────────────────

  server.tool(
    "decision_gate",
    "Run the Consensus Hardening Protocol R0 gate on a proposed decision: is it " +
      "solvable, scoped, valid, and worth making at all? Any FATAL answer returns " +
      "HALT — stop and reframe before doing the work.",
    {
      solvable: z.boolean().describe("Can this problem actually be solved?"),
      scoped: z.boolean().describe("Is the scope explicitly bounded?"),
      valid: z.boolean().describe("Is the current state accurately understood?"),
      worth_it: z.boolean().describe("Do the stakes justify the work?"),
    },
    async (input) => {
      try {
        return jsonContent(await chpBridge.r0Gate(input));
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "decision_adversary",
    "Run a one-shot Consensus Hardening Protocol adversarial pass against a claim " +
      "or proposed change: CHP attacks its foundations, scores them 0-100, and " +
      "returns findings plus a session status (EXPLORING / HALT / " +
      "REFRAME_REQUIRED). Use before locking any high-stakes decision.",
    {
      claim: z.string().describe("The claim or decision to attack"),
      context: z.string().optional().describe("Supporting context for the claim"),
      high_stakes: z.boolean().optional().describe("Default true"),
    },
    async ({ claim, context, high_stakes }) => {
      try {
        return jsonContent(await chpBridge.adversary({ claim, context, high_stakes }));
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "engine_status",
    "Health/readiness probe for the vendored CHP decision engine (Python " +
      "subprocess). By default returns a cheap readiness snapshot (running, last " +
      "exit code, restart-backoff state) WITHOUT spawning Python. Pass probe=true " +
      "to also issue a live ping that warms/spawns the subprocess.",
    { probe: z.boolean().optional().describe("Issue a live ping (spawns the subprocess). Default false.") },
    async ({ probe }) => {
      try {
        const readiness = chpBridge.engineStatus();
        if (!probe) return jsonContent(readiness);
        const ping = await chpBridge.ping();
        return jsonContent({ ...readiness, running: chpBridge.engineStatus().running, ping });
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  logger.info("server configured: 7 tools (contract, skills, decision)");
  return server;
}
