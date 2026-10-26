---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Surface: plan view (public/index.html)

Mode: Operate. Desktop-first, after a workout: check what changes, send to Hevy. Settings change rarely.

## Direction contract

THESIS: The plan reads like a Munich '72 sports programme: a strict grid where colour means state. Refuses the generic card-with-blue-button list where every row looks the same.

OWN-WORLD: Pale cool ground, white table panels with 1px rules, sky-blue header band. State colours with fixed meanings: green = more kg, sky = new rep target, orange = weight drops back, silver = skipped / unchanged. Hanken Grotesk, tabular figures, two sizes in rows; rank by weight.

STORY: Owner sees per routine how many exercises go up, hold or drop, scans targets, opens reasons or settings only when needed, sends.

FIRST VIEWPORT: Sky header band (name, last workout, Odśwież). Routine heading with a segment stripe (one segment per exercise, coloured by state) and counts legend; isolated dark "Wyślij N zmian do Hevy" on the right. Table: exercise (thumb, name, one-line reason) | Ostatnio | Następny cel (large, coloured) | settings summary | state mark.

FORM: assigned direction, 6 of 7 on own list (Munich '72 Aicher programme). seed:5aece750c66d86e3. Signature move: the per-routine state stripe.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Recorded adaptations

- State mark sits before the target figure (not a trailing column): one glance reads state + value.
- Row type scale is 13 / 15 / 20 (reason, name, target); rank still by weight.
- Header band darkened to #1f78bf so 14px white text passes contrast.
- Orange is reserved for "weight drops back"; "Ustaw skok" uses ink weight + alert icon.
- Hevy thumbnails render grayscale so only state carries colour.
