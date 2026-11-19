# Independent monorepo source import — November 19, 2026

All six open-source projects were cloned at the pinned revisions recorded in `upstreams.lock.json`, exported with `git archive` into `upstreams/<project>`, and committed as **ordinary Git files** into the feature branch `feat/independent-monorepo-20261119`. The original Git submodule links and `.gitmodules` were removed.

| Project | Regular source files imported | Notes |
| --- | ---: | --- |
| NeoBank | 172 | MIT licence, full source |
| Flux | 239 | MIT licence, full source |
| Blnk | 393 | Apache-2.0, full source |
| Apache Fineract | 8,860 | Apache-2.0, full source |
| Kudi Arc | 48 | MIT, full source |
| Corridor-in-a-Box | 340 | Apache-2.0, full source |

The original import workflow copied and pushed all six repositories, removed all submodule/gitlink entries and committed UI-brand overlays for NeoBank and Flux. Its final *reporting loop* exited unsuccessfully due to `set -o pipefail` interacting with `git ls-files | grep -q` on long file lists, **not** because a source was missing. The verification was rewritten as `scripts/verify-monorepo.mjs` and run as a separate CI check.

**Distinction:** This is a self-contained source-code checkout, not a finished bank. Package dependencies still install from their registries, and genuine account issuance and payouts still require licensed financial-provider integrations. The unlicensed ePay project was not copied.
