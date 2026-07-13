# 001 — Establish the motion foundation

- **Status**: DONE
- **Commit**: b5963ab
- **Severity**: HIGH
- **Category**: Accessibility, cohesion & tokens, physicality
- **Estimated scope**: 4 files, about 120 lines

## Problem

The marketing site has no reusable entrance system, only one strong easing token,
and its reduced-motion rule removes every transition—including useful color and
opacity feedback.

```css
/* site/src/styles/tokens.css:44 — current */
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--duration-fast: 160ms;
--duration-base: 260ms;
```

```css
/* site/src/styles/global.css:163 — current */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

`ButtonLink.astro:46-100` also lifts every reusable CTA on hover but has no
press state, and the hover movement is not restricted to fine pointers.

## Target

Add these exact shared tokens:

```css
--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--duration-press: 140ms;
--duration-reveal: 560ms;
```

Create a progressively enhanced reveal contract. Content must be visible when
JavaScript is unavailable; only `html.motion-ready` may apply hidden starting
states.

```css
html.motion-ready [data-reveal] {
  opacity: 0;
  transform: translateY(18px);
  transition:
    opacity var(--duration-reveal) var(--ease-out-strong),
    transform var(--duration-reveal) var(--ease-out-strong);
  transition-delay: var(--reveal-delay, 0ms);
}

html.motion-ready [data-reveal].is-revealed {
  opacity: 1;
  transform: none;
}
```

Support `data-reveal="left"`, `"right"`, and `"scale"` with starting transforms
of `translateX(-18px)`, `translateX(18px)`, and `scale(0.97)` respectively.

The observer must use `threshold: 0.12` and
`rootMargin: '0px 0px -12% 0px'`, add `is-revealed`, then unobserve the node.

Reduced motion must remove positional movement but preserve a 180ms opacity or
color transition. Buttons must use fine-pointer hover and `scale(0.97)` press
feedback over 140ms.

## Repo conventions to follow

- Motion tokens live in `site/src/styles/tokens.css`.
- Global accessibility behavior lives in `site/src/styles/global.css`.
- Site-wide inline runtime setup belongs in `site/src/layouts/BaseLayout.astro`.
- CTA styling remains scoped to `site/src/components/ButtonLink.astro`.

## Steps

1. Add the five motion tokens to `site/src/styles/tokens.css`; keep existing token names for compatibility.
2. Add the progressive reveal selectors and directional variants to `site/src/styles/global.css`.
3. Replace the universal reduced-motion duration reset with targeted rules: reveal elements retain opacity feedback for 180ms, transforms are removed, smooth scrolling is disabled, and component-specific loops may still be disabled locally.
4. In `BaseLayout.astro`, add one inline module script after `<slot />`. On DOM ready, add `motion-ready`, reveal nodes immediately when reduced motion is active, otherwise observe `[data-reveal]` with the exact threshold/root margin above.
5. In `ButtonLink.astro`, move transform hovers under `@media (hover: hover) and (pointer: fine)`, reduce arrow travel to `translateX(3px)`, and add `.button:active { transform: scale(0.97); }` using `--duration-press` and `--ease-out-strong`.
6. Do not add a dependency or animation runtime.

## Boundaries

- Do NOT hide content unless `html.motion-ready` is present.
- Do NOT animate layout properties.
- Do NOT change colors, typography, spacing, or page copy.
- Do NOT add a third-party motion library.

## Verification

- **Mechanical**: from `site/`, run `npm run check`, `npm run build`, and `npm test`; all must pass.
- **Feel check**: throttle the animation to 10%; reveals must start fast and settle softly without overshoot. Repeated button presses must retarget smoothly.
- Emulate `prefers-reduced-motion: reduce`; reveals may fade for 180ms but must not translate or scale, while button color feedback remains visible.
- Disable JavaScript; all content must remain visible.
- **Done when**: the reveal contract is reusable, no content flashes permanently hidden, and controls have subtle physical press feedback.
