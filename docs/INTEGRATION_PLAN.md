# Evolve Bank — technical integration plan

## What is working

- A responsive, Evolve-branded **static sandbox** with account views, USD→NGN demonstration conversion, and disabled withdrawals.
- Six open-source sources linked as **pinned submodules**, **not integrated**.
- Daily upstream-update watcher and an automated test for the illustrative quote calculator.

## Architecture target

```text
Evolve Bank Web / Mobile
    |
    +-- API + Customer profile / access control
    |      +-- KYC/KYB / sanctions and fraud checks (approved provider)
    |      +-- User balance projection
    |      +-- FX quote / quote expiry / disclosure and confirmation
    |      +-- Withdrawal request / bank beneficiary verification
    |      +-- Webhook authentication, deduplication and reconciliation
    |
    +-- SINGLE ledger of record (evaluate Blnk; do not duplicate)
    +-- Licensed bank/payment partners (account issuing, FX, NGN payout)
    +-- Queue workers, immutable audit and incident response
```

## Phase 0 — licensing, due diligence and business model

- Verify legal ability to market Evolve Bank and distribute the service.
- Agree which entity owns customer relationship and who safeguards customer money.
- Get *written* approval for USD account issuance, eligible residency/beneficiaries, conversion and NGN payouts.
- Agree funding routes, FX limits, rate quote lifecycle, settlement delays, chargebacks, error remedies and SLA.

## Phase 1 — one working provider in sandbox

- Define provider-agnostic API and immutable intent states (created, quoted, approved, funding, converting, payout_pending, settled, failed, refunded).
- Introduce customer onboarding and sanctions/AML gates.
- Integrate one **sandbox** issuer/FX/payout provider only after commercial eligibility check.
- Verify incoming transfers with authenticated webhooks and independent provider status lookup.

## Phase 2 — one financial ledger

- Choose one system of record. Blnk is a candidate. Fineract is an alternative, **not a second ledger**.
- Post double-entry movements in the correct currency using integer minor units.
- Enforce idempotency and concurrency safety; ensure no overdraw or duplicate external payouts.
- Reconcile provider balances and settlement reports daily. Test partial failure and retry.

## Phase 3 — real-money gate

- Complete independent security, privacy and regulatory review; red-team access control.
- Run end-to-end reconciliation, dispute handling, penetration testing and incident drills.
- Add customer support, monitoring, FX disclosures, limits and audit retention.
- Only enable real transactions once a regulated partner has approved the integration.

## Source roles

- **NeoBank / Flux:** independently runnable reference apps and UX patterns, not real-world bank rails.
- **Blnk:** candidate live ledger after integration and review.
- **Fineract:** optional alternative core, excluded from the initial critical path.
- **Corridor:** transfer-state-machine/recovery reference, not a proven payable corridor.
- **Kudi Arc:** testnet crypto research. Keep separate from fiat banking and disabled in consumer sandbox.

**No live banking integration, legal approval, real money service or production-grade security certification is implied by this repository.**
