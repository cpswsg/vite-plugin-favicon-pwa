# ILLUSTRATION.md

Style spec for `vite-plugin-favicon-pwa` brand artwork (social preview, docs
diagrams, future marketing art). Derived from the v1 social preview, corrected to
the palette the plugin actually ships.

## 1. Visual Theme & Atmosphere

**Style seed:** Technical / Blueprint, editorial variant.

**Keywords:** drafted, authored, precise, tactile, warm-technical, specimen sheet,
registration marks, print-shop.

**Mood:** A typographic specimen page from a print shop. The artwork should read as
something a person drew with intent on paper, not something a service generated. Its
authority comes from precision and restraint, not from effects.

**Manifesto:** *One mark, drafted once, reproduced exactly at every size.*

**NOT-keywords:** bloom, glow, sparkle, mesh gradient, glassmorphism, neon, colored
drop shadow, floating cards, AI-render sheen, cyan-on-charcoal SaaS.

## 2. Palette & Color Roles

The palette **is** the plugin's shipped defaults. This is deliberate: the artwork
must demonstrate the product's real output, not advertise a scheme the tool does not
produce. If these values change in `src/options.ts`, this file and the art change
with them.

```css
--canvas:   #f7f3ea;  /* DEFAULTS.background — page ground, icon tile fill      */
--ink:      #15110b;  /* DEFAULTS.themeColor — type, mark geometry, rules, arrows */
--accent:   #df5914;  /* vermilion — mark center, route nodes, rules only        */
--grid:     #15110b @ 0.07 alpha;  /* blueprint grid                             */
--hairline: #15110b @ 0.28 alpha;  /* registration marks, orbit path             */
```

**Roles are exclusive.** `--accent` never carries type or structure; it marks the
center of the mark, the nodes on the orbit, and the two rules in the text block.
`--ink` carries everything structural. There is no fourth hue.

**Light/dark:** The artwork is single-ground by design (cream). It is not themable.
GitHub renders social previews on both themes, and a cream card with near-black ink
holds on either because it carries its own ground.

**Contrast targets:** ink on canvas is 15.8:1. The smallest icon in the size chain
must still clear 7:1 between mark and tile.

## 3. Geometry & Construction

- **Canvas:** `viewBox="0 0 1280 640"` — GitHub's social preview ratio. No other
  aspect for this piece.
- **Grid:** 40px blueprint grid, hairline weight, full bleed. It is a substrate, not
  a decoration — it must never compete with the mark.
- **Source mark:** the project mark from `example/public/mark.svg`, viewBox
  `0 0 100 100`, used verbatim. Two paths: a hexagonal ring (evenodd) and a solid
  inner hexagon. Never redraw it, never restyle its silhouette.
- **Icon tiles:** rounded squares, corner radius 22% of tile edge (matching the
  plugin's `radius: 0.18` default, optically adjusted). Mark inset 18% per side.
- **Stroke system:** 2px hairlines for structure at 1280 scale; 3px for the orbit
  path; 6px for accent rules. Butt caps, miter joins. No stroke below 1.5px.
- **Depth:** flat, with one permitted device — a hard-edged offset shadow in `--ink`
  at 0.10 alpha, offset 4/4, no blur. Nothing else casts.
- **Detail level:** balanced. Every element must survive being viewed at 600px wide
  in a GitHub timeline card.

## 4. Composition & Style

- **Split:** type left (72–700), orbit right (700–1240). The two zones do not
  overlap; the negative gutter between them is the composition's spine.
- **Focal hierarchy:** (1) hero mark, (2) headline, (3) size chain, (4) subhead,
  (5) grid and registration marks.
- **The orbit is the argument.** A hero mark at 300px steps down through a sweeping
  arc to a 16px tile. The progression *is* the product claim — one source, every
  size — so the small end is load-bearing and must stay razor-sharp. If the smallest
  tile is not crisp, the piece has failed regardless of how the rest looks.
- **Fill-driven, not line-driven.** The mark is chunky solid geometry; keeping it
  fill-based is what lets it survive down to 16px where strokes would break up.
- **Negative space:** at least 64px clear around the headline block. The card should
  feel drafted with room, not packed.

## 5. Motion

**Tier M0 — static.** The deliverable is a PNG for GitHub's social preview slot,
which is a still image. No motion, no reduced-motion fallback required.

## 6. Accessibility & Semantics

- The SVG is meaningful, not decorative: `role="img"`, `<title>`, `<desc>`.
- Title: the package name plus the tagline. Desc: names the size progression, since
  that is the content a screen reader would otherwise lose entirely.
- The README embeds the PNG with descriptive alt text carrying the same information.
- Type is real text in the SVG source (converted at raster time), never an image of
  text in the source file.
- Ink-on-canvas 15.8:1; the smallest tile mark holds above 7:1.

## 7. Output & Delivery

- **Source:** `.github/assets/social-preview-v3.svg` — hand-authored, readable.
- **Raster:** `.github/assets/social-preview-v3.png`, exactly 1280×640.
- **Size budget: under 250KB.** GitHub's social preview ceiling is 1MB and v2 sat at
  94% of it. Flat color is small by construction; if a render approaches the budget,
  the cause is an effect that does not belong here.
- **Precision:** 2 decimals on path data. No editor metadata, no empty groups, no
  redundant transforms.

## 8. Do's & Don'ts

**Do**

1. Take the palette from `src/options.ts` — the card demonstrates real output.
2. Keep the blueprint grid, corner registration marks, and orbit from v1.
3. Use exactly one accent hue, and only for mark center, orbit nodes, and rules.
4. Render the mark from `example/public/mark.svg` geometry, unaltered.
5. Verify the smallest tile in the chain at 1:1 before shipping.
6. Prefer flat fills — they are cheaper, sharper, and on-message for an icon tool.
7. Add energy through scale, spacing, and bolder geometry.
8. Re-render and look at the PNG after every change.

**Don't**

1. Don't add bloom, glow, sparkles, or mesh gradients.
2. Don't add glass cards, gloss, or colored/blurred shadows.
3. Don't introduce a fourth hue, and never magenta or cyan.
4. Don't soften the mark's silhouette — crispness is the product claim.
5. Don't let the smallest icons drop below 7:1 against their tile.
6. Don't set type in the accent color.
7. Don't let the grid read louder than the mark.
8. Don't let the card's palette drift from the plugin's shipped defaults; if they
   genuinely need refreshing, change `src/options.ts` first and re-derive the art.
