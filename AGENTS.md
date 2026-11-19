# Evolve Bank: agent implementation boundaries

- Work in this independent monorepo. `upstreams/<project>` contains checked-in complete source snapshots, **not Git submodules**. Do not replace them with links or gitlinks.
- Retain each upstream project's original `LICENSE`, `NOTICE` and copyright attributions. Record upstream source and pinned commit in `upstreams.lock.json`.
- The main Evolve UI lives under `apps/portal`. The other six independently imported source projects do not form one integrated service yet.
- The applications are sandbox-only. Never claim that live bank accounts, transactions or exchange/payout services are available.
- Never repurpose branding to suggest authorisation by a regulated bank. Never remove no-real-funds warnings.
- For actual money flows use one ledger of record, integer minor units, idempotency keys, verified provider statements, webhook authentication, and bank-sanctioned integrations.
- Do not add ePay without explicit licence permission. Avoid storing credentials, customer data or secret keys in source.
- Do not auto-merge third-party updates into financial software. Review and pin source revisions.
