/**
 * Regression test for `scripts/version.mjs`'s marker table.
 *
 * The Go daemon carries the kit version twice — the authoritative `var version` and
 * the example `-ldflags` in the build comment above it. They used to be ONE marker
 * whose `read` looked only at `var version` and whose `write` did both replaces,
 * which let the ldflags copy drift silently and permanently:
 *
 *   - `set` skips a file whose `read` already matches the target, so once
 *     `var version` was correct the second replace never ran again;
 *   - the "refusing partial write" guard compares the whole file before/after, so a
 *     no-op second replace is invisible whenever the first one changed something;
 *   - `check` only ever inspected what `read` returned.
 *
 * Net effect: the documented build command could print a stale version forever, and
 * both `set` and `check` would stay silent about it. These tests pin the split.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MARKERS } from "../../../scripts/version.mjs";

const GO_FILE = "cmd/obsidian-memoryd/main.go";

/** A main.go excerpt with the two version copies set independently. */
function goSource({ varVersion, ldflags }) {
  return [
    "// Build with:",
    `//	go build -ldflags="-X main.version=${ldflags}" ./cmd/obsidian-memoryd`,
    "",
    "package main",
    "",
    `var version = "${varVersion}"`,
    ""
  ].join("\n");
}

const goMarkers = () => MARKERS.filter((m) => m.file === GO_FILE);

test("the Go daemon's two version copies are separate markers, not one", () => {
  const markers = goMarkers();
  assert.equal(
    markers.length,
    2,
    "as a single marker the -ldflags copy cannot be surveyed or checked independently"
  );
  // Distinct names, so `check`'s per-row output can actually name which copy drifted.
  assert.equal(new Set(markers.map((m) => m.name)).size, 2);
});

test("a drifted -ldflags copy is READ as drifted even when var version is correct", () => {
  const src = goSource({ varVersion: "4.4.0", ldflags: "4.3.0" });
  const values = goMarkers().map((m) => m.read(src));
  assert.ok(values.includes("4.4.0"), "var version must still read 4.4.0");
  assert.ok(
    values.includes("4.3.0"),
    "the stale -ldflags copy must be visible to check(); this is the exact drift the " +
      "single-marker version reported as 'ok'"
  );
});

test("each marker rewrites only its own copy, and together they converge", () => {
  const before = goSource({ varVersion: "4.4.0", ldflags: "4.3.0" });
  // Mirrors cmdSet: markers are applied in order, each re-reading the previous result.
  const after = goMarkers().reduce((src, m) => m.write(src, "4.5.0"), before);
  assert.match(after, /var version = "4\.5\.0"/);
  assert.match(after, /main\.version=4\.5\.0/);
  assert.doesNotMatch(after, /4\.[34]\.0/, "no stale copy may survive");
});

test("writing an already-correct file is a no-op, so `set` stays idempotent", () => {
  const src = goSource({ varVersion: "4.5.0", ldflags: "4.5.0" });
  const after = goMarkers().reduce((s, m) => m.write(s, "4.5.0"), src);
  assert.equal(after, src);
});

test("every marker reads back exactly what it wrote (read/write are inverses)", () => {
  // Guards the whole table, not just the Go pair: a regex that writes a shape its own
  // reader cannot parse would make `set` produce permanent, self-inflicted drift.
  const fixtures = {
    "packages/create-vkm-kit/package.json": '{\n  "name": "x",\n  "version": "1.0.0"\n}\n',
    "packages/create-obsidian-memory-shim/package.json": '{\n  "version": "1.0.0"\n}\n',
    "packages/obsidian-memory-mcp/package.json": '{\n  "version": "1.0.0"\n}\n',
    "packages/vkm-doctor/package.json": '{\n  "version": "1.0.0"\n}\n',
    "packages/vkm-spec/package.json": '{\n  "version": "1.0.0"\n}\n',
    "packages/obscura-web/package.json": '{\n  "version": "1.0.0"\n}\n',
    "packages/vkm-downloads/package.json": '{\n  "version": "1.0.0"\n}\n',
    "packages/obsidian-memory-rag/pyproject.toml": '[project]\nversion = "1.0.0"\n',
    "agent.toml": 'version = "1.0.0"\n',
    [GO_FILE]: goSource({ varVersion: "1.0.0", ldflags: "1.0.0" })
  };

  for (const marker of MARKERS) {
    const fixture = fixtures[marker.file];
    assert.ok(fixture, `no fixture for marker file ${marker.file} — add one`);
    const written = marker.write(fixture, "9.8.7");
    assert.notEqual(written, fixture, `${marker.name}: write() matched nothing`);
    assert.equal(
      marker.read(written),
      "9.8.7",
      `${marker.name}: read() cannot parse its own write`
    );
  }
});
