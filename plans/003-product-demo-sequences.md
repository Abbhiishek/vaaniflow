# 003 — Animate the product proof and capability demos

- **Status**: DONE
- **Commit**: b5963ab
- **Severity**: HIGH
- **Category**: Missed opportunities, physicality, performance
- **Estimated scope**: 2 files, about 180 lines

## Problem

The primary product frame already shows the final transcript while its floating
bar says “Ready to insert,” so the most important product state change never
happens on screen.

```astro
<!-- site/src/components/ProductProof.astro:35-52 — current -->
<div class="editor__copy">
  ...
  <p>Could you send the revised plan tomorrow morning?<i></i></p>
</div>
<div class="flow-bar">...<strong>Ready to insert</strong>...<b>✓</b></div>
```

`Capabilities.astro:39-48` also shows spoken and refined text simultaneously,
and the capture, dictionary, and insight visuals have no state progression.

## Target

Trigger each rare explanatory sequence once when its containing visual receives
`is-revealed`. Use only transform, opacity, and clip-path. No JavaScript timers.

ProductProof sequence:

1. frame settles via plan 002;
2. line placeholders fade to 55% over 260ms;
3. `.flow-bar` enters from `translate(-50%, 14px) scale(0.97)` and opacity 0 over 560ms;
4. waveform bars pulse once with 60ms stagger;
5. transcript reveals with `clip-path: inset(0 100% 0 0)` to `inset(0)` over 720ms;
6. success badge enters from `scale(0.9)` over 260ms.

Capabilities sequence:

- Capture: field first, caret blink, then `.mini-flow` from 12px below and check from `scale(0.9)`.
- Refine: spoken card → arrow → written card, with 120ms gaps; written card starts at `translateY(12px) scale(0.97)`.
- Remember: dictionary rows reveal at 60ms intervals.
- Review: bars grow from `scaleY(0.08)` with `transform-origin: bottom` and 60ms intervals; statistic fades independently.

Use `var(--ease-out-strong)` for entrances, `var(--ease-in-out-strong)` for the
one waveform morph, and existing duration tokens where they match. One-off
marketing durations may use the exact 560ms and 720ms values specified above.

## Repo conventions to follow

- Keep CSS scoped inside `ProductProof.astro` and `Capabilities.astro`.
- Reuse the existing `is-revealed` state placed on each visual by plan 002.
- Existing reduced-motion blocks at the bottoms of the components are the local override points.

## Steps

1. In `ProductProof.astro`, keep the semantic text in the DOM but add classes needed to target the transcript and success state.
2. Add one-shot keyframes/selectors for the six-step sequence above, rooted under `.workspace.is-revealed` so nothing runs before viewport entry.
3. Replace the broad caret-only reduced-motion block with a complete branch that shows final states immediately, removes movement/clip reveals, and may retain a 180ms opacity fade.
4. In `Capabilities.astro`, ensure every `.chapter__visual` is the reveal target, then add the four scoped sequences above.
5. Stagger with CSS custom properties set from existing Astro map indexes or explicit `nth-child` selectors; use 60ms increments.
6. Keep any infinite animation limited to the caret blink. Do not add continuous floating, glowing, or marquee motion.

## Boundaries

- Depends on plans 001 and 002.
- Do NOT change the product claims or visible copy.
- Do NOT animate width, height, margin, padding, top, or left.
- Do NOT add `filter: blur()`.
- Do NOT add a dependency or runtime timer.

## Verification

- **Mechanical**: run `npm run check`, `npm run build`, and `npm test` from `site/`.
- **Feel check**: reload above each target, scroll it into view, and confirm the animation explains the state change in the listed order.
- At 10% playback, the transcript reveal must be clean, the bar must not jump, and all scale starts must be between 0.9 and 0.97—not zero.
- Scroll away and back; the sequence must not replay.
- Emulate reduced motion; final content must be readable immediately with no translation, scaling, or clipping.
- **Done when**: a viewer can understand capture, refinement, dictionary learning, and insights without reading surrounding paragraphs.
