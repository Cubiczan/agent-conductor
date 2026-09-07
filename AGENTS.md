# AGENTS.md — Agent Conductor

Guidance for AI coding agents working in this repository. (Yes — Conductor's
own contract compiles with Conductor: `contract_load` on this file.)

## Mission

Agent Conductor turns AGENTS.md operating manuals and SKILL.md skills into an
active orchestration layer over MCP, with the Consensus Hardening Protocol
gating high-stakes decisions. Agents should keep the parser lossless, the
dependency surface near zero, and the MCP stdout stream protocol-clean.

## Architecture

| Layer | Role | Do | Don't |
|-------|------|----|-------|
| `src/contract/` | Contract compilation | Extract recognized AGENTS.md patterns; preserve unknown sections | Drop content the parser doesn't understand |
| `src/contract/workspace.ts` | Multi-root compile | Walk declared roots; merge layer tables and gates; fail closed | Invent or skip a root the map declared |
| `src/skills/` | Skill discovery | Frontmatter-only metadata on discovery; bodies on demand | Load bodies eagerly |
| `src/engine/` + `engine/bridge.py` | Decision engine boundary | Speak newline-delimited JSON over child stdio | Print logs to stdout on either side |
| `engine/vendor/cme/` | Vendored CHP core | Keep byte-identical to upstream except `__init__.py` | Edit vendored logic — fix upstream instead |
| `test/` | Regression guard | Test against the real example fixture | Mock the Python engine in engine tests |

## Engineering rules

### Non-negotiables

1. **stdout is sacred** — MCP transport owns process stdout; all logging goes to stderr on both sides of the bridge.
2. **Zero new runtime dependencies** — markdown/frontmatter parsing stays hand-rolled; only the MCP SDK and zod are allowed.
3. **Lossless compilation** — unrecognized AGENTS.md sections must survive into `contract.sections`.
4. **Erasable TypeScript only** — source must run under Node's type stripping (no enums, no parameter properties); `tsconfig` enforces `erasableSyntaxOnly`.
5. **Vendor discipline** — `engine/vendor/cme/` is upstream's code; changes belong upstream or in `bridge.py`.
6. **Engine runs on stdlib Python 3.9+** — no pip installs in the engine path.

### Code change checklist

```bash
npm test
npm run test:engine
npx tsc --noEmit
```

For server changes, also smoke-test over real MCP framing:

```bash
npm run build
# initialize + tools/list + one tools/call against dist/index.js
```

## Out of scope (unless explicitly requested)

- HTTP/SSE transports (stdio only for now)
- Executing contract gates as subprocesses (roadmap v0.2)
- Skill installation from remote catalogs (roadmap v0.4)
- Rewriting the CHP engine in TypeScript
