# Unified banking sandbox — Phase 2.1

The user approved the React, NestJS, PostgreSQL and Blnk architecture and the first complete simulated USD receipt → USD/NGN conversion → NGN payout milestone. This document records implementation choices within that approval.

## Goal

One responsive Evolve customer portal can start an isolated demo session, receive fictitious USD, accept an expiring quote, reserve an NGN payout, simulate its success or failure, and inspect transaction history and reconciliation. Every screen clearly identifies simulated funds. A failed payout returns the reservation once; replayed requests never duplicate money movements.

## Approach and boundaries

Extend `apps/portal` as a React/Vite application using the existing kit's green/white identity, with a NestJS API under `apps/api` and a shared TypeScript banking domain. The other six vendored projects remain pinned reference/source modules. Reusing both Flux and NeoBank runtimes would create competing sessions and balance authorities; wholesale import of either is unnecessary for this milestone. The original quote arithmetic remains tested.

PostgreSQL stores customer/session records, immutable quotes, idempotency intentions, provider simulation events and ledger identifiers. Blnk alone owns spendable and reserved balances in the runnable stack. A memory ledger exists exclusively as a test double. Blnk builds from `upstreams/blnk` at its recorded source revision, avoiding an unverified mismatch with the vendored compose image tag.

## Contracts and behavior

- API prefix `/api`; same-origin HTTP-only session cookies; isolated anonymous demo customers, not production identity/KYC.
- `POST /sandbox/sessions`, `DELETE /session`, `GET /dashboard`.
- `POST /sandbox/funding` `{amount:"100.00"}` with `Idempotency-Key`.
- `POST /quotes` `{amount:"100.00"}` returns a 2-minute, customer-bound quote.
- `POST /exchanges` `{quoteId}` with `Idempotency-Key`.
- `POST /payouts` `{amount:"99000.00",beneficiary:"Sandbox recipient"}` with `Idempotency-Key`.
- `POST /sandbox/payouts/:id/settle` `{outcome:"succeeded"|"failed"}` calls the signed simulated-event verifier; event/intent matching and terminal-state rules apply.
- `GET /reconciliation`; `POST /provider/webhook` checks HMAC over timestamp and exact raw body, replay window, amount, currency and operation ownership.
- Amounts are validated decimal strings converted to bigint minor units, serialized as integer strings. Demo FX remains exactly ₦1,000/$1 with a $1 fee; it is not a market rate.
- FX atomically debits customer USD to fee/treasury accounts and credits customer NGN from a seeded treasury. No customer source permits overdraft.
- Payout reservation transfers NGN to that customer's hold account. Success moves hold to the sandbox paid account; failure moves it back. A provider timeout never releases a hold automatically.
- Durable intentions precede external ledger effects. Stable posting references and lookups recover response loss/restart safely. Same idempotency key with different payload fails.
- Per-customer database advisory locks serialize mutations across API workers; ledger constraints remain the final balance guard. Store writes commit independently so a process crash does not erase recorded intentions.
- Reconciliation compares each expected ledger leg and simulated provider statement. Unknown/partial effects remain in review, never reported as settled.

## Acceptance and scope limits

Test $100 receipt → $100 conversion ($1 fee) → ₦99,000 payout, success and failure, duplicate clicks, quote expiry/reuse, concurrent withdrawals, lost ledger responses, customer isolation, signed event tampering/replay, and persistence. Verify desktop and 390px mobile UI. Provide a reproducible container stack and CI gates.

This milestone does not implement real accounts, live providers, real KYC, production password/MFA, lending/cards, or bank administration. Provider selection and approvals remain later work. The existing sandbox boundaries and upstream licence notices remain in force.
