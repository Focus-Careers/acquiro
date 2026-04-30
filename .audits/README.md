# .audits — Codebase Audit History

This directory stores structured audit reports for the Acquiro codebase.

## What's here

- **`current.md`** — The active audit. May be in any phase (AWAITING_REVIEW, PLAN_PENDING_APPROVAL, or COMPLETE).
- **`archive/`** — Completed audits, renamed `YYYY-MM-DD-<scope-slug>.md`.

## Why audits are committed

Audits are version-controlled so the full remediation history is traceable alongside the code changes that resulted from them. A commit message can reference an audit ID; the audit file shows what problem it solved and why.

## Workflow phases

1. **Phase 1 — Audit**: Code is read and findings are written to `current.md` incrementally.
2. **Phase 2 — Discussion**: User reviews findings and asks questions. `current.md` may be revised.
3. **Phase 3 — Plan**: Remediation plan is appended to `current.md`. Status → `PLAN_PENDING_APPROVAL`.
4. **Phase 4 — Execute**: Changes are made and logged in the Execution Log section. Status → `COMPLETE`.

When a cycle completes, `current.md` is archived and a fresh audit can begin.
