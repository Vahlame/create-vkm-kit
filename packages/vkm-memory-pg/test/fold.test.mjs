import test from "node:test";
import assert from "node:assert/strict";
import { foldText, vecToSqlLiteral, b64ToFloat32 } from "../src/fold.mjs";
import { vecB64 } from "./helpers.mjs";

test("foldText strips combining marks and lowercases (contract folding)", () => {
  assert.equal(foldText("Canción"), "cancion");
  assert.equal(foldText("ÑANDÚ über naïve"), "nandu uber naive");
  assert.equal(foldText(""), "");
  assert.equal(foldText(null), "");
  // Non-Latin text passes through minus case, never throws.
  assert.equal(foldText("Ελληνικά"), "ελληνικα");
});

test("foldText is idempotent (fold(fold(x)) === fold(x))", () => {
  const once = foldText("Métrica Á È Î Õ Ü");
  assert.equal(foldText(once), once);
});

test("vecToSqlLiteral serializes as pgvector text literal", () => {
  assert.equal(vecToSqlLiteral([1, 2.5, -0.25]), "[1,2.5,-0.25]");
  assert.equal(vecToSqlLiteral(new Float32Array([0, 1])), "[0,1]");
  assert.throws(() => vecToSqlLiteral([1, NaN]), /not finite/);
  assert.throws(() => vecToSqlLiteral([Infinity]), /not finite/);
});

test("b64ToFloat32 round-trips through the dump-wire encoding", () => {
  const src = [1.5, -2, 0.25, 3.125, 0, -0.5, 42, -13.75];
  const out = b64ToFloat32(vecB64(src));
  assert.equal(out.length, src.length);
  for (let i = 0; i < src.length; i++) assert.equal(out[i], src[i]);
});

test("b64ToFloat32 rejects payloads that are not float32-aligned", () => {
  assert.throws(() => b64ToFloat32(Buffer.from([1, 2, 3]).toString("base64")), /multiple of 4/);
});

test("b64 -> float32 -> sql literal composes for the sync path", () => {
  const lit = vecToSqlLiteral(b64ToFloat32(vecB64([1, 0, -1])));
  assert.equal(lit, "[1,0,-1]");
});
