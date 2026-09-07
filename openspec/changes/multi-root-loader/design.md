# Design: Multi-root contract loader

## Decisions

1. **Explicit roots only.** No recursive crawl of every `AGENTS.md` in the
   tree. Callers declare roots via `roots`, `rootsFile`, or a well-known map
   under the project directory. Undeclared directories stay invisible.

2. **Fail closed.** A missing map file, empty map, empty path, non-directory
   root, or duplicate resolved path throws. The loader does not skip bad
   entries.

3. **Skill-only extra roots are allowed.** A declared root with no
   `AGENTS.md` / `CLAUDE.md` / `.agents.md` still contributes skills. The
   compile fails only when *no* declared root has a contract.

4. **Merge is concatenation plus first-hit-wins.** Layers and gates keep
   every row and record the root id. Rules and out-of-scope items de-dupe
   on exact string. Recommended skills de-dupe on skill name. Missions from
   more than one contract are labeled with the root id.

5. **Single-root shape is byte-compatible.** One declared root, or a path
   to an `.md` file, returns the existing `loadContract` object (no `roots`
   field). `examples/pipeline-pulse` stays on that path.

6. **Progressive disclosure is unchanged.** Token-budget plumbing is not
   present in this repo, so tools keep the cheap shapes they already use:
   no section bodies on `contract_load`, metadata only on `skills_list`.

## Map file locations (first hit wins)

- `.conductor/roots.json`
- `.conductor/roots`
- `conductor.roots.json`
- `conductor.roots`

JSON object `{ "roots": [...] }`, JSON array of paths, or line-oriented
`id: path` / `id = path` / bare path. Relative paths resolve against the
map file's directory.

## Gradle analogy

```text
module/src          → modules/billing
../shared/src       → shared/.conductor/skills
settings.gradle     → conductor.roots.json
```
