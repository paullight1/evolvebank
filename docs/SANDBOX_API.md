# Sandbox API and operations

All endpoints are under `/api`. Requests use JSON. Monetary form values are decimal strings (`"100.00"`); monetary responses use integer minor-unit strings (`"10000"`). USD and NGN both use two decimal places. The fixed demonstration rate is ₦1,000 per USD and the conversion fee is $1; quotes expire in two minutes. Funding/conversion limit: $10,000 per request. Payout limit: ₦9,999,999.99 per request.

## Endpoints

| Method | Path | Request / purpose |
| --- | --- | --- |
| GET | `/health` | App/DB/Blnk readiness; no account data |
| POST | `/sandbox/sessions` | `{}`; creates an isolated demo customer and HTTP-only cookie |
| DELETE | `/session` | Revokes the current demo session |
| GET | `/dashboard` | Customer, USD/NGN available/held wallets, operation history |
| POST | `/sandbox/funding` | `{"amount":"100.00"}` + `Idempotency-Key` |
| POST | `/quotes` | `{"amount":"100.00"}`; immutable customer-bound quote |
| POST | `/exchanges` | `{"quoteId":"..."}` + `Idempotency-Key` |
| POST | `/payouts` | `{"amount":"99000.00","beneficiary":"Sandbox recipient"}` + `Idempotency-Key` |
| POST | `/sandbox/payouts/:id/settle` | `{"outcome":"succeeded"}` or `"failed"`; own session only |
| GET | `/reconciliation` | Actual postings, wallets and simulated event comparison |
| POST | `/provider/webhook` | Authenticated raw-body simulated provider event |

Idempotency keys are 16–128 ASCII letters, digits, underscores or hyphens. Use a UUID per intention. Retain the same key and original body when a request times out. Reusing a key for a different semantic payload or operation type returns `409`. An unresolved posting returns `503` and leaves a recoverable operation; do not invent a new key to bypass it.

Session cookies expire after 24 hours. These anonymous customer identities are exclusively for the sandbox. The compose stack exposes only `127.0.0.1:3000`; never treat its localhost HTTP configuration as a production internet-facing setup.

## Accounting

| Intention | Entries |
| --- | --- |
| Demo USD receipt | External sandbox funding USD → customer USD |
| $100 FX example | Customer USD → USD treasury $99; customer USD → USD fee $1; NGN treasury → customer NGN ₦99,000 |
| Payout reservation | Customer NGN → that customer's NGN hold |
| Successful simulated payout | Customer NGN hold → sandbox paid NGN |
| Failed simulated payout | Customer NGN hold → customer NGN |

FX legs are one synchronous atomic Blnk batch. Every leg is checked by stable reference and complete immutable transaction data; a bulk summary alone is insufficient. The adapter also looks for Blnk compensating refunds so an `APPLIED` original that was rolled back cannot falsely pass reconciliation. Only designated external sandbox funding balances may overdraw. NGN treasury is initialized once with bounded fictitious liquidity.

PostgreSQL saves intentions before ledger I/O. Advisory locks serialize each customer's mutations across API workers; Blnk enforces actual spendability. Application writes commit independently, allowing a restart to recover the durable intent through its original posting reference. JSONB object key order does not affect semantic request hashes.

## Provider simulator and signatures

The UI simulator produces the same signed event accepted by the webhook verifier. It is a local simulator, not a financial-provider integration.

The event body contains `id`, `customerId`, `operationId`, `outcome`, `amountMinor`, `currency:"NGN"` and `createdAt`. The receiver requires:

- `X-Evolve-Timestamp`: integer Unix seconds, within five minutes of server time.
- `X-Evolve-Signature`: lowercase hex HMAC-SHA256 over `<timestamp>.<exact raw JSON bytes>`, keyed by `SANDBOX_WEBHOOK_SECRET`.
- Exact operation/customer/amount/currency match and a confirmed pending reservation.

Repeated event IDs with identical contents are idempotent. A reused event ID with changed contents is rejected. Once a provider outcome is persisted, a conflicting later outcome is rejected even if a process stopped before saving the operation update. Real provider signing formats will require their own adapters.

## Recovery and reconciliation

Retry the original request after a temporary error. The portal retains the original payload and key and can reconstruct a pending intention from the server after browser storage is lost. Pending payout simulation can be repeated safely. Unknown ledger effects remain in review; partial batches are not blindly resubmitted.

Reconciliation verifies all expected postings, matches simulated payout statements and compares expected available/held totals to Blnk's actual balances. It never changes a balance. A detected discrepancy blocks new funding, conversions and payout requests until a clean reconciliation; recovery of already recorded intentions and matching settlement remains available.

This small sandbox uses a generic JSONB record table and bounded request bodies. It does not provide production-scale indexed history, retention/purge administration, automated recovery queues, a full operator console, real identity verification or real provider-statement ingestion. Persistent volumes hold demonstration state; `docker compose stop` preserves them. Delete volumes only when deliberately discarding all local test history.
