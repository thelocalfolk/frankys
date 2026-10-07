# Franky's theme — notes for Claude

Shopify theme for frankys.com.au (Stretch 2.1.0, "rebrand v2"), maintained by The Local Folk (Eliza Moodie).
Read `README.md` for the branch table. This file is the working context for the current build.

## Hard rules

- **Never push to, merge into, or connect `main`** unless Eliza explicitly asks. `main` is the snapshot of the live theme (28 Sep 2026) and is not connected to Shopify. Merging to `main` and deploying is her call.
- **The live theme is not connected to GitHub. Keep it that way.** Nothing in this repo should reach customers without a deliberate deploy.
- Work on a feature branch off `dev` (current one: `feature/build-your-setting`), merge into `dev` to preview, push `dev`.
- **Pull `dev` before starting.** The Shopify GitHub integration is two-way: theme-editor changes in the dev theme are committed to `dev` by `shopify[bot]` (usually `config/settings_data.json`, `locales/*.json`, `templates/*.json`).
- Don't create Pages, products or other store data to test with — those are store-wide and show on live. Preview with `?view=` instead (below).

## Preview

`dev` is connected to the unpublished theme **"Franky's – Dev"**. After a push, Shopify updates it within a minute or so.

- Shopify admin → Online Store → Themes → Franky's – Dev → ⋯ → Preview
- Builder page: any existing page plus `?view=build-your-setting`, e.g. `/pages/about?view=build-your-setting`
- Prefilled: add `&range=sweden&colour=sage-green&settings=6`

The real page (Online Store → Pages, template `build-your-setting`) is only created at launch.

## Conventions

- Franky's CSS overrides go in `assets/frankys-custom.css` (loaded after `theme.css` in `layout/theme.liquid`). Don't edit `theme.css`.
- Exception: a self-contained page component gets its own CSS/JS file loaded only by its section (the builder does this) so other pages don't pay for it.
- Comment custom code `FRANKY'S (TLF) Pn`, where n is the roadmap priority number (P1 = Build Your Setting, P2 = PDP setting cross-sell, P8 = breadcrumbs/pills, P9 = cart drawer).
- Reuse the theme's own classes, colour-scheme variables and events before writing new ones. Eliza and the client (Matthew) prefer recycling theme code over adding bulk.
- Australian spelling in copy and comments (colour, customise).
- Known pre-existing issue, not ours: missing `cart.general.add_to_cart` translation key (`cart-drawer.liquid` ~line 297). Leave for the P12 clean-up.

## Design and performance guardrails (Clarity, Sep 2026)

- 78% of sessions are mobile, ~40% mobile Safari, ~22% Instagram/Facebook in-app browsers. Build and check mobile first.
- Colour swatches are the #1 tap on product pages. Colour is how customers shop.
- LCP was fixed from 13.5s to 1.86s. Don't regress it: lazy-load below the fold, no render-blocking additions, don't preload every colour image.
- Average scroll depth is ~40%; what matters must be near the top.

## Build Your Setting (P1) — the table builder

Figma: "Table Builder – Desktop / Mobile" frames in the Frankys | Website Design file (the breadcrumb there says "Bed Builder"; ignore). The build uses the theme's existing styles for now; Steph's (designer) styling gets layered on later.

**Flow** (shape first, so later steps only show what exists):
0. optional "Be inspired" look → 1. shape → 2. colour → 3. how many settings (4 / 6 / 8 / Other) → 4. complete the table (coasters, napkins, tablecloth, cutlery) → 5. summary + add to cart.

**Files**

| File | Role |
|---|---|
| `sections/build-your-setting.liquid` | Markup, schema, and the JSON data the JS reads (`<script data-builder-data>`) |
| `templates/page.build-your-setting.json` | The page template, pre-filled with real products |
| `snippets/setting-builder-product-json.liquid` | One product → JSON (variants keyed by colour handle, swatches, `covers`) |
| `snippets/setting-builder-swatch.liquid` | Swatch colour: native Shopify swatch → theme "Colour swatch configuration" → label |
| `assets/frankys-setting-builder.js` | `<setting-builder>` custom element: state, rendering, URL, cart |
| `assets/frankys-setting-builder.css` | Styles, loaded by the section only |

**Data model** — everything comes from section blocks so it's editable in the theme editor:
- `range` block ("Shape"): placemat product, optional matching coaster, optional name / link key / line icon. A shape = a product; colour = the variant option named Colour.
- `addon` block ("Complete the table item"): label, product list, `covers` (4 = sold in sets of 4, rounded up with a note; 1 = one per setting; 0 = one per table). A product can override with metafield `custom.builder_covers_settings`.
- `preset` block ("Look (Be inspired)"): image, title, placemat + colour, coaster + colour (may be another range's coaster), up to 4 pieces + colours, number of settings. Each piece must also be in an `addon` block.
- Planned: move this to metaobjects (Colour, Setting range, Setting preset). Only the JSON-building part of the section should need to change; keep the JSON shape the JS reads.

**Behaviour to preserve**
- Only colours made in the chosen shape are shown; sold-out colours are disabled with product-page links.
- Coasters and add-ons follow the placemat colour until the shopper changes them by hand. If a piece isn't made in that colour, the first available is picked and a note says so.
- Tapping a look loads every piece into the builder. Tapping the selected look again clears it. "Start again" (beside the summary heading) resets everything. Changing any piece by hand un-selects the look.
- The look "loaded" / "cleared" messages are screen-reader only (`.sr-only`, `aria-live`). Eliza asked for them not to be visible.
- No "Add as is" / "Customise" / "View" buttons on looks.
- Add to cart is ONE `POST /cart/add.js` with all lines, each tagged with the hidden line property `_setting`. It dispatches the theme's `cart:prepare-bundled-sections`, then `variant:add` and `cart:change` (with `baseEvent: 'variant:add'`) so the theme's cart drawer opens and refreshes. Mirror `ProductForm` in `assets/theme.js` if that changes.
- Mobile sticky bar (total + add to cart) shows while the summary is off screen; hidden ≥1000px.
- The whole table lives in the URL so links are shareable and can prefill from product pages or Klaviyo:
  `?range=sweden&colour=sage-green&settings=4&coaster=peru-coaster.sage-green&add=prado-napkins.chocolate,messina-linen-tablecloth.olive` (`coaster=none` = no coasters, `source=` is for tracking).
- Tracking: `builder_start`, `builder_step`, `builder_prefill_source`, `builder_add_to_cart` via `Shopify.analytics.publish`, plus a `setting-builder:track` DOM event.
- Accessibility: real radios/checkboxes with visible labels, 44px tap targets, swatches named in text, total announced on change.

**What's in the template now**
- Shapes: Sweden, Seville, Lorient, Lorient+, Lorient Grande, Peru, Norway, Milan. Coasters set for Sweden, Seville, Lorient, Peru, Milan only.
- Add-ons: Napkins (6 products, sets of 4), Tablecloth (6, one per table), Cutlery (Peru gold / silver / black, each set covers 4).
- Looks: Long Lunch, Late Lunch, Dining Edit, Considered, Shared Table, Host's Table — pieces taken from the "Setting includes" list in each $289 "Table Setting" product description. Two looks pair Sweden placemats with Peru coasters on purpose.

## Open items — don't decide these alone, ask Eliza

- **Price mismatch:** a look built from individual pieces costs more than the matching $289 set product (e.g. Long Lunch $333, Shared Table $321). Options on the table: add the $289 set product when the look is unchanged; also show "Save $X as a set"; or leave at full price. No discount in v1 was agreed 17 Sep, so this needs Eliza/Matthew.
- Swatch config is missing Black Gold, Butter, Fuchsia, Ocean, Salmon (theme settings → Colour swatch configuration, or native swatches).
- Moroccan cutlery (4pc = one setting) is left out; needs its own add-on block or the `covers` metafield set to 1.
- Look images fall back to the $289 product photos until Steph's lifestyle shots are added in each Look block.
- Waiting on the client: quantity rounding rule (built as "round up and say so"), final page name/URL, preview photography (preview currently shows the placemat variant image plus thumbnails), coaster pairings for Norway / Lorient+ / Lorient Grande, and which linens "go with" which colour (add-ons currently show every colour).
- The duplicate product `the-hosts-table-setting2` is not used.
- Not built yet: grouping a setting's lines in the cart (the `_setting` property is there for it), and the P2 product-page block, which should reuse `<setting-builder>`.

## Checking your work

- Run Shopify Theme Check on changed files (`shopify theme check` if the CLI is installed). The new files were clean; existing warnings in other theme files are not ours.
- `node --check assets/frankys-setting-builder.js` for a quick syntax check.
- Then preview on the dev theme on a phone-width screen and on desktop: load a look, change the count, remove a piece, add to cart, open a shared link.
- There is no automated test suite in the repo. Say so plainly rather than implying something was tested when it was only read.

## More context

- Build log, launch plan and decisions: the Claude project "[CLIENT] - Franky's", doc "Frankys - Theme Repo & Dev Theme Setup" (also "16-Week Plan - Reprioritisation Decisions" and "Design & Dev Guardrails").
- Roadmap priorities: 1 Build Your Setting page, 2 PDP setting cross-sell, 3 branding/illustration rollout, 4 colour collections, 5 coasters & placemats, 6 social proof, 7 sizing visuals, 8 breadcrumbs & pills (done), 9 cart drawer returns + low stock (done).
