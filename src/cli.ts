/**
 * Agent Conductor — contract CLI.
 *
 * Makes executable contracts (matrix row 21) mechanically adoptable from
 * any CI: compile an AGENTS.md fail-closed, and optionally run the
 * verification gates it declares. Same parser as the MCP tooling — no
 * second implementation to drift.
 *
 * Usage:
 *
 *   agent-conductor verify <AGENTS.md>                 compile; exit 0/1
 *   agent-conductor verify --require-gates <AGENTS.md> also fail when the
 *                                                      contract declares no
 *                                                      verification gates
 *   agent-conductor verify --run-gates <AGENTS.md>     run every declared
 *                                                      gate command; exit 1
 *                                                      on first failure
 *
 * Exit codes: 0 compiled (and gates ran, when requested); 1 compile
 * failure, missing file, zero gates under --require-gates, or a gate
 * command failed under --run-gates. This is the anti-placeholder gate:
 * an AGENTS.md whose gates "gate nothing" fails CI instead of merging.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadContract } from "./contract/parser.ts";
import type { AgentContract } from "./contract/types.ts";

export interface VerifyOptions {
  readonly requireGates: boolean;
  readonly runGates: boolean;
  readonly timeoutPerCommandMs: number;
}

export const DEFAULT_VERIFY_OPTIONS: VerifyOptions = {
  requireGates: false,
  runGates: false,
  timeoutPerCommandMs: 300_000,
};

function parseArgs(argv: readonly string[]): { path: string; options: VerifyOptions } {
  let path: string | null = null;
  const options: VerifyOptions = { ...DEFAULT_VERIFY_OPTIONS };
  for (const arg of argv) {
    if (arg === "--require-gates") {
      (options as { requireGates: boolean }).requireGates = true;
    } else if (arg === "--run-gates") {
      (options as { runGates: boolean }).runGates = true;
    } else if (arg === "--") {
      continue;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag: ${arg}`);
    } else if (path === null) {
      path = arg;
    } else {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
  }
  if (path === null) {
    throw new Error("usage: agent-conductor verify [--require-gates] [--run-gates] <AGENTS.md>");
  }
  return { path, options };
}

/** Execute the gates' commands; returns the failing command or null. */
export function runGateCommands(
  contract: AgentContract,
  options: VerifyOptions,
  log: (line: string) => void = console.error,
): string | null {
  for (const gate of contract.gates) {
    for (const command of gate.commands) {
      log(`[gate:${gate.name}] $ ${command}`);
      try {
        const out = execSync(command, {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: options.timeoutPerCommandMs,
          encoding: "utf8",
        });
        if (out.trim()) log(out.trimEnd());
      } catch (error) {
        log(`[gate:${gate.name}] FAILED`);
        log(String((error as Error).message));
        return command;
      }
    }
  }
  return null;
}

/** Compile (and optionally execute) the contract; returns the process exit code. */
export function runVerify(
  argv: readonly string[],
  log: (line: string) => void = console.error,
): number {
  let parsed: { path: string; options: VerifyOptions };
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    log(`agent-conductor: ${(error as Error).message}`);
    return 1;
  }
  const { path, options } = parsed;
  if (!existsSync(path)) {
    log(`agent-conductor: contract file not found: ${path}`);
    return 1;
  }
  let contract: AgentContract;
  try {
    contract = loadContract(path);
  } catch (error) {
    log(`agent-conductor: compile failed for ${path}`);
    log(String((error as Error).message));
    return 1;
  }
  log(`agent-conductor: compiled ${path}`);
  log(`  title:    ${contract.title}`);
  log(`  rules:    ${contract.rules.length} non-negotiable(s)`);
  log(`  layers:   ${contract.layers.length}`);
  log(`  gates:    ${contract.gates.length}`);
  for (const gate of contract.gates) {
    log(`    - ${gate.name}: ${gate.commands.join(" && ")}`);
  }
  if (options.requireGates && contract.gates.length === 0) {
    log(
      "agent-conductor: FAIL — contract declares no verification gates " +
        "(--require-gates): a contract that gates nothing does not compile",
    );
    return 1;
  }
  if (options.runGates) {
    const failed = runGateCommands(contract, options, log);
    if (failed !== null) {
      log(`agent-conductor: FAIL — gate command failed: ${failed}`);
      return 1;
    }
    log("agent-conductor: all gate commands passed");
  }
  log("agent-conductor: OK");
  return 0;
}
