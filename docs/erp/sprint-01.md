# Elhelw ERP — Sprint 1 foundation
Status: draft, not deployed.
Single company; incremental migration; preserve legacy application and data.
## Acceptance gates
- Separate test database; no production writes.
- RBAC with multiple roles and per-user allow/deny; deny takes precedence; server enforcement.
- Item master: RM, ADD, GB, RB, GC, FB, PK, FG; unique SKU; base UOM; explicit conversions; decimal quantities.
- Setup dependencies validated by server, not checkbox state.
- Legacy IDs mapped explicitly; no inferred opening balances.
- Stock ledger and accounting posting atomic and idempotent; no negative stock; reversals instead of deleting posted transactions.
## Manufacturing
Four independent green recipes (plain, spiced, French, hazelnut); pre-roast blending; spice before/during grinding; flavors after grinding. Independent or linked operations; lot genealogy, split/merge; configurable QC. Moving weighted average; full absorption costing; prior-month overhead rate with month-end reconciliation.
## Sales
Separate online, distributor and direct stock allocations. Preserve distributor cash custody and company-funded refunds. Website integration must reconcile reservations and avoid duplicate deductions.
## Delivery
First implement isolated master data and authorization; then inventory and accounting foundations before enabling any stock posting. Test permissions, migration reconciliation, concurrent posting and rollback before cutover.
