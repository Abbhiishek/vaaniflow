# 005 — Replace mockups with real Vaani screens

- **Status**: DONE
- **Commit**: b5963ab
- **Severity**: HIGH
- **Category**: Product storytelling, visual credibility, motion cohesion
- **Estimated scope**: 4 source files, 7 image assets, about 260 lines

## Problem

The current marketing site uses CSS-constructed product approximations in
`ProductProof.astro` and `Capabilities.astro`, while real application screenshots
now exist. The real screens are visually richer and more credible, so leaving
them outside the site undersells the product.

## Source images

Copy and rename these exact files into `site/public/product/`:

| Source | Destination |
| --- | --- |
| `C:/Users/abhis/Desktop/vaani-dashboard.png` | `vaani-insights.png` |
| `C:/Users/abhis/AppData/Local/Temp/codex-clipboard-15bd4043-6ad4-43bc-828e-dec88b0d0815.png` | `vaani-dictionary.png` |
| `C:/Users/abhis/AppData/Local/Temp/codex-clipboard-027ecc99-2c24-4cbc-b4fe-1f5ce9232aaa.png` | `vaani-styles.png` |
| `C:/Users/abhis/AppData/Local/Temp/codex-clipboard-e31e894f-b573-4a80-8804-d45447a91eb0.png` | `vaani-snippets.png` |
| `C:/Users/abhis/AppData/Local/Temp/codex-clipboard-618a2ccb-bd64-45e4-9a04-b54385cef30c.png` | `vaani-settings-general.png` |
| `C:/Users/abhis/AppData/Local/Temp/codex-clipboard-c40b91ba-35b9-4eaa-8095-e937a6effeb5.png` | `vaani-settings-appearance.png` |
| `C:/Users/abhis/AppData/Local/Temp/codex-clipboard-7c33802e-5042-4ef7-96b7-6ff2013c10eb.png` | `vaani-settings-system.png` |

## Target

Commit to the existing editorial/industrial dark direction. The screenshots
should feel like evidence mounted in a product journal—not a generic carousel.

1. Replace the CSS-built fake workspace in `ProductProof.astro` with the real
   Insights screenshot inside a precise desktop-window frame. Preserve the
   section heading, facts, product note, caption, and semantic figure.
2. Add a new `ProductScreens.astro` section after `Capabilities` and before
   `PrivacyFlow`. It contains:
   - a dominant Dictionary screen;
   - Style and Snippets as two offset feature plates;
   - General, Appearance, and System settings as a tighter three-screen strip.
3. Use visible labels and short captions so each screen communicates a product
   capability without relying on text embedded in the image.
4. Use `loading="lazy"` and `decoding="async"` for every image below the first
   product proof. The first Insights image may use `fetchpriority="high"` only if
   it is likely to be within the initial viewport; otherwise use normal priority.
5. Add explicit width and height attributes matching the source dimensions to
   prevent layout shift.

Motion:

- main Insights frame: `data-reveal="scale"` through the shared reveal system;
- feature plates: opposing left/right reveals with 60ms stagger;
- settings strip: 60ms stagger, vertical 14px motion only;
- image hover on fine pointers only: frame translates `-3px` and the image
  scales to `1.008` over 260ms using `var(--ease-out-strong)`;
- no auto-advancing carousel, no continuous float, no 3D tilt;
- under reduced motion, remove all transform effects while keeping border/color
  feedback.

## Repo conventions to follow

- New page sections are Astro components imported by `site/src/pages/index.astro`.
- Section heading structure uses `SectionHeading.astro`.
- Colors, radii, spacing, durations, and easings must use existing tokens.
- The existing dotted global background and restrained borders are part of the
  aesthetic; screenshot frames should extend them, not introduce a new theme.

## Steps

1. Copy the seven source PNGs to `site/public/product/` with the destination names above.
2. Refactor `ProductProof.astro` to display `/product/vaani-insights.png` in the main workspace frame. Remove obsolete CSS-only fake editor markup and styles.
3. Create `site/src/components/ProductScreens.astro` using `SectionHeading` and the composition specified above.
4. Add the new component to `site/src/pages/index.astro` after `Capabilities`.
5. Add responsive CSS: two-column feature plates become one column below 900px; the settings strip becomes a horizontally scrollable, snap-aligned strip below 719px without hiding content.
6. Apply the exact restrained reveal and fine-pointer hover behavior above.
7. Ensure every image has useful alt text that names the screen and the capability shown.

## Boundaries

- Depends on plans 001 and 002.
- Do NOT expose local usernames, email addresses, API keys, tokens, or provider credentials in captions or alt text. The supplied screenshots are authorized product visuals; do not crop them to emphasize personal data.
- Do NOT create a lightbox or carousel dependency.
- Do NOT recolor, blur, or materially edit the screenshots.
- Do NOT retain duplicate fake UI that competes with the real images.

## Verification

- **Mechanical**: from `site/`, run `npm run check`, `npm run build`, and `npm test`.
- **Visual**: verify desktop at 1440px, tablet around 900px, and mobile around 390px. Screens must remain legible, frames must not overflow the page, and the mobile settings strip must scroll without trapping the page.
- Confirm image aspect ratios are preserved and no layout shift occurs as images load.
- Emulate reduced motion; screenshot plates must not translate or scale.
- **Done when**: the real application is the visual centerpiece of the site and every supplied screenshot appears once in a coherent narrative.
