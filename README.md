# Evolve Bank

**Evolve-branded multicurrency banking and exchange development monorepo.**

> **SANDBOX ONLY.** No live USD receiving accounts, deposits, exchange execution, bank withdrawals, custody or licensed banking services. Evolve Bank is a prototype name; launch requires a qualified regulated provider and legal approval.

## Repository structure

```text
apps/portal/                   Unified React customer sandbox
apps/api/                      NestJS sessions, banking API and signed event receiver
packages/banking/              Exact money, quote and payout workflow rules
packages/ledger/               Blnk adapter; authoritative runtime balances
packages/storage/              PostgreSQL workflow metadata and advisory locks
compose.yaml                   Local app + PostgreSQL + Redis + pinned-source Blnk
upstreams/neobank/             Full NeoBank project source snapshot (MIT)
upstreams/flux/                Full Flux project source snapshot (MIT)
upstreams/blnk/                Full Blnk ledger source snapshot (Apache-2.0)
upstreams/fineract/            Full Apache Fineract source snapshot (Apache-2.0)
upstreams/kudiarc/             Full Kudi Arc source snapshot (MIT)
upstreams/corridor/            Full Corridor-in-a-Box source snapshot (Apache-2.0)
scripts/vendor-sources.sh      Repeatable, pinned-source import procedure (GitHub runner)
scripts/brand_upstreams.py     Presentation-only Evolve branding overlay
upstreams.lock.json            Source versions, copyright and licence inventory
docs/                          Integration plan, licence and provenance
```

**Independent source snapshots.** All six upstream projects are imported as regular tracked monorepo files—not Git submodules, gitlinks, Git LFS references or GitHub repository links. `git clone https://github.com/paullight1/evolvebank.git` retrieves the complete source snapshot without `--recurse-submodules`. The clone still needs normal package-manager dependencies and, for real transactions, independently authorised bank/payment APIs; “independent” does not mean all third-party runtime dependencies are vendored.

**Import verification:** `git ls-files --stage | grep '^160000 ' || echo 'No Git submodules'` and inspect `upstreams/`. Imported source revisions are listed in [upstreams.lock.json](upstreams.lock.json). The automated watcher compares those pinned revisions to upstream changes; it **does not** overwrite local code.

The original projects' names remain in their copyright/licence notices and technical provenance. Evolve Bank's own presentation layer uses Evolve branding. Original demos and FX example flows remain **sandbox-only**, and none of the sources are a ready-to-launch regulated bank.

## Start the unified sandbox

Node.js 22.12+ and Docker with Compose are required. The containers use Node 24. From a fresh clone:

```bash
git clone https://github.com/paullight1/evolvebank.git
cd evolvebank
npm run setup:sandbox
docker compose up --build --wait
# Visit http://localhost:3000
```

Setup generates fresh local secrets in the ignored `.env` file and preserves an existing configuration. The first container build compiles the pinned Blnk source; subsequent builds reuse the cache. Only the application is exposed, on loopback port 3000. `docker compose stop` preserves the PostgreSQL and Redis volumes.

### Try the complete flow

1. Select **Open sandbox** to create an isolated anonymous demo customer.
2. Add **$100.00** of demo USD.
3. Open **Exchange**, request a quote, and confirm before its two-minute expiry.
4. At the deliberately fictitious **₦1,000 per USD** rate, a **$1 fee** leaves **₦99,000.00** in the demo NGN wallet.
5. Request a **₦99,000.00** demo payout to a fictional recipient label. Funds move to a reserved balance.
6. Choose **Simulate failure** to return the reservation, or **Simulate success** to complete it.
7. Run **Reconcile** and inspect transaction history. Pending funds remain unspendable.

These are simulated ledger movements only. No receiving account numbers, real bank beneficiaries, external payment providers, or real funds are involved.

### Implemented in Phase 2.1

- One responsive React portal and one NestJS API, using the existing Evolve brand colours.
- Anonymous 24-hour demo sessions with HTTP-only cookies and isolated customers.
- Blnk-backed USD/NGN wallets, same-currency atomic FX entries, explicit fees and payout reservations.
- Persistent operation intentions, stable posting references, idempotent retries, quote ownership/expiry and safe recovery after lost responses.
- Simulated payout success/failure with signed raw-body event verification, event deduplication and immutable terminal outcomes.
- Reconciliation against actual Blnk postings, customer balances and simulated provider statements; detected discrepancies gate new money actions.
- PostgreSQL advisory locks across API workers and database connection recovery.

### Development and verification

```bash
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run verify:sources
# With the Compose stack running:
npm run test:stack
npx playwright install chromium
npm run test:e2e
```

The test suite includes a disposable native PostgreSQL instance, financial invariants, HTTP API isolation/signatures and Blnk contract checks. CI additionally builds the pinned Blnk source, executes the real stack, restarts the API/ledger, and runs desktop/mobile browser journeys. Browser evidence is attached to the workflow run.

For frontend development, `npm run start:portal` serves Vite at port 4173 and proxies `/api` to the API at port 3000. For API development outside Compose, configure `APP_ENV=sandbox`, `DATABASE_URL`, `BLNK_URL`, `BLNK_API_KEY` and `SANDBOX_WEBHOOK_SECRET`, then run `npm run dev:api`. Runtime balances always come from Blnk; memory adapters are test-only.

See [sandbox API and operations guide](docs/SANDBOX_API.md), [design](docs/superpowers/specs/2026-11-20-unified-sandbox-design.md) and [implementation plan](docs/superpowers/plans/2026-11-20-unified-sandbox.md).

## Core banking architecture

Blnk is the **single ledger of record in the sandbox**; PostgreSQL stores workflow metadata, not independently spendable balances. Fineract remains a separate alternative. The stack builds from `upstreams/blnk` at the revision in `upstreams.lock.json`, instead of assuming an upstream image tag matches that snapshot. Follow [integration plan](docs/INTEGRATION_PLAN.md) for the later provider, identity and release work.

The demo-session mechanism is not production authentication or KYC. Production identity/MFA, regulated provider accounts, actual statement reconciliation, fraud controls, administrator approvals and independent security review remain outside Phase 2.1. Keep the local stack private; this is not a public production deployment configuration.

## Responsible source reuse

| Project | Licence | Intended role |
| --- | --- | --- |
| [NeoBank](https://github.com/dawidolko/NeoBank-Platform-Nuxt) | MIT | Retail banking UX and transfer/ledger reference |
| [Flux](https://github.com/SamABZD/flux) | MIT | Multicurrency user experience |
| [Blnk](https://github.com/blnkfinance/blnk) | Apache-2.0 | Ledger evaluation |
| [Apache Fineract](https://github.com/apache/fineract) | Apache-2.0 | Full core banking alternative |
| [Kudi Arc](https://github.com/KudiArc/kudi-arc) | MIT | Crypto FX testnet research |
| [Corridor-in-a-Box](https://github.com/corridor-in-a-box/corridor-in-a-box) | Apache-2.0 | Cross-border orchestration reference |

`davidakpele/epay-payment-system` is excluded because no licence permitting reuse was verified. Every included source retains its own licence, copyright and NOTICE documents as present. There is no endorsement or affiliation with their maintainers. See [provenance](docs/LICENCES_AND_PROVENANCE.md).

## Updating source snapshots

The daily GitHub watcher opens an issue for review when any upstream head changes. Updates are **not automatic**. Confirm licences/security, manually import the intended pinned commit in a review branch, reconcile brand overlays, and run independent tests before approval.

**Evolve Bank — money without borders, responsibly built.**
