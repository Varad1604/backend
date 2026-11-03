# Module build-prompt template (AI development protocol, Master Build Prompt §10)

Copy this template for every AI-assisted module task. Keep prompts **module-scoped** —
never point an agent at the whole repository. Small diffs, fast human review.

---

## Context header (paste at the top of every module prompt)

```text
You are building ONE module of the KPMPL Gate-to-Bill system.

GOVERNING DOCUMENTS (read first, in this order):
1. KPMPL_Master_Build_Prompt_v1.0.md  — frozen invariants (§3), module boundaries (§4.3),
   security controls (§9), blocked rules (§14), builder rules (§16)
2. The normative doc files for this module (see map in §2)

FROZEN INVARIANTS YOU MUST NOT VIOLATE:
- One shared API (/api/v1) for web and future mobile; never invent a second API.
- DataMan ERP: never write to it, never claim live reads; ERP facts are manual
  staff confirmations stored with verifiedBy/recordedAt/source.
- Seven independent state domains; never collapse into one status column.
- Official ERP references are opaque strings (preserve zeros/suffixes like "0008-HO").
- No forced invoice↔GRN↔visit cardinality; link tables only.
- Backend enforces every permission, validation and state transition.
- No invented business rules: deduction formula, QC authority, document checklist,
  exit eligibility and reminder channels are CLIENT-BLOCKED (§14). Stubs only.
- Audit is append-only: corrections create versions, never overwrite history.
- All fixtures/data are synthetic with DEMO- prefixes; never place real KPMPL data
  in code, prompts, logs or fixtures.

MODULE UNDER WORK: <module name — e.g. receiving>
SCOPE OF THIS TASK: <one or two sentences>
CONTRACT: packages/contracts/openapi/openapi.yaml is the source of truth. If the
endpoint/shape is missing, STOP and propose a contract change instead of improvising.

DEFINITION OF DONE FOR THIS TASK: <paste the phase DoD rows that apply>
```

## Guardrails (repeat at the end of every module prompt)

- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before declaring done.
- Every new use case ships with unit tests; state transitions live in `packages/domain`
  as pure functions.
- Never paste confidential client documents or ERP screenshots into any AI context.
- If a spec gap requires a client-blocked rule to become real, STOP and file a
  D-register question — never guess.
