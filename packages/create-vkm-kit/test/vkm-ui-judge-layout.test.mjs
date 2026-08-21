import test from "node:test";
import assert from "node:assert/strict";
import {
  auditGeometry,
  checkComponentDrift,
  checkCrampedStack,
  checkEdgeFlush,
  checkOverlap,
  checkTightPadding,
  summarizeGeometry,
  viewportGutter
} from "../templates/skills/vkm-ui-judge/scripts/layout-checks.mjs";

function box(partial) {
  return {
    selector: partial.selector || "div",
    tag: "div",
    role: "",
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    padT: 16,
    padR: 16,
    padB: 16,
    padL: 16,
    fontSize: 16,
    fontWeight: 400,
    radius: 0,
    text: false,
    interactive: false,
    card: false,
    position: "static",
    ...partial
  };
}

test("viewportGutter: M3 compact 16 / medium+ 24", () => {
  assert.equal(viewportGutter(360), 16);
  assert.equal(viewportGutter(600), 16);
  assert.equal(viewportGutter(601), 24);
  assert.equal(viewportGutter(1440), 24);
});

test("checkEdgeFlush: text kissing the viewport is an error; inside gutter is a warn", () => {
  const kissing = box({ selector: "h1", text: true, x: 1, w: 200, h: 32 });
  const tight = box({ selector: "p", text: true, x: 8, w: 200, h: 24 });
  const ok = box({ selector: "p.ok", text: true, x: 24, w: 200, h: 24 });
  const err = checkEdgeFlush(360, [kissing]);
  assert.equal(err[0].severity, "error");
  assert.equal(err[0].check, "edge-flush");
  const warn = checkEdgeFlush(360, [tight]);
  assert.equal(warn[0].severity, "warn");
  assert.deepEqual(checkEdgeFlush(360, [ok]), []);
});

test("checkEdgeFlush: a hung crop past the viewport is exempt (editorial overlap)", () => {
  const hung = box({ selector: "h1.crop", text: true, x: -40, w: 400, h: 80 });
  assert.deepEqual(checkEdgeFlush(360, [hung]), []);
});

test("checkEdgeFlush: tiny icons and full-bleed fixed chrome are exempt", () => {
  const icon = box({ selector: "a.icon", interactive: true, x: 2, w: 12, h: 12 });
  const bar = box({
    selector: "header",
    position: "fixed",
    x: 0,
    w: 360,
    h: 48,
    text: false
  });
  assert.deepEqual(checkEdgeFlush(360, [icon, bar]), []);
});

test("checkTightPadding: card with 2px pad is an error; 6px is a warn; 12px is clean", () => {
  const cramped = box({
    selector: ".card",
    card: true,
    w: 200,
    h: 120,
    padT: 2,
    padR: 2,
    padB: 2,
    padL: 2
  });
  const tight = box({
    selector: ".card2",
    card: true,
    w: 200,
    h: 120,
    padT: 6,
    padR: 6,
    padB: 6,
    padL: 6
  });
  const ok = box({
    selector: ".card3",
    card: true,
    w: 200,
    h: 120,
    padT: 12,
    padR: 12,
    padB: 12,
    padL: 12
  });
  assert.equal(checkTightPadding([cramped])[0].severity, "error");
  assert.equal(checkTightPadding([tight])[0].severity, "warn");
  assert.deepEqual(checkTightPadding([ok]), []);
});

test("checkOverlap: intersecting text boxes error; nested parent/child is not overlap", () => {
  const a = box({ selector: "h1", text: true, x: 20, y: 20, w: 200, h: 40 });
  const b = box({ selector: "h2", text: true, x: 30, y: 30, w: 200, h: 40 });
  const child = box({ selector: "span", text: true, x: 24, y: 24, w: 80, h: 16 });
  const hits = checkOverlap([a, b]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].check, "overlap");
  assert.deepEqual(checkOverlap([a, child]), []);
});

test("checkComponentDrift: three buttons with three font sizes warn; matching ones do not", () => {
  const drifted = [16, 18, 22].map((fontSize, i) =>
    box({
      selector: `button.b${i}`,
      tag: "button",
      interactive: true,
      fontSize,
      padT: 8,
      padB: 8,
      radius: 4
    })
  );
  const consistent = [0, 1, 2].map((i) =>
    box({
      selector: `button.c${i}`,
      tag: "button",
      interactive: true,
      fontSize: 14,
      padT: 8,
      padB: 8,
      radius: 4
    })
  );
  const hit = checkComponentDrift(drifted);
  assert.equal(hit.length, 1);
  assert.match(hit[0].detail, /font sizes/);
  assert.deepEqual(checkComponentDrift(consistent), []);
});

test("checkCrampedStack: stacked wide blocks with 2px gap warn; 24px gap is clean", () => {
  const a = box({ selector: "section.a", x: 16, y: 0, w: 320, h: 80 });
  const b = box({ selector: "section.b", x: 16, y: 82, w: 320, h: 80 });
  const c = box({ selector: "section.c", x: 16, y: 186, w: 320, h: 80 });
  const cramped = checkCrampedStack(360, [a, b]);
  assert.equal(cramped[0].check, "cramped-stack");
  assert.deepEqual(checkCrampedStack(360, [a, c]), []);
});

test("checkCrampedStack: side-by-side columns are not a stack", () => {
  const left = box({ selector: "aside", x: 0, y: 0, w: 140, h: 200 });
  const right = box({ selector: "main", x: 160, y: 4, w: 180, h: 200 });
  assert.deepEqual(checkCrampedStack(360, [left, right]), []);
});

test("auditGeometry + summarizeGeometry: a well-padded page is silent", () => {
  const geom = {
    vw: 360,
    vh: 740,
    boxes: [
      box({ selector: "p", text: true, x: 24, y: 24, w: 312, h: 40 }),
      box({
        selector: "article",
        tag: "article",
        card: true,
        x: 24,
        y: 80,
        w: 312,
        h: 120,
        padT: 16,
        padR: 16,
        padB: 16,
        padL: 16
      })
    ]
  };
  assert.deepEqual(auditGeometry(geom), []);
  const sum = summarizeGeometry(geom);
  assert.equal(sum.textCount, 1);
  assert.ok(sum.minTextInset >= 16);
});

test("auditGeometry: empty / zero viewport yields no findings", () => {
  assert.deepEqual(auditGeometry({ vw: 0, boxes: [] }), []);
  assert.deepEqual(auditGeometry({ vw: 360, boxes: [] }), []);
});
