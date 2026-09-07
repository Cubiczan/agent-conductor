# Proposal: Multi-root / monorepo AGENTS.md + SKILL.md loader

## Why

A Gradle module whose `sourceSet` points outside the module directory is a
real tree the build sees, but it is invisible to a loader that only walks
the module folder. The same gap exists for AGENTS.md / SKILL.md: shared
skills often live beside modules, not inside them. Conductor needs an
explicit, fail-closed way to walk those extra roots and still emit one
compiled contract.

## What Changes

- Accept a declared roots list or a roots map file.
- Discover `AGENTS.md` and `SKILL.md` across every declared root.
- Fail closed when a declared root (or the map file) is missing.
- Merge layer tables and verification commands into a single `AgentContract`.
- Keep progressive disclosure: `contract_load` / `contract_verification` /
  `skills_list` stay summary-shaped; `skill_load` still loads bodies on demand.
- Add a multi-module fixture whose skills sit outside the module directory.
- Document the layout in a README monorepo cookbook.
- Leave `examples/pipeline-pulse` single-root behavior unchanged.

## Capabilities

### New Capabilities

- `multi-root-contract`: compile one contract from declared workspace roots.

### Modified Capabilities

- None. Single-root `loadContract` / `discoverSkills` remain the default when
  no roots list or map is present.

## Impact

- `src/contract/` gains a roots resolver and workspace merger.
- `src/skills/` walks each declared project root before personal scopes.
- MCP tools accept optional `roots` / `rootsFile` without breaking `path` /
  `projectRoot`.
- New fixture and tests; README cookbook.
