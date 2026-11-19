# Evolve Bank

**An Evolve-branded multi-currency exchange and cross-border payments development workspace.**

> **SANDBOX ONLY — No real bank accounts, customer funds, live FX rates, deposits or payouts.** Evolve Bank is a working product *prototype*, not a licensed bank. The name must be legally reviewed before any commercial launch.

## What is here

- `apps/portal/` — runnable green-and-white Evolve Bank demo for USD, NGN, EUR and GBP accounts, an illustrative USD→NGN quote and disabled withdrawal flow.
- `upstreams/` — **six pinned open-source Git submodules**, linking to the original upstream code with its history and licence intact. These are *not yet integrated banking services*.
- `upstreams.lock.json` — exact reviewed source names, branches and SHAs.
- `.github/workflows/upstream-watch.yml` — daily monitor that opens or updates a GitHub issue when upstream source branches change. It does not auto-upgrade financial software.
- `scripts/brand_upstreams.py` — optional local, presentation-layer **Evolve Bank** branding for NeoBank and Flux sandboxes, preserving attribution.
- `docs/` — implementation sequence and source/licensing obligations.

## Quick start

```bash
git clone https://github.com/paullight1/evolvebank.git
cd evolvebank
npm test
npm run start:portal
# Open http://localhost:4173
```

No dependencies are required for the Evolve demo beyond Node.js 20+. The quote is deliberately fictitious: **1 USD = ₦1,000, with a $1 example fee**. It cannot execute.

## Get the upstream source code

```bash
git submodule update --init --recursive --jobs 4
# For local presentation-only white-labelling (optional):
python3 scripts/brand_upstreams.py
```

A clone without `--recurse-submodules` contains only pointers; clone with:

```bash
git clone --recurse-submodules https://github.com/paullight1/evolvebank.git
```

**Important:** Git submodules reference the exact complete upstream repositories; their source files are downloaded to your computer when initialized. They are **not copied as ordinary tracked files inside evolvebank**. This reduces duplicate code, protects provenance and lets the six projects be monitored safely.

## Source components

| Path | Project | Licence | Purpose |
| --- | --- | --- | --- |
| `upstreams/neobank` | [dawidolko/NeoBank-Platform-Nuxt](https://github.com/dawidolko/NeoBank-Platform-Nuxt) | MIT | Retail banking demo UI and double-entry ledger reference |
| `upstreams/flux` | [SamABZD/flux](https://github.com/SamABZD/flux) | MIT | Multicurrency finance UX reference |
| `upstreams/blnk` | [blnkfinance/blnk](https://github.com/blnkfinance/blnk) | Apache-2.0 | Candidate ledger system of record |
| `upstreams/fineract` | [apache/fineract](https://github.com/apache/fineract) | Apache-2.0 | Alternative full core banking system; evaluation only |
| `upstreams/kudiarc` | [KudiArc/kudi-arc](https://github.com/KudiArc/kudi-arc) | MIT | Crypto FX/remittance sandbox research; not live |
| `upstreams/corridor` | [corridor-in-a-box/corridor-in-a-box](https://github.com/corridor-in-a-box/corridor-in-a-box) | Apache-2.0 | Cross-border transfer state-machine reference |

The unlicensed `davidakpele/epay-payment-system` is **not imported** because no usable licensing grant was verified. Ask its author to add a licence or grant permission before copying/white-labelling.

## System design

Do **not** wire multiple separate systems to maintain spendable balances. Select **one** source-of-truth ledger (initial candidate: Blnk), use an approved financial provider for actual USD account issuance/FX/NGN bank payouts, and implement compliance, provider idempotency, signed webhooks and daily reconciliation before enabling real transfers. See [Implementation plan](docs/INTEGRATION_PLAN.md).

## Updates

The GitHub Action checks upstream default/selected branches once per day. When newer commits exist it updates an issue for human review; it **does not** update submodule pointers or automatically deploy unreviewed changes.

## Attribution

Each source remains licensed under its own terms. Do not delete `LICENSE`, `NOTICE`, copyright notices, or required attribution, and do not imply the maintainers endorse Evolve Bank. See [Licences and provenance](docs/LICENCES_AND_PROVENANCE.md).

**Evolve Bank** — *Money without borders, responsibly built.*
