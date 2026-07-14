# Illustration gallery — the technique-matching decision, eight subjects

The point of `references/illustration.md` in one page: **the hard call is not "how do I draw
this" but "which technique does this subject need."** Get that right and the execution is
mechanical; get it wrong (hand-plot a complex real thing) and no craft saves it. Eight worked
decisions across very different briefs — none of them "draw an SVG from memory."

| #   | Brief / subject                            | Recognizable essence (the spec)                          | Technique chosen — and why                                                                                                                                                                                                         |
| --- | ------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fishing guide — a **guapote** (cichlid)    | deep oval body, one long dorsal, **rounded** tail        | **Trace** a clean cichlid reference (`trace-svg.mjs`). Hand-plotting gave a tuna; the reference gives the real silhouette.                                                                                                         |
| 2   | Coffee roaster — **coffee beans** hero     | the center crease, the oily sheen, the ovoid             | **Treat a photo** — duotone the real bean shot (`contemporary.md` §11). The crease/sheen are photographic facts; a drawn bean looks fake.                                                                                          |
| 3   | Birding app — a **great blue heron** mark  | S-curved neck, dagger bill, long legs, hunched stance    | **Trace → then mark craft** (`marks.md`): trace a reference silhouette for a faithful base, then optically balance and cut a 16px variant.                                                                                         |
| 4   | Law firm — the **courthouse** on the About | the pediment, the column rhythm, the steps               | **Treat a photo** (halftone or hard duotone) OR trace a facade elevation. Column count and pediment are facts, not vibes.                                                                                                          |
| 5   | SaaS dashboard — a **settings gear** icon  | notch count, hub, consistent stroke                      | **Icon library** (`libraries.md`). A gear is a solved glyph; redrawing it wastes effort and drifts off-grid.                                                                                                                       |
| 6   | Kids' brand — a friendly **fox mascot**    | triangle ears, pointed snout, bushy tail, YOUR character | **Observe then invent**: study fox references for correct proportions, then hand-draw the stylized character. Faithful base, deliberate stylization — the one place hand-SVG is right, because the mascot is authored, not copied. |
| 7   | Landing hero — abstract **flowing ribbon** | rhythm, depth, palette — no real-world referent          | **Hand-draw / generate** (SVG path, or a shader per `contemporary.md` §10). Nothing real to be faithful to; pure form.                                                                                                             |
| 8   | Taxonomy page — **a set of 7 species**     | each species' distinguishing silhouette                  | **Trace all** from one reference source for a coherent set; verify each by IoU; present as a specimen sheet (see `examples` → the Cabinet proof).                                                                                  |

## The pattern

- **Complex + real + must be accurate** (1, 2, 3, 4, 8) → trace a reference or treat a photo.
  Never hand-plot. Verify by IoU / feature check.
- **Solved generic symbol** (5) → icon library.
- **Authored or abstract** (6, 7) → hand-draw is legitimate, because there is no ground truth to
  be faithful to — but for 6 you still study real references to get proportions right before
  stylizing.

Same spine every time: name the recognizable essence → pick the technique from the table → execute
→ verify against the reality (IoU for traces, the feature checklist always). The Cabinet
(`illustration.md` § Step 3) is this method run live on seven subjects across three categories,
each shipping with its measured fidelity.
