# 004 — Animate routing and mobile navigation

- **Status**: DONE
- **Commit**: b5963ab
- **Severity**: MEDIUM
- **Category**: Missed opportunities, easing & duration, accessibility
- **Estimated scope**: 2 files, about 100 lines

## Problem

The privacy diagram is a static row even though it explains data movement:

```astro
<!-- site/src/components/PrivacyFlow.astro:16-39 — current -->
<div class="privacy-flow">
  <div class="flow-node">...</div>
  <div class="flow-connector"><span>audio</span><i>→</i></div>
  ...
</div>
```

The mobile navigation panel also appears instantly beneath its trigger; only
the hamburger bars animate using built-in `ease`.

```css
/* site/src/components/SiteHeader.astro:119-145 — current */
.mobile-nav summary span { transition: transform var(--duration-fast) ease; }
.mobile-nav nav { position: absolute; top: calc(100% + 1px); }
```

## Target

Privacy route:

- each node enters at 0/120/240/360ms;
- each connector enters 60ms after its preceding node;
- connectors use `translateX(-10px)` to zero with `var(--ease-in-out-strong)`;
- mobile connectors use `translateY(-10px)` to zero after their arrow rotates;
- optional route and list groups reveal only after the primary route;
- all transforms are removed under reduced motion.

Mobile navigation:

```css
.mobile-nav[open] nav {
  transform-origin: top;
  animation: mobile-nav-in 220ms var(--ease-drawer) both;
}

@keyframes mobile-nav-in {
  from { opacity: 0; transform: translateY(-10px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
```

Use `var(--ease-in-out-strong)` for the icon morph. Add a 140ms
`scale(0.97)` press state to the summary. Keep opening under 300ms.

## Repo conventions to follow

- Privacy diagram styles remain scoped in `PrivacyFlow.astro`.
- Mobile menu styles remain scoped in `SiteHeader.astro`.
- Use tokens from plan 001; no typed duplicate bezier curves.

## Steps

1. Add `data-reveal` and exact delay custom properties to privacy nodes/connectors in DOM order.
2. Add directional connector transitions and final-state rules rooted in `.is-revealed`.
3. Reveal the optional route and privacy list articles after the main route without blocking interaction.
4. Add the 220ms mobile-nav opening keyframe, strong icon morph easing, and press feedback to `SiteHeader.astro`.
5. Gate any hover movement with `@media (hover: hover) and (pointer: fine)`.
6. Add local reduced-motion rules that show route and menu states without spatial movement.

## Boundaries

- Depends on plan 001; privacy grouping also assumes plan 002.
- Do NOT replace native `<details>` semantics.
- Do NOT delay link interactivity while the menu enters.
- Do NOT add an animated close implementation that traps focus or delays navigation.
- Do NOT alter data-boundary copy.

## Verification

- **Mechanical**: run `npm run check`, `npm run build`, and `npm test` from `site/`.
- **Feel check**: the privacy route should read left-to-right on desktop and top-to-bottom on mobile; the mobile menu should appear to come from its trigger.
- Rapidly toggle the menu; it must remain usable and never leave invisible clickable content.
- At 10% playback, confirm the menu origin is top center and no element begins at scale zero.
- Emulate reduced motion; route and menu remain fully legible without translation or scale.
- **Done when**: both spatial relationships are clear and all controls remain immediately interactive.
