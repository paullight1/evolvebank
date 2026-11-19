# Evolve Bank — development instructions

This is a financial-services prototype. **Never claim real bank accounts, balances, customer funds, exchange execution or payouts exist.**
- Default to SANDBOX / DEMO for all routes. No real financial credentials in source.
- Treat `upstreams/` as upstream Git submodules. Preserve original author notices. Do not blanket-rename infrastructure dependencies or obscure origin.
- Do not import unlicensed ePay code without explicit reuse permission.
- Select exactly one future system-of-record ledger; do not bridge NeoBank, Flux, Blnk and Fineract as competing balance authorities.
- For quote and ledger code use integer minor units, transparent FX rates and fees, idempotency, and unit/integration tests.
- No PII collection, fake bank account details, simulated confirmations presented as real, or storing secrets in frontend.
- Upstream updates must be reviewed, pinned, tested, and approved before integration.
- Prioritize user accessibility, responsive layout, safe failure states, and verified provider confirmation.
