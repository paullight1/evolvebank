// Make sure the account the reference anchor receives payments on exists on
// testnet and can hold the bridge asset, so the settle leg has somewhere to go.
//
//   DISTRIBUTION_SECRET=S... pnpm prepare:distribution
//
// Why this exists: the Anchor Platform image hardcodes a distribution account
// (`GBN4NNCD…`) whose secret ships in the same image as test material. Anyone
// who runs the platform's test profile holds that key, so anyone can drain or
// merge the account — and on 2026-11-16 someone did, after which every settle
// failed with `op_no_destination`. Pointing the anchor at an account only this
// repo holds the key for (see `DISTRIBUTION_ACCOUNT` in
// scripts/reference-anchor.sh) takes that stranger out of the loop.
//
// Idempotent: creates the account through friendbot only when Horizon does not
// know it, and adds the trustline only when it is missing. Prints the public key
// on the last line, and appends `DISTRIBUTION_ACCOUNT=G…` to $GITHUB_ENV when
// running in Actions so later steps can hand it to reference-anchor.sh.

import { appendFileSync } from "node:fs";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const FRIENDBOT = process.env.FRIENDBOT_URL ?? "https://friendbot.stellar.org";
/** Circle's testnet USDC issuer, as configured in the reference server's assets.yaml. */
const ASSET_CODE = process.env.BRIDGE_ASSET ?? "USDC";
const ASSET_ISSUER =
  process.env.BRIDGE_ASSET_ISSUER ??
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function isNotFound(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 404;
}

async function main(): Promise<void> {
  if (!HORIZON.includes("testnet")) {
    console.error(`✗ refusing to run against ${HORIZON} — testnet only.`);
    process.exit(3);
  }
  const secret = process.env.DISTRIBUTION_SECRET;
  if (!secret) {
    console.error("✗ set DISTRIBUTION_SECRET to the anchor's receiving account seed");
    process.exit(2);
  }

  const server = new Horizon.Server(HORIZON);
  const kp = Keypair.fromSecret(secret);
  const asset = new Asset(ASSET_CODE, ASSET_ISSUER);
  console.log(`account:     ${kp.publicKey()}`);

  let account: Horizon.AccountResponse;
  try {
    account = await server.loadAccount(kp.publicKey());
    console.log("exists:      yes");
  } catch (e) {
    if (!isNotFound(e)) throw e;
    const res = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(kp.publicKey())}`);
    if (!res.ok) throw new Error(`friendbot HTTP ${res.status}`, { cause: e });
    console.log("exists:      created via friendbot");
    account = await server.loadAccount(kp.publicKey());
  }

  const trusted = account.balances.find(
    (b) => "asset_code" in b && b.asset_code === ASSET_CODE && b.asset_issuer === ASSET_ISSUER,
  );
  if (trusted) {
    console.log(`trustline:   present (${trusted.balance} ${ASSET_CODE})`);
  } else {
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    await server.submitTransaction(tx);
    console.log("trustline:   created");
  }

  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `DISTRIBUTION_ACCOUNT=${kp.publicKey()}\n`);
  }
  console.log(kp.publicKey());
}

main().catch((e) => {
  const extras = e?.response?.data?.extras?.result_codes;
  console.error(extras ? `✗ ${JSON.stringify(extras)}` : e);
  process.exit(1);
});
