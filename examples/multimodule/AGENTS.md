# AGENTS.md — Multi-module workspace

Workspace-level operating manual for a Gradle-style multi-module tree.

## Mission

A billing product split across a module directory and an extra source root.
The billing module owns invoices; shared skills and helpers live outside
that module directory — the same shape as a Gradle `sourceSet` that points
at `../shared`.

## Architecture

| Layer | Role | Do | Don't |
|-------|------|----|-------|
| `modules/billing` | Billing module | Invoice totals, tax rules | Assume skills live only inside this module |
| `shared` | Extra source root | Cross-module skills and helpers | Treat this directory as a Gradle submodule |

## Code change checklist

```bash
npm test
```

## Out of scope

- Installing remote skill catalogs
- Rewriting the CHP engine in TypeScript
