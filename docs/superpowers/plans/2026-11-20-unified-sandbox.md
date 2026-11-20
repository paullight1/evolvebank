# Unified Banking Sandbox Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps are tracked below; the user has authorized implementation.

**Goal:** Complete and verify the simulated USD-to-NGN withdrawal flow in one Evolve application.

**Architecture:** React portal → NestJS API → persistent PostgreSQL intentions and Blnk ledger. A signed deterministic provider simulator closes payout state transitions. Only Blnk supplies runtime balances.

**Tech Stack:** TypeScript, React, Vite, NestJS, PostgreSQL, Blnk, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-unified-sandbox-design.md`

## Global constraints

- Sandbox only; never expose provider keys or seed secrets in client code.
- Preserve all six upstream snapshots and their provenance.
- Store integer minor units as strings; customer balances never overdraw.
- `packages/banking/contracts.ts` defines shared store, ledger and domain response types.

## Review focus

- Replay after ledger success but before local completion must not duplicate value.
- Two concurrent withdrawals must never spend the same available balance.
- Reused/expired quotes and mismatched idempotency payloads must fail.
- A terminal failed payout followed by a conflicting success event must not move funds.
- API session ownership and raw-body signatures must reject cross-customer or forged requests.

## Tasks

### 1. Banking domain and transaction invariants

- [x] Implement `BankingService` in `packages/banking/service.ts`, with tests in `tests/banking.test.ts` and test-only memory adapters.
- [x] Persist immutable quotes and operation intentions before ledger posts; serialize mutations through `Store.withLock`.
- [x] Test the exact $100/₦99,000 flow, failed reservations, expiry, reuse, concurrent spend, deduplication and recovery.

### 2. Blnk adapter

- [x] Implement `BlnkLedger` in `packages/ledger/blnk.ts`, using `Ledger`/`Store` contracts.
- [x] Persist ledger/balance IDs, verify stable references, post same-currency FX legs atomically, and reject unknown effects.
- [x] Exercise real HTTP payloads and failures with contract tests; add real-service smoke verification when available.

### 3. API, storage and runnable stack

- [x] Implement PostgreSQL store, NestJS routes, session isolation, signed webhook verification and origin/body limits.
- [x] Add container build, pinned-source Blnk stack, database initialization and environment template.
- [x] Test API transaction flow and session/security boundaries using the actual HTTP server.

### 4. Unified customer portal

- [x] Build responsive React overview, funding, exchange, payout/history and reconciliation views in `apps/portal`.
- [x] Connect every action to the documented API; retain idempotency keys through retries and show pending/failure states clearly.
- [x] Verify complete customer flow at desktop and mobile widths with browser evidence.

### 5. Review and delivery

- [x] Run typecheck, production build, financial/API/adapter tests and source-provenance verification.
- [x] Obtain independent code review and resolve material defects.
- [x] Commit and push isolated branch; open a pull request with evidence and precise limitations.

## Verification evidence

- Typecheck, API and portal production builds, 47 tests, source snapshot verification, and `git diff --check` passed.
- A real PostgreSQL, Redis, pinned-source Blnk and NestJS stack completed the $100 → ₦99,000 journey, failure/retry/success, reconciliation with zero differences, and an API/ledger restart.
- Real ledger fault checks recovered two deliberately lost posting responses and verified compensation after an atomic bulk rollback.
- Independent review identified and resolved JSONB key-order-sensitive ledger fingerprints, mixed-case API guard bypasses, and the development portal origin allowlist.
- GitHub Actions verified the real Compose stack, restart/replay, lost responses, atomic rollback, and all four desktop/mobile browser tests (complete journey and saved-intent recovery at each viewport). [First complete passing run](https://github.com/paullight1/evolvebank/actions/runs/44779161342).
- Desktop and mobile screenshots were visually inspected; the unfocused skip link was clipped to avoid full-page capture artifacts, and the quote clock is refreshed when a new quote arrives.
- Implementation is proposed in [pull request #3](https://github.com/paullight1/evolvebank/pull/3). The PR checks record the latest commit verification; main has not been merged or deployed.
