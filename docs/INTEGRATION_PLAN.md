# Evolve Bank — integration and independent-monorepo plan

## Monorepo mechanics

Six licensed projects are **vendored as ordinary tracked source files**, not Git submodules. The monorepo contains a native Evolve sandbox app and several **separate unintegrated codebases** for evaluation. They share a Git repository but **do not yet share one runtime, dependency graph, API, database or financial ledger**. Avoid prematurely merging different ledger and settlement models.

## Architecture target

```text
Evolve web/mobile
    -> identity/KYC/customer profile
    -> bank & FX provider adapter (approved providers only)
    -> payment intention orchestration + idempotency
    -> ledger system of record (ONE, candidate: Blnk)
    -> signed webhook/settlement reconciliation
    -> support/admin/audit/incident response
```

## Priorities

1. Regulatory and partner due diligence: confirm precisely which legal entity supplies foreign receiving accounts, permits customers to convert currency, safeguards funds, and disburses NGN.
2. User registration, customer onboarding/KYC, sanctions/AML screening, account and recipient verification.
3. Approved provider sandbox integration; deterministic intent state machine, clear quoted FX rates, fees, quote expiry and retry handling.
4. Select and integrate exactly **one** ledger-of-record solution; use integer minor units, balanced entries, no overdrafts, and an audit log.
5. Secure provider webhooks, deduplication, refund paths, reconciliation, alerts, administrator control and dispute handling.
6. Independent security audit, financial invariants, privacy review, fraud controls and test evidence before real-money release.

### Source roles

- **NeoBank** and **Flux**: demo UI and workflow references; portfolio simulations do not provide real USD accounts.
- **Blnk**: a ledger candidate.
- **Fineract**: a separately evaluated alternative core; not to be run alongside Blnk as competing sources of customer balances.
- **Kudi Arc**: crypto/testnet research; disabled from fiat banking launch.
- **Corridor-in-a-Box**: cross-border orchestration reference; real payout partner confirmation not established here.

## Branding status

The native `apps/portal` is branded Evolve Bank. `scripts/brand_upstreams.py --apply` is a limited UI-brand overlay for NeoBank and Flux, **not** a universal bank/provider connector or systematic brand migration. Original legal notices and sandbox warnings remain.

## Release gate

Do not enable genuine cash-in, FX execution, wallet funding, or bank withdrawals until signed partner agreements, compliant permissions and full end-to-end security and settlement tests exist.
