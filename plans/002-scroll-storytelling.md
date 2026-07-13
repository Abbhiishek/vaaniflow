# 002 — Choreograph the page narrative

- **Status**: DONE
- **Commit**: b5963ab
- **Severity**: HIGH
- **Category**: Missed opportunities, purpose & frequency
- **Estimated scope**: 7 files, about 90 lines

## Problem

Most sections appear as static blocks even though the page explains a sequence.
For example, all three workflow rows are rendered with equal emphasis:

```astro
<!-- site/src/components/Workflow.astro:14 — current -->
<ol class="workflow__steps">
  {workflowSteps.map((step) => (<li>...</li>))}
</ol>
```

Likewise the four capability chapters, the product workspace, facts, setup
requirements, and final CTA arrive all at once. This makes the long page feel
assembled rather than narrated.

## Target

Use the `data-reveal` contract from plan 001 only on meaningful section units.
Use 60ms staggering (inside the catalog’s 30–80ms range) and never make
interaction wait for animation.

```astro
<li data-reveal style={`--reveal-delay: ${index * 60}ms`}>...</li>
```

Directional intent:

- headings and supporting copy: default 18px upward reveal;
- left-side product copy: `data-reveal="left"`;
- right-side product visuals: `data-reveal="right"`;
- large contained product frames: `data-reveal="scale"`;
- mobile layouts: override left/right starts to `translateY(14px)`.

## Repo conventions to follow

- `SectionHeading.astro` is the shared heading primitive; mark its root once rather than editing every caller.
- Astro map callbacks already expose `index` in ProductProof and ClosingSections.
- Motion values come from plan 001 tokens; do not type new curves.

## Steps

1. Add `data-reveal` to the root header in `SectionHeading.astro`.
2. In `Hero.astro`, reveal `.hero__intro`, the `h1`, `.hero__copy`, and `TranscriptRail` in a restrained 0/60/120/180ms progression. Add no letter-by-letter animation.
3. In `ProductProof.astro`, add `data-reveal="scale"` to `.workspace`; stagger fact articles by 60ms; reveal the note last.
4. In `Workflow.astro`, add a 0/60/120ms reveal delay to the three rows and reveal the aside after them. Do not loop or replay rows.
5. In `Capabilities.astro`, reveal each chapter copy and visual from opposing directions. Alternate direction with existing even/odd layout, but collapse both to vertical movement on mobile.
6. In `PrivacyFlow.astro`, reveal the section’s flow container, lists, and disclosure; detailed node sequencing belongs to plan 004.
7. In `ClosingSections.astro`, stagger requirement rows by 60ms and reveal the setup actions, open-source columns, and final CTA as grouped units.
8. In `SiteFooter.astro`, reveal only the top footer row. The legal bottom row should remain static.

## Boundaries

- Depends on plan 001.
- Do NOT animate every paragraph or individual word.
- Do NOT replay animations when scrolling back upward.
- Do NOT use blur, parallax, or scroll-jacking.
- Do NOT change semantic order or page copy.

## Verification

- **Mechanical**: run `npm run check`, `npm run build`, and `npm test` from `site/`.
- **Feel check**: scroll slowly from top to bottom at desktop and mobile widths. The eye should be led from heading → copy → product visual without waiting for content.
- At 10% playback, confirm stagger gaps are exactly 60ms and no group double-exposes or overlaps awkwardly.
- Emulate reduced motion; all units should fade without directional movement.
- **Done when**: the page reads as one continuous product story and every reveal fires once.
