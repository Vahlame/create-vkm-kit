# Domain: user interfaces (UI/UX)

Load this when the deliverable is something a user sees and interacts with — a screen, component,
form, dashboard, or web page. Accessibility is part of the definition of done, not a later coat.

> This domain is the **acceptance gate**. For the full generative method — design direction,
> foundations, real libraries, visual self-critique loop — invoke the `vkm-design` skill if
> installed; it treats this gate as its definition of done.

## Deliver a better result

1. **Contrast is COMPUTED, never eyeballed** (WCAG formula or a tool): normal text ≥ 4.5:1; large
   (≥ 24px, or ≥ 18.66px bold) ≥ 3:1; meaningful non-text (informative icons, field borders, the
   focus ring) ≥ 3:1. Compute it **per theme** if the UI ships light AND dark. Run axe if a browser is up.
2. **Brand palette never overrides legibility** — adjust a failing brand color (darken/lighten/use as
   a non-text accent) and record both values.
3. **The whole flow works keyboard-only with a visible focus:** tab order follows reading order,
   `:focus-visible` is perceptible, interactive elements are native (or custom with role + key
   handling); in a modal the focus enters, can't escape, and returns to the trigger on close.
4. **No information by color alone** — every state (error/success/selected/link) also reads via text,
   icon, or shape.
5. **Interactive targets ≥ 24×24px CSS** (≥ 44×44 on touch, or compensating spacing).
6. **Ship the three screen states** — empty (first use), error (message beside the field, focus to it,
   input preserved), loading/confirming — plus per-control hover/focus/disabled/submitting, not just rest.
7. **Holds at the declared minimum width AND at 200% zoom** (fluid/relative units; no fixed widths that overflow).

## Edge cases to actually exercise

- Empty list/table → explicit empty state with guiding text, not a blank hole.
- Extreme/empty text → truncate with tooltip or defined wrap; never an overflow that breaks layout.
- Keyboard-only → an unreachable step is blocking.
- 200% zoom / large system font → relative units + reflow; never hide content to compensate.
- Light/dark theme → fix the failing theme token, not the component; an unreadable theme blocks equally.
- `prefers-reduced-motion` → drop decorative motion, reduce essential motion to a no-move change.
- Late async content → reserve space (skeleton/dimensions); a control that jumps as the user reaches it is a fail.
- Scroll-dependent sticky chrome → verify by REALLY scrolling (wheel/`scrollTo` + capture), not a
  resize; confirm which element actually has the overflow before wiring the listener.

## Anti-patterns

- ❌ "Accessibility at the end" → it's in the acceptance criteria before the first line; audit every version.
- ❌ `div`+onclick rebuilding a native control → native first; a custom control needs role + keyboard + focus test.
- ❌ Testing only in the author's window → declare a matrix: narrow + wide, 200% zoom, each theme, keyboard-only.
- ❌ A hand-built visual (canvas/SVG/icon) called done because the data renders → judge the _finish_ too
  (smooth curves, even spacing, clean edges) against the library it replaces.
