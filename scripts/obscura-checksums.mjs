#!/usr/bin/env node
/**
 * Download each pinned obscura release asset and print its SHA-256, so the digests baked into
 * packages/create-vkm-kit/src/obscura-setup.mjs (OBSCURA_ASSETS) can be filled and audited.
 * obscura publishes no checksum file, so this is the reproducible way to pin them: run it,
 * review the output against a second source if possible, paste the hashes. Network + ~180MB
 * of downloads (all 5 platform assets).
 *
 *   node scripts/obscura-checksums.mjs
 */
import { createHash } from "node:crypto";
import {
  OBSCURA_ASSETS,
  OBSCURA_VERSION,
  downloadUrl
} from "../packages/create-vkm-kit/src/obscura-setup.mjs";

async function sha256(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return createHash("sha256")
    .update(Buffer.from(await res.arrayBuffer()))
    .digest("hex");
}

const seen = new Set();
console.log(`obscura v${OBSCURA_VERSION} asset checksums:\n`);
for (const spec of Object.values(OBSCURA_ASSETS)) {
  if (seen.has(spec.asset)) continue;
  seen.add(spec.asset);
  process.stdout.write(`  ${spec.asset.padEnd(32)} `);
  try {
    console.log(await sha256(downloadUrl(spec.asset)));
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}
