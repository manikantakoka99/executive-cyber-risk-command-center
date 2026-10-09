#!/usr/bin/env tsx
/**
 * Manager demo CLI: reset | seed | prepare | verify
 *
 * Usage (from server/):
 *   npm run demo:prepare
 *   npm run demo:verify
 *   npm run demo:reset
 *   npm run demo:seed
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "../../.env") });
dotenv.config(); // server/.env override if present

import {
  prepareManagerDemo,
  resetDemo,
  seedDemo,
  verifyDemo,
  HERO_SCENARIO_TITLE,
} from "../src/services/demoMode.js";

const ORG =
  process.env.DEMO_ORG_ID ??
  process.env.DEFAULT_ORG_ID ??
  "2accc7de-f693-4b19-8fe8-6db501be05e2";

const cmd = process.argv[2] ?? "prepare";

async function main() {
  console.log(`ECC demo · org=${ORG} · command=${cmd}`);
  console.log(`Hero: ${HERO_SCENARIO_TITLE}`);

  if (cmd === "reset") {
    console.log(JSON.stringify(await resetDemo(ORG), null, 2));
    return;
  }
  if (cmd === "seed") {
    console.log(JSON.stringify(await seedDemo(ORG), null, 2));
    return;
  }
  if (cmd === "verify") {
    const v = await verifyDemo(ORG);
    console.log(JSON.stringify(v, null, 2));
    if (!v.ok) process.exit(1);
    return;
  }
  if (cmd === "prepare") {
    const r = await prepareManagerDemo(ORG);
    console.log(JSON.stringify(r, null, 2));
    if (!r.verified.ok) process.exit(1);
    console.log("\n✓ Demo ready");
    console.log(`  Hero ID: ${r.heroScenarioId}`);
    console.log(`  Open:    /scenarios/${r.heroScenarioId}`);
    return;
  }
  console.error("Usage: ecc_demo.ts [prepare|reset|seed|verify]");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
