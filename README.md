# Evolve Bank

**Evolve-branded multicurrency banking and exchange development monorepo.**

> **SANDBOX ONLY.** No live USD receiving accounts, deposits, exchange execution, bank withdrawals, custody or licensed banking services. Evolve Bank is a prototype name; launch requires a qualified regulated provider and legal approval.

## Repository structure

```text
apps/portal/                   Evolve Bank responsive demo / simulated FX quote
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

## Start Evolve portal

Node.js 20+:

```bash
git clone https://github.com/paullight1/evolvebank.git
cd evolvebank
npm test
npm run start:portal
# Visit http://localhost:4173
```

The portal uses a **deliberately fictitious** `$1 = ₦1,000` rate and a `$1` demonstration fee. No funds move, and withdrawal actions are disabled.

## Core banking architecture

Choose **one** ledger of record, tentatively Blnk; treat Fineract as an alternative, not a second balance authority. Use approved financial institutions for real USD receiving accounts, currency conversion and NGN payouts. Follow [integration plan](docs/INTEGRATION_PLAN.md) for KYC, regulatory obligations, provider reconciliation, and release gates.

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
