# AGENTS.md — Billing module

## Mission

The billing module computes deterministic invoice totals. Treat `shared/` as
an extra sourceSet: skills and helpers may live there even though they are
outside this module directory.

## Engineering rules

### Non-negotiables

1. **Deterministic invoices** — same line items → same totals.
2. **No silent fallback** — missing shared roots fail closed.

## Architecture

| Layer | Role | Do | Don't |
|-------|------|----|-------|
| `modules/billing/src` | Module sources | Invoice math | Resolve skills only from this directory |

## Code change checklist

```bash
npm -C modules/billing test
```
