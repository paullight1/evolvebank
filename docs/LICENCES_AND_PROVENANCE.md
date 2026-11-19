# Evolve Bank — licences, original authors and pinned provenance

Each directory under `upstreams/` contains a **full regular-file snapshot of a publicly available upstream repository**, not a submodule. Files are checked in to Evolve Bank itself. Original repository remotes are recorded for attribution and future comparison, but are not needed to clone this monorepo.

| Directory | Original project | Licence | Pinned source SHA |
| --- | --- | --- | --- |
| `upstreams/neobank` | dawidolko/NeoBank-Platform-Nuxt | MIT | `a377866a392c3b81af46a989681e8d8b32b572ba` |
| `upstreams/flux` | SamABZD/flux | MIT | `12609beea9f97de285d88e7e28f4087e74914b01` |
| `upstreams/blnk` | blnkfinance/blnk | Apache-2.0 | `64713a5af5cb90ca69f7b29d652fa5bba344df53` |
| `upstreams/fineract` | apache/fineract | Apache-2.0 | `88e625cbe1cbe3c3fcfccce2df2ab4b2c1c8a09b` |
| `upstreams/kudiarc` | KudiArc/kudi-arc | MIT | `8aa74ae472cec381accfab227c9e1a4caae1ed68` |
| `upstreams/corridor` | corridor-in-a-box/corridor-in-a-box | Apache-2.0 | `51f3851a078200bea370b3cf3145ec7cd1fd0653` |

### Preserve these conditions

- Original MIT licences and copyright notices must be retained when reproducing or distributing modified source.
- Apache-2.0 licences, copyright, required notices and NOTICE documents must remain intact; prominently mark relevant changed files.
- Evolve Bank presentation branding does not confer ownership of upstream code or imply endorsement.
- Source snapshots are independent of the remote GitHub projects, but **external package dependencies and external financial services still require their own installation/approval**.
- The prototype must not be publicly promoted as a licensed bank or a live USD-account issuer while it is not one.

### Excluded

`davidakpele/epay-payment-system` has no verified commercial reuse licence in the reviewed repository; it is not imported. Request licensing permission before adding its code.

### Future-source review protocol

1. Compare upstream changes against pinned source SHAs, including licence, vulnerabilities and compliance.
2. Import only reviewed revisions, not blindly updated default-branch contents.
3. Preserve original notices; isolate presentational brand changes from money-moving logic.
4. Run security, reconciliation, concurrency and idempotency tests before considering any production integration.
5. Update `upstreams.lock.json` when deliberately changing the source snapshot.

**This monorepo is a development aid, not regulatory approval, production banking or a guarantee of fitness for handling money.**
