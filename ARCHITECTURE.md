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
│  contract/workspace.ts Multi-root merge        │
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
│  bridge.py            request router           │
│  vendor/cme/          vendored CHP core (MIT)  │
│    chp/gates.py       R0 + phase gates         │
│    chp/runner.py      adversarial passes       │
│    chp/models.py      decision lifecycle       │
│    orchestrator.py    produces/consumes DAG    │
│    agent.py           MeshAgent base           │
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

`workspace.ts` walks an explicit roots list or map file (`.conductor/roots.json`,
`conductor.roots.json`, or a line-oriented sibling), compiles every AGENTS.md
it finds, and emits **one** contract whose layer table and verification
commands are the concatenation of every root. Extra source roots — the
Gradle `sourceSet` case where skills live outside a module directory — are
visible when declared. A missing declared root fails closed; the loader
does not invent or skip roots. A directory with no roots map still compiles
as a single root, so `examples/pipeline-pulse` is unchanged.

### Skill loader + registry (`src/skills/`)

Implements progressive disclosure over the SKILL.md convention:

- **Discovery** scans, in shadowing order: `.conductor/skills`,
  `.claude/skills`, `.cursor/skills` (project) for each declared root, then
  `~/.claude/skills`, `~/.cursor/skills` (personal, once). First hit per
  skill name wins. Multi-root workspaces therefore resolve skills that live
  outside a module directory.
- **Metadata** comes from frontmatter only (name, description, version,
  tools) — what `skills_list` returns, cheap enough to put wholesale in a
  model's context.
- **Bodies** load on demand via `skill_load`.

The registry surface (register / get / summary) is adapted from
onchainmind's `SkillRegistry`, re-pointed from compiled-in TypeScript skill
classes to filesystem-discovered SKILL.md files.

### Decision engine (`engine/`)

The vendored core of consensus-hardening-protocol, exposed through
`bridge.py` over newline-delimited JSON (`{id, method, params}` →
`{id, result | error}`). Two methods are wired in v0.1:

- **`r0_gate`** — the cheapest, highest-leverage CHP gate: before any work,
  is the decision solvable, scoped, valid, and worth making? Any FATAL →
  HALT.
- **`adversary`** — `TriangulationRunner.as_adversary(claim)`: a one-shot
  pass where CHP attacks the claim's foundations, produces a 0–100
  foundation score, devil's-advocate findings, and a session status
  (EXPLORING / HALT / REFRAME_REQUIRED).

The vendor copy excludes CHP's finance-domain packages (`finance/`,
`cfo_os/`, `demo/`, CLI) — only the protocol core ships. `__init__.py` is
patched accordingly; everything else is byte-identical to upstream. The
core is pure-Python stdlib (dataclasses only), so the engine needs no pip
install and runs on Python 3.9+ despite upstream targeting 3.10
(`from __future__ import annotations` throughout).

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
| `engine/vendor/cme/` | [consensus-hardening-protocol](https://codeberg.org/cubiczan/consensus-hardening-protocol) | MIT |
| `src/server.ts`, `src/skills/registry.ts` (shape) | [onchainmind](https://codeberg.org/cubiczan/onchainmind) | MIT |
| `examples/pipeline-pulse/AGENTS.md` | Pipeline Pulse CRM operating manual | fixture |
| `examples/multimodule/` | Gradle-style extra source root | fixture |

## Testing

- `npm test` — node:test, runs the TypeScript directly (Node 23+ type
  stripping; `erasableSyntaxOnly` keeps the source strippable): contract
  parser against the real fixtures and edge cases (including the
  multi-module extra-source-root fixture), skill loader/registry, and the
  live engine bridge end to end (spawns Python).
- `npm run test:engine` — Python-side protocol tests: happy paths, unknown
  method, missing params.
