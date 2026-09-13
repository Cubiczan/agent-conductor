# Agent Conductor

> **Cubiczan stack** — [Profile](https://github.com/Cubiczan) · [CHP](https://github.com/Cubiczan/consensus-hardening-protocol) · **You are here:** `agent-conductor`

**AGENTS.md in, governed agent team out.**

Agent Conductor is an [MCP](https://modelcontextprotocol.io) server that turns
the two conventions the coding-agent ecosystem has converged on —
[`AGENTS.md`](https://agents.md) operating manuals and `SKILL.md` skills — from
passive documentation into an active orchestration layer, with a
consensus-hardened decision engine gating high-stakes changes.

- **Mirrors:** [Cubiczan/agent-conductor](https://github.com/Cubiczan/agent-conductor) · [codeberg.org/cubiczan/agent-conductor](https://codeberg.org/cubiczan/agent-conductor) · [icohangar-ops/agent-conductor](https://github.com/icohangar-ops/agent-conductor)
- **License:** MIT
- **Status:** v0.1 — working scaffold; see [Roadmap](#roadmap)

---

## The problem

Every serious agent tool — Claude Code, Cursor, Copilot, Codex, Gemini CLI —
now reads an `AGENTS.md` at the repo root and a catalog of `SKILL.md` files.
But both conventions are honor-system prose:

- Nothing **compiles** the contract. The non-negotiable rules, layer
  boundaries, and verification checklists live as markdown the agent may or
  may not internalize.
- Nothing **gates** the decision. An agent that's about to rewrite your
  scoring model proceeds with the same confidence as one renaming a variable.
- Nothing **verifies** the checklist ran. "Run `npm test` before handing off"
  is a suggestion, not a gate.

Conductor makes the conventions executable — without asking any agent tool to
change. It ships as a standard MCP server, so anything that speaks MCP gets
contract compilation, skill discovery, and decision gating for free.

## How it works

```text
MCP client (Claude Code / Cursor / Copilot / ...)
        │  stdio (JSON-RPC, MCP)
        ▼
┌────────────────────────────────────────────────┐
│ TypeScript front end (src/)                    │
│   contract/parser.ts   AGENTS.md → contract    │
│   skills/loader.ts     SKILL.md discovery      │
│   server.ts            7 MCP tools             │
└────────────────┬───────────────────────────────┘
                 │  newline-delimited JSON, child stdio
                 ▼
┌────────────────────────────────────────────────┐
│ Python decision engine (engine/)               │
│   bridge.py → PyPI consensus-hardening-protocol│
│   R0 gates · foundation attacks · lifecycle    │
└────────────────────────────────────────────────┘
```

Three capability groups:

1. **Contract** — compile an `AGENTS.md` into structured mission,
   non-negotiable rules, layer do/don't boundaries, verification gates,
   skill recommendations, and an out-of-scope list.
2. **Skills** — discover `SKILL.md` skills across project and personal
   scopes with progressive disclosure: metadata costs ~100 tokens, bodies
   load only on demand.
3. **Decision** — gate work through the
   [Consensus Hardening Protocol](https://github.com/icohangar-ops/consensus-hardening-protocol):
   a cheap R0 sanity gate before work starts, and an adversarial
   foundation-attack pass before a high-stakes change locks.

## Quick start

Requirements: **Node 23+** (runs TypeScript natively) and **Python 3.10+**
with the published CHP package installed.

```bash
git clone https://github.com/icohangar-ops/agent-conductor.git
cd agent-conductor
npm install
pip install -r engine/requirements.txt
npm test            # TypeScript tests (parser, skills, live engine bridge)
npm run test:engine # Python bridge protocol tests
npm run build
```

Register with Claude Code:

```bash
claude mcp add agent-conductor -- node /path/to/agent-conductor/dist/index.js
```

Or in any MCP client's JSON config:

```json
{
  "mcpServers": {
    "agent-conductor": {
      "command": "node",
      "args": ["/path/to/agent-conductor/dist/index.js"]
    }
  }
}
```

Set `CONDUCTOR_PYTHON` if your Python 3 lives somewhere other than `python3`.

Then, from any project that has an `AGENTS.md`:

> "Load this project's agent contract, list its verification gates, and run a
> decision_adversary pass on the change I'm about to make."

## Tool reference

### `contract_load`

Compile an AGENTS.md (or CLAUDE.md) into a structured contract. Accepts a
file path or a project directory; defaults to the current working directory.

```jsonc
// input
{ "path": "examples/pipeline-pulse" }

// output (abridged — real output from the bundled example)
{
  "source": "examples/pipeline-pulse/AGENTS.md",
  "title": "AGENTS.md — Pipeline Pulse CRM",
  "mission": "Pipeline Pulse CRM is a lightweight, local-first pipeline review dashboard...",
  "rules": [
    "Deterministic logic — same inputs → same scores, labels, and summaries...",
    "Logic in crm.js — keep main.js thin (fetch, render, events).",
    "... (6 total)"
  ],
  "layers": [
    { "layer": "src/crm.js", "role": "Domain logic",
      "do": "Deterministic scoring, filtering, summaries", "dont": "DOM manipulation" }
  ],
  "gates": [
    { "name": "Code change checklist", "commands": ["npm test"], "notes": "" },
    { "name": "Before completion", "commands": [], "notes": "npm test — all green...\n..." }
  ],
  "skills": [
    { "task": "CRM scoring / forecast changes", "skill": "obra/test-driven-development",
      "url": "https://github.com/obra/superpowers/...", "why": "Tests-first changes to deterministic logic" }
  ],
  "outOfScope": ["External CRM integrations (Salesforce, HubSpot, etc.)", "..."],
  "sectionCount": 28
}
```

The parser is **lossless**: sections it doesn't recognize are preserved
verbatim, so nothing in an unconventional AGENTS.md is dropped.

### `contract_verification`

Returns only the verification gates — the named checklists and shell commands
that must pass before work is handed off. Pair it with your agent's workflow:
run the commands, confirm success, then declare done.

### `skills_list`

Discover SKILL.md skills visible from a project root. Metadata only.

```jsonc
// input
{ "projectRoot": "examples/pipeline-pulse" }

// output
{
  "skills": [
    {
      "name": "pipeline-scoring",
      "description": "Explain and modify scoreDealRisk weights in src/crm.js with matching test updates...",
      "version": "0.1.0",
      "scope": "project"
    }
  ]
}
```

Search order (first hit per skill name wins):

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `<project>/.conductor/skills/*/SKILL.md` | project |
| 2 | `<project>/.claude/skills/*/SKILL.md` | project |
| 3 | `<project>/.cursor/skills/*/SKILL.md` | project |
| 4 | `~/.claude/skills/*/SKILL.md` | personal |
| 5 | `~/.cursor/skills/*/SKILL.md` | personal |

### `skill_load`

Load the full SKILL.md body for one named skill — the on-demand half of
progressive disclosure. Call it only when the task matches the skill's
description.

### `decision_gate`

The Consensus Hardening Protocol **R0 gate**: the cheapest, highest-leverage
check, run *before* doing the work.

```jsonc
// input
{ "solvable": true, "scoped": false, "valid": true, "worth_it": true }

// output
{ "verdict": "HALT", "results": { "Solvable": "PASS", "Scoped": "FATAL", "Valid": "PASS", "Worth_it": "PASS" } }
```

Any `FATAL` answer halts: stop and reframe before burning tokens on a
problem that isn't scoped, isn't understood, or isn't worth solving.

### `decision_adversary`

A one-shot adversarial pass for high-stakes changes: CHP attacks the claim's
foundations, scores them 0–100, and returns devil's-advocate findings plus a
session status.

```jsonc
// input
{
  "claim": "Change scoreDealRisk stale-activity weight from 20 to 30",
  "context": "Tests updated; label distribution checked against fixture"
}

// output
{
  "status": "EXPLORING",          // or HALT / REFRAME_REQUIRED
  "foundation_score": 77,
  "findings": [
    "Treat every financial number as unverified until tied to source data.",
    "Require explicit flip criteria for any provisional recommendation."
  ],
  "verification_failures": ["PENDING third-party validation"],
  "report": "## TriangulationRunner Adversary Pass\n..."
}
```

Statuses map to the CHP decision lifecycle
(`EXPLORING → PROVISIONAL_LOCK → LOCKED`, with `HALT` and
`REFRAME_REQUIRED` exits): `EXPLORING` means the claim survived the attack
and work may proceed toward a lock; `HALT`/`REFRAME_REQUIRED` mean the
foundations failed.

### `engine_status`

Health-check the Python engine subprocess. Returns
`{ ok, engine: "chp", version }`.

## What the parser recognizes

`contract_load` is convention-based, not schema-based. It extracts the
patterns AGENTS.md files in the wild actually use:

| Contract field | Source convention |
|----------------|-------------------|
| `mission` | First `Mission` / `Purpose` / `Overview` section |
| `rules` | List items under `Non-negotiables` > `Engineering rules` > generic `rules` (priority-ordered so a generic "Product rules" section never shadows explicit non-negotiables) |
| `layers` | First table with a `Layer` column under an architecture-like heading |
| `gates` | Shell code blocks + list items under checklist / verification / before-completion headings |
| `skills` | Tables with `Task` / `Skill` / `Why` columns; links resolved to text + URL |
| `outOfScope` | List under an out-of-scope / non-goals heading |
| `sections` | Everything, verbatim — the lossless fallback |

Headings inside code fences are ignored; tables tolerate emphasis in headers;
markdown links and emphasis are stripped from extracted text.

## Writing skills

A skill is a directory containing `SKILL.md` with YAML frontmatter:

```markdown
---
name: pipeline-scoring
description: Explain and modify scoreDealRisk weights in src/crm.js with matching test updates. Use when changing deal risk scoring, risk labels, or forecast thresholds.
version: 0.1.0
tools: [Read, Edit, Bash]
---

# Pipeline Scoring

Step-by-step instructions the agent follows when the task matches...
```

Quality bar (inherited from the
[awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)
standards): third-person description with matchable keywords, metadata around
100 tokens, body under 500 lines, no machine-specific absolute paths, declare
only the tools the skill needs.

The bundled example —
[examples/pipeline-pulse](examples/pipeline-pulse/AGENTS.md) — is a complete
real-world AGENTS.md plus a project-scoped skill, and is what the test suite
compiles.

## Project structure

```text
.
├── AGENTS.md                  # This repo's own contract (compiles with itself)
├── ARCHITECTURE.md            # Design decisions and component detail
├── src/
│   ├── index.ts               # stdio entrypoint
│   ├── server.ts              # MCP server: 7 tools
│   ├── contract/              # AGENTS.md → AgentContract compiler
│   ├── skills/                # SKILL.md loader + registry
│   ├── engine/chpBridge.ts    # Python engine client
│   └── utils/logger.ts        # stderr-only logging (stdout is the transport)
├── engine/
│   ├── bridge.py              # JSON-over-stdio router → PyPI `chp`
│   ├── requirements.txt       # consensus-hardening-protocol pin
│   ├── NOTICE.md              # attribution for the published engine
│   └── test_bridge.py         # protocol tests
├── examples/pipeline-pulse/   # real AGENTS.md fixture + example skill
└── test/                      # node:test suites (run the .ts directly)
```

## Development

```bash
pip install -r engine/requirements.txt
npm test            # TypeScript tests — includes a live engine round-trip
npm run test:engine # Python-side protocol tests
npx tsc --noEmit    # type check
npm run build       # emit dist/
npm run dev         # run the server from source (Node type stripping)
```

House rules (the full set is in this repo's own [AGENTS.md](AGENTS.md)):

1. **stdout is sacred** — the MCP transport owns it; all logging goes to
   stderr on both sides of the bridge.
2. **Zero new Node runtime dependencies** — only `@modelcontextprotocol/sdk`
   and `zod`; markdown/frontmatter stay hand-rolled. CHP is a PyPI dep.
3. **Erasable TypeScript only** — source must run under Node's type
   stripping (no enums, no parameter properties).
4. **CHP via PyPI** — install `consensus-hardening-protocol`; do not
   re-vendor under `engine/`. Protocol fixes belong upstream.
5. **Python 3.10+** — required by the published package.

## Roadmap

| Version | Theme | Scope |
|---------|-------|-------|
| **v0.2** | Enforcement | Execute `contract_verification` gates as real subprocesses and return pass/fail evidence — turning "reads the contract" into "enforces the contract" |
| **v0.3** | Orchestration | Expose `decision_lock` + mesh session tools over MCP (multi-agent deliberation on top of published CHP) |
| **v0.4** | Registry | Install vetted skills from remote catalogs (awesome-agent-skills format) with source-review prompts |

## Provenance

Conductor deliberately reuses proven components rather than rewriting them:

| Component | Source | License |
|-----------|--------|---------|
| Decision engine (PyPI) | [consensus-hardening-protocol](https://github.com/icohangar-ops/consensus-hardening-protocol) | MIT |
| MCP server + registry shape | [onchainmind](https://codeberg.org/cubiczan/onchainmind) | MIT |
| Skill quality standards | [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | — |
| Example fixture | Pipeline Pulse CRM operating manual | fixture |

See [engine/NOTICE.md](engine/NOTICE.md) and [ARCHITECTURE.md](ARCHITECTURE.md)
for the two-language design.

---

## Cubiczan stack

| Governance | [consensus-hardening-protocol](https://github.com/Cubiczan/consensus-hardening-protocol) · **agent-conductor** · [compliance-as-code-agent](https://github.com/Cubiczan/compliance-as-code-agent) · [cleanmandate](https://github.com/Cubiczan/cleanmandate) |
| Platform | [cubiczan-mcp-server](https://github.com/Cubiczan/cubiczan-mcp-server) · [operational-intelligence](https://github.com/Cubiczan/operational-intelligence) · [software-factory](https://github.com/Cubiczan/software-factory) |

Conductor compiles `AGENTS.md` + `SKILL.md` into MCP tools and routes high-stakes decisions through CHP — the same lock model [Metabocommand](https://github.com/Cubiczan/Metabocommand) uses for finance approvals.

## License

MIT — see [LICENSE](LICENSE). Vendored components retain their original MIT
licenses.
