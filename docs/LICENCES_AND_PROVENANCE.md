# Upstream sources, licences and provenance

| Source | Licence | Integration status |
| --- | --- | --- |
| [dawidolko/NeoBank-Platform-Nuxt](https://github.com/dawidolko/NeoBank-Platform-Nuxt) | MIT | Git submodule pinned to `a377866a392c` — reference only |
| [SamABZD/flux](https://github.com/SamABZD/flux) | MIT | Git submodule pinned to `12609beea9f9` — reference only |
| [blnkfinance/blnk](https://github.com/blnkfinance/blnk) | Apache-2.0 | Git submodule pinned to `64713a5af5cb` — reference only |
| [apache/fineract](https://github.com/apache/fineract) | Apache-2.0 | Git submodule pinned to `88e625cbe1cb` — reference only |
| [KudiArc/kudi-arc](https://github.com/KudiArc/kudi-arc) | MIT | Git submodule pinned to `8aa74ae472ce` — reference only |
| [corridor-in-a-box/corridor-in-a-box](https://github.com/corridor-in-a-box/corridor-in-a-box) | Apache-2.0 | Git submodule pinned to `51f3851a0782` — reference only |

## What the monorepo does and does not do

The six source repositories are linked through **Git submodules**. Their source, history and original licence remain in their own repositories, and can be checked out locally with `git submodule update --init --recursive`. Nothing here has transformed them into a finished financial product.

Original MIT/Apache-2.0 notices and attribution must be preserved in distributions and derivative source. Apache-2.0 NOTICE requirements apply if present. Source names should be retained in provenance documentation; user-facing presentation can be branded without removing upstream copyright or creating false endorsements.

**Excluded:** `davidakpele/epay-payment-system` has no verifiable repository licence in the previously reviewed root. Public availability does not grant commercial reuse permission, so it has not been imported.

**Regulatory naming:** Evolve Bank is a proposed product identity, not evidence of a regulated deposit-taking bank. Before public launch, obtain legal review of brand/trademark, financial services permissions in each corridor, and customer funds safeguarding.

## Source update protocol

1. The daily GitHub Action identifies changed upstream heads and files an issue.
2. Review upstream release notes, licence changes, vulnerabilities and any breaking changes.
3. Reconcile Evolve's branding overlay in an isolated developer workspace.
4. Run each relevant project's own tests and independent security checks.
5. Update gitlink SHA and `upstreams.lock.json` together in a reviewed pull request.
6. Never automatically deploy new ledger, FX, settlement or crypto code to customers.

All six pinned references were checked in November 2026; they may move later. Source links alone do not establish runtime suitability.
