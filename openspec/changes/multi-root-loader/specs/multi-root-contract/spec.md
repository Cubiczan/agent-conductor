# multi-root-contract Specification

## Purpose

Compile one agent contract and discover skills across declared workspace
roots, including extra source trees that live outside a module directory.

## Requirements

### Requirement: Declared roots are the only trees walked

The loader SHALL accept an inline list of roots or a roots map file. It
SHALL NOT invent roots by recursively scanning the filesystem for
`AGENTS.md` files that were never declared.

#### Scenario: Map file lists workspace, module, and extra source root

- **WHEN** a project contains `conductor.roots.json` naming `.`,
  `modules/billing`, and `shared`
- **THEN** `loadWorkspace` walks exactly those three directories

### Requirement: Missing declared roots fail closed

The loader SHALL throw when a declared root does not exist, is not a
directory, is an empty path, or when the roots map file is missing or
declares no roots. It SHALL NOT skip the bad entry and continue.

#### Scenario: Map points at a directory that is not on disk

- **WHEN** a roots list includes `modules/missing`
- **THEN** resolution throws an error whose message includes `missing`

### Requirement: One compiled contract with merged layers and gates

The loader SHALL emit a single `AgentContract` whose `layers` and `gates`
contain every extracted row from every contract found under the declared
roots, each tagged with the root id. Recommended skills SHALL de-dupe by
skill name (first hit wins).

#### Scenario: Workspace and billing both declare verification commands

- **WHEN** the workspace contract lists `npm test` and the billing
  contract lists `npm -C modules/billing test`
- **THEN** the compiled contract's gates include both commands

### Requirement: Skills resolve outside the module directory

Skill discovery SHALL scan project-scope skill directories under every
declared root before scanning personal scopes once. First hit per skill
name wins.

#### Scenario: Shared skill lives beside the module, not inside it

- **WHEN** `shared-ledger` exists at
  `shared/.conductor/skills/shared-ledger/SKILL.md` and `shared` is a
  declared root
- **THEN** `discoverSkillsFromRoots` returns `shared-ledger`
- **AND** a walk of `modules/billing` alone does not

### Requirement: Progressive disclosure stays cheap

`contract_load` SHALL omit section bodies, `contract_verification` SHALL
return gates (and roots metadata when present), and `skills_list` SHALL
return frontmatter metadata only. `skill_load` SHALL remain the on-demand
body loader. If a token-budget parameter exists, these tools SHALL honor
it; this repository has none, so the existing cheap shapes are the budget.

#### Scenario: Listing skills does not load bodies

- **WHEN** skills are discovered from a multi-root workspace
- **THEN** each summary item has no `body` field

### Requirement: Single-root behavior is preserved

A path to an `AGENTS.md` file, or a directory with no roots map, SHALL
compile through the existing single-root path and SHALL NOT attach a
`roots` field.

#### Scenario: Pipeline Pulse has no roots map

- **WHEN** `loadWorkspace` is given `examples/pipeline-pulse` or its
  `AGENTS.md`
- **THEN** the compiled rules, layers, gates, and skills match
  `loadContract` on that file
