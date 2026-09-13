# Agent Conductor — Architecture

## Problem

AGENTS.md and SKILL.md are the two conventions the coding-agent ecosystem has
converged on, but both are passive: agents read them as prose and comply (or
don't) on the honor system. Nothing compiles the contract, nothing gates the
decision, nothing verifies the checklist ran. Conductor makes the conventions
executable without asking any agent tool to change — it ships as a standard
MCP server.

## System overview

```text
MCP client (Claude Code / Cursor / Copilot / ...)
        │  stdio (JSON-RPC, MCP)
        ▼
┌────────────────────────────────────────────────┐
│ TypeScript front end (src/)                    │
│                                                │
│  contract/parser.ts   AGENTS.md → AgentContract│
│  skills/loader.ts     SKILL.md discovery       │
│  skills/registry.ts   register / load on demand│
│  server.ts            7 MCP tools              │
│  engine/chpBridge.ts  engine client            │
└────────────────┬───────────────────────────────┘
                 │  newline-delimited JSON over child stdio
                 ▼
┌────────────────────────────────────────────────┐
│ Python decision engine (engine/)               │
│                                                │
│  bridge.py            NDJSON request router    │
│  requirements.txt     PyPI CHP pin             │
│  → consensus-hardening-protocol (`import chp`) │
│    chp.gates          R0 + phase gates         │
│    chp.runner         adversarial passes       │
│    chp.models         decision lifecycle       │
└────────────────────────────────────────────────┘
```

## Components

### Contract parser (`src/contract/`)

Compiles AGENTS.md into an `AgentContract`. Convention-based, not
schema-based: it walks the markdown heading tree and extracts the recurring
patterns of the AGENTS.md ecosystem —

- **mission** (`Mission` / `Purpose` / `Overview` heading)
- **rules** (prioritized: `Non-negotiables` > `Engineering rules` > generic
  `rules` — priority order matters because a generic "Product rules" section
  must not shadow an explicit non-negotiables list)
- **layers** (first table with a `Layer` column under an architecture heading)
- **gates** (shell code blocks under checklist/verification headings —
  the commands that must pass before handoff)
- **skills** (recommendation tables with `Task`/`Skill`/`Why` columns,
  links resolved)
- **out of scope** (list under an out-of-scope/non-goals heading)

Unrecognized sections are preserved verbatim in `sections`, so the compiled
form is lossless. Zero dependencies — a small line-walker that is
fence-aware (headings inside code blocks don't split sections).

### Skill loader + registry (`src/skills/`)

Implements progressive disclosure over the SKILL.md convention:

- **Discovery** scans, in shadowing order: `.conductor/skills`,
  `.claude/skills`, `.cursor/skills` (project), then `~/.claude/skills`,
  `~/.cursor/skills` (personal). First hit per skill name wins.
- **Metadata** comes from frontmatter only (name, description, version,
  tools) — what `skills_list` returns, cheap enough to put wholesale in a
  model's context.
- **Bodies** load on demand via `skill_load`.

The registry surface (register / get / summary) is adapted from
onchainmind's `SkillRegistry`, re-pointed from compiled-in TypeScript skill
classes to filesystem-discovered SKILL.md files.

### Decision engine (`engine/`)

Published [`consensus-hardening-protocol`](https://pypi.org/project/consensus-hardening-protocol/)
(`import chp`), reached through `bridge.py` over newline-delimited JSON
(`{id, method, params}` → `{id, result | error}`). MCP tools map 1:1:

| MCP tool | Bridge method | CHP surface |
|----------|---------------|-------------|
| `decision_gate` | `r0_gate` | `chp.gates.evaluate_r0_gate` |
| `decision_adversary` | `adversary` | `TriangulationRunner.as_adversary` |
| `engine_status` | `ping` | package version + subprocess health |
| *(v0.3)* `decision_lock` / mesh sessions | TBD | lock progression + multi-agent |

- **`r0_gate`** — cheapest CHP gate: solvable / scoped / valid / worth_it.
  Any FATAL → HALT.
- **`adversary`** — foundation attack, 0–100 score, devil's-advocate
  findings, session status (EXPLORING / HALT / REFRAME_REQUIRED).

Install with `pip install -r engine/requirements.txt` (Python 3.10+).
Do not re-vendor; protocol fixes belong in the upstream package.

### Bridge client (`src/engine/chpBridge.ts`)

Lazily spawns `python3 engine/bridge.py`, correlates requests/responses by
id, rejects all pending calls if the child dies, and logs engine stderr to
the server's stderr. The subprocess is reused across calls.

## Design decisions

1. **MCP as the delivery surface.** The product must work with agent tools
   as they exist. MCP is the one integration point they all share.
2. **Two languages, one process tree.** The governance assets are Python,
   the MCP/skill ecosystem is TypeScript. Rewriting either side would burn
   the leverage of reusing proven code; a subprocess JSON bridge costs ~50
   lines per side and zero network dependencies.
3. **Zero runtime dependencies beyond the MCP SDK.** Markdown and
   frontmatter parsing are hand-rolled subsets — the formats in the wild
   are regular enough, and the parsers are fully covered by tests. This
   honors the "minimal dependencies" rule that AGENTS.md files themselves
   tend to declare.
4. **stdout discipline.** stdout belongs to the MCP transport; every log
   line goes to stderr (`src/utils/logger.ts`). Same rule inside the
   Python engine: responses only on stdout.
5. **Lossless compilation.** The parser extracts what it recognizes and
   preserves the rest, so a contract round-trips even when a project's
   AGENTS.md uses headings we've never seen.

## Provenance

| Component | Source | License |
|-----------|--------|---------|
| PyPI `consensus-hardening-protocol` | [icohangar-ops/consensus-hardening-protocol](https://github.com/icohangar-ops/consensus-hardening-protocol) | MIT |
| `src/server.ts`, `src/skills/registry.ts` (shape) | [onchainmind](https://codeberg.org/cubiczan/onchainmind) | MIT |
| `examples/pipeline-pulse/AGENTS.md` | Pipeline Pulse CRM operating manual | fixture |

## Testing

- `npm test` — node:test, runs the TypeScript directly (Node 23+ type
  stripping; `erasableSyntaxOnly` keeps the source strippable): contract
  parser against the real fixture and edge cases, skill loader/registry,
  and the live engine bridge end to end (spawns Python).
- `npm run test:engine` — Python-side protocol tests: happy paths, unknown
  method, missing params.
