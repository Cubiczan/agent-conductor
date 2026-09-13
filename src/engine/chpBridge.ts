/**
 * Agent Conductor — CHP decision engine client.
 *
 * Talks to the published Consensus Hardening Protocol package via
 * engine/bridge.py over newline-delimited JSON on a child process's
 * stdio. Requires: pip install -r engine/requirements.txt.
 * The process starts lazily on first call and is reused.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.ts";
import { ResilienceError, withTimeout } from "../lib/resilience/index.ts";

export interface R0GateInput {
  solvable: boolean;
  scoped: boolean;
  valid: boolean;
  worth_it: boolean;
}

export interface R0GateResult {
  verdict: "PASS" | "HALT";
  results: Record<string, "PASS" | "FATAL">;
}

export interface AdversaryInput {
  claim: string;
  context?: string;
  high_stakes?: boolean;
}

export interface AdversaryResult {
  status: string;
  foundation_score: number;
  findings: string[];
  verification_failures: string[];
  report: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "engine");

/** Default per-call budget. A CPU-heavy adversary pass that exceeds this is
 *  treated as a stall rather than allowed to hang the MCP server forever. */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/** Base delay for restart backoff after the subprocess crashes. */
const DEFAULT_RESTART_BASE_DELAY_MS = 500;
/** Cap on a single restart backoff delay. */
const DEFAULT_RESTART_MAX_DELAY_MS = 30_000;
/** Consecutive failed spawns tolerated before refusing to respawn (crash-loop guard). */
const DEFAULT_MAX_CONSECUTIVE_SPAWNS = 5;

export interface ChpBridgeOptions {
  pythonBin?: string;
  bridgePath?: string;
  /** Per-call timeout in ms (default 30_000; <= 0 disables). */
  callTimeoutMs?: number;
}

export class ChpBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly pythonBin: string;
  private readonly bridgePath: string;
  private readonly callTimeoutMs: number;

  // Restart-with-backoff / crash-loop state.
  private consecutiveSpawns = 0;
  private nextSpawnNotBefore = 0;
  private lastExitCode: number | null = null;

  constructor(options?: ChpBridgeOptions);
  constructor(pythonBin?: string, bridgePath?: string);
  constructor(optionsOrPythonBin?: ChpBridgeOptions | string, bridgePath?: string) {
    const opts: ChpBridgeOptions =
      typeof optionsOrPythonBin === "object" && optionsOrPythonBin !== null
        ? optionsOrPythonBin
        : { pythonBin: optionsOrPythonBin, bridgePath };
    this.pythonBin = opts.pythonBin ?? process.env.CONDUCTOR_PYTHON ?? "python3";
    this.bridgePath = opts.bridgePath ?? join(ENGINE_DIR, "bridge.py");
    const envTimeout = Number(process.env.CONDUCTOR_CALL_TIMEOUT_MS);
    this.callTimeoutMs =
      opts.callTimeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout >= 0 ? envTimeout : DEFAULT_CALL_TIMEOUT_MS);
  }

  /** Whether the subprocess is currently alive (no spawn triggered). */
  isRunning(): boolean {
    return this.child !== null;
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;

    // Crash-loop guard: do not respawn faster than the backoff window, and
    // refuse entirely once too many consecutive spawns have failed without a
    // successful round-trip resetting the counter.
    if (this.consecutiveSpawns >= DEFAULT_MAX_CONSECUTIVE_SPAWNS) {
      throw new ResilienceError(
        "exhausted",
        `decision engine crash loop: refusing to respawn after ` +
          `${this.consecutiveSpawns} consecutive failed spawns (last exit code ${this.lastExitCode})`,
        { attempts: this.consecutiveSpawns },
      );
    }
    const now = Date.now();
    if (now < this.nextSpawnNotBefore) {
      const waitMs = this.nextSpawnNotBefore - now;
      throw new ResilienceError(
        "exhausted",
        `decision engine in restart backoff; retry in ${waitMs}ms (last exit code ${this.lastExitCode})`,
        { attempts: this.consecutiveSpawns },
      );
    }

    this.consecutiveSpawns += 1;
    logger.warn(
      `engine spawn attempt #${this.consecutiveSpawns} at ${new Date().toISOString()} ` +
        `(${this.pythonBin} ${this.bridgePath})`,
    );

    const child = spawn(this.pythonBin, [this.bridgePath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk: Buffer) => logger.warn(`engine: ${chunk.toString().trim()}`));
    child.on("exit", (code) => {
      logger.warn(`engine exited (code ${code}) at ${new Date().toISOString()}`);
      this.lastExitCode = code;
      // Schedule the next spawn after an exponential backoff window so a
      // crashing subprocess cannot be respawned in a tight unbounded loop.
      const delay = Math.min(
        DEFAULT_RESTART_MAX_DELAY_MS,
        DEFAULT_RESTART_BASE_DELAY_MS * 2 ** Math.max(0, this.consecutiveSpawns - 1),
      );
      this.nextSpawnNotBefore = Date.now() + delay;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`decision engine exited with code ${code}`));
      }
      this.pending.clear();
      this.child = null;
    });

    createInterface({ input: child.stdout }).on("line", (line) => {
      let response: { id?: number; result?: unknown; error?: string };
      try {
        response = JSON.parse(line);
      } catch {
        logger.warn(`engine sent unparseable line: ${line}`);
        return;
      }
      const pending = response.id !== undefined ? this.pending.get(response.id) : undefined;
      if (!pending) return;
      this.pending.delete(response.id!);
      // A real round-trip proves the subprocess is healthy: clear crash-loop state.
      this.consecutiveSpawns = 0;
      this.nextSpawnNotBefore = 0;
      if (response.error !== undefined) pending.reject(new Error(response.error));
      else pending.resolve(response.result);
    });

    this.child = child;
    return child;
  }

  private call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = this.start();
    const id = this.nextId++;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });

    // Bound the call so a stalled (e.g. CPU-heavy adversary) pass cannot hang
    // the MCP server indefinitely. The pending entry is dropped on timeout so a
    // late response is ignored rather than resolving a caller that gave up.
    return withTimeout(result, this.callTimeoutMs, `decision engine "${method}"`).catch(
      (err: unknown) => {
        this.pending.delete(id);
        throw err;
      },
    );
  }

  ping(): Promise<{ ok: boolean; engine: string; version: string }> {
    return this.call("ping", {});
  }

  /**
   * Cheap health/readiness probe that does NOT spawn the Python subprocess.
   * Reports whether the engine is currently running, the last observed exit
   * code, and whether the bridge is in restart backoff or a refused crash loop.
   * Operators (or an MCP `engine_status` tool) can poll this without paying the
   * cost of a full subprocess spawn.
   */
  engineStatus(): {
    running: boolean;
    lastExitCode: number | null;
    consecutiveSpawns: number;
    backoffMsRemaining: number;
    crashLoopTripped: boolean;
  } {
    const backoffMsRemaining = Math.max(0, this.nextSpawnNotBefore - Date.now());
    return {
      running: this.isRunning(),
      lastExitCode: this.lastExitCode,
      consecutiveSpawns: this.consecutiveSpawns,
      backoffMsRemaining,
      crashLoopTripped: this.consecutiveSpawns >= DEFAULT_MAX_CONSECUTIVE_SPAWNS,
    };
  }

  /** R0 gate: is this decision solvable, scoped, valid, and worth making at all? */
  r0Gate(input: R0GateInput): Promise<R0GateResult> {
    return this.call("r0_gate", { ...input });
  }

  /** One-shot adversarial pass: CHP attacks the claim's foundations. */
  adversary(input: AdversaryInput): Promise<AdversaryResult> {
    return this.call("adversary", { ...input });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}

/** Shared engine client used by the MCP server. */
export const chpBridge = new ChpBridge();
