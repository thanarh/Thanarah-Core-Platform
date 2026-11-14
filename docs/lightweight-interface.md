# Lightweight interface and Arabic readability

The owner's latest request prioritizes responsiveness and connected Arabic
lettering over decorative styling across the public site and internal screens.
It does not authorize changing authentication, financial or clinical workflows.

## Changes

- All 26 HTML entrypoints load the shared lightweight presentation layer.
- Arabic descendants use normal letter and word spacing, including mixed
  Arabic/Latin brand labels. Local Tajawal regular and bold fonts replace
  render-blocking external font stylesheets. Their original SIL OFL license
  is included with the unmodified font files.
- Decorative shadows, text shadows, backdrop blur, transitions and animations
  are disabled. Keyboard focus retains an explicit outline.
- Public scroll/reveal/parallax observers and animation-frame work were removed,
  not merely hidden with CSS. The clinical relationship diagram remains static.
- Repeated eyebrows, visual indexes, empty footer marks and the orphaned caption
  under the deleted facade image were removed or hidden. Semantic headings,
  field labels, availability warnings, privacy notes and workflow states remain.
- Excess public section colors and gradients were neutralized. Light page
  introductions have explicit dark text; removing decorative label columns
  does not leave narrow or empty prose columns.
- Marketing copy no longer contains em dashes. No decorative emoji, unleash or
  sparkle wording was found in that copy. Technical missing-value formatting in
  existing business tables was not redesigned.

## Verification

- 73 targeted regression tests passed across the actual website renderers,
  all entrypoint stylesheet links, local fonts, tracking, static diagrams,
  availability copy and contrast/layout rules.
- TypeScript, changed-test ESLint, JavaScript syntax and diff checks passed.
- The existing build/start workflow restarted and served normally.
- Desktop homepage and mobile about-page screenshots confirmed the changes.
  Protected workspaces were covered by shared-style checks, not a new signed-in
  browser journey; their business operations were not changed.
- One cold-browser comparison against the development preview measured first
  contentful paint at 1,392 ms before and 736 ms after. Window load changed from
  1,402 ms to 481 ms. These are individual measurements, not guarantees for
  every device or network.
- Afterward the browser reported no external font resources, no tracked Arabic
  text, no page-level horizontal overflow and no active animations. The two
  local font requests completed in approximately 41–46 ms.
- Public catalog responses still depend on database latency. Observed requests
  ranged from approximately 0.44 seconds warm to 2.35 seconds after restarting;
  no database, authorization or catalog-publishing semantics were changed.

No production publishing or external provider activation was performed.
