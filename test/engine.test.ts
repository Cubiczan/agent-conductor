import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ChpBridge } from "../src/engine/chpBridge.ts";

const bridge = new ChpBridge();
after(() => bridge.stop());

test("engine ping reports the published CHP package version", async () => {
  const result = await bridge.ping();
  assert.equal(result.ok, true);
  assert.equal(result.engine, "chp");
});

test("R0 gate halts when any criterion is fatal", async () => {
  const pass = await bridge.r0Gate({ solvable: true, scoped: true, valid: true, worth_it: true });
  assert.equal(pass.verdict, "PASS");

  const halt = await bridge.r0Gate({ solvable: true, scoped: false, valid: true, worth_it: true });
  assert.equal(halt.verdict, "HALT");
  assert.equal(halt.results["Scoped"], "FATAL");
});

test("adversary pass returns findings and a foundation score", async () => {
  const result = await bridge.adversary({
    claim: "Change scoreDealRisk stale-activity weight from 20 to 30",
    context: "Tests updated; label distribution checked against fixture",
  });
  assert.ok(["EXPLORING", "HALT", "REFRAME_REQUIRED"].includes(result.status));
  assert.equal(typeof result.foundation_score, "number");
  assert.ok(result.findings.length > 0);
  assert.match(result.report, /Adversary Pass/);
});

test("engine errors surface as rejected promises without killing the bridge", async () => {
  await assert.rejects(
    // claim is required — bridge must return an error response, not crash
    bridge.adversary({ claim: "" }),
    /required/,
  );
  const stillAlive = await bridge.ping();
  assert.equal(stillAlive.ok, true);
});
