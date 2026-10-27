# Render with Pele

Semantic Mermaid can use [Pele](https://github.com/obsidianmd/pele) to parse, measure and draw diagrams. Flowcharts get the same semantic directives and layout search as the Mermaid backend. SVG rendering works in Node without a DOM or headless browser.

## Use the SDK

```js
import { render, check } from 'semantic-mermaid/pele';

const source = `flowchart TD
  A([Order placed]) --> B{Payment ok?}
  B -->|yes| C[Ship]
  B -->|no| X[Notify customer]
  %% @main A B C
  %% @exit B -> X`;

const { svg, width, height, links, report } = await render(source, {
  maxWidth: 800,
  idPrefix: 'order',
});

// In a browser, insert svg into your diagram container.
// In Node, write svg to a file.
console.log(report.layout.chosen);

const checked = await check(source);
console.log(checked.diagnostics);
```

Both functions are asynchronous. `render` returns Pele's `svg`, `width`, `height`, `links`, `type` and `mermaidType`, plus a Semantic Mermaid `report`. `check` validates with Pele's parser and resolves the directives without running ELK; its report has `layout: null`. Parse and limit failures reject with Pele's error fields, including `code`. Directive errors appear in `report.diagnostics`; the CLI refuses to write an image containing those errors.

All flowcharts use semantic layout by default, including plain flowcharts whose meaning the engine infers. Set `apply: 'directives'` to select only annotated flowcharts. Other diagram types and flowcharts that explicitly choose another `config.layout` use native Pele, with `report: null`. An app can keep its existing Pele imports and renderer; this entry point does not change their registration or configuration. It also works in a browser bundle, including the native pass-through path.

Pele's render options are accepted alongside `colors`, `candidate` and `apply`. Fonts, custom text measurement, links, images, icons, math, accessibility metadata, frontmatter and input/output limits stay in Pele's render path. Text measurers and icon/math resolvers must return the same result when called again: the bridge measures first, awaits layout, then draws the same source.

## Width and appearance

`maxWidth` tells the semantic engine the reading column's width. It may try another direction when a diagram would become too small to read. The result can still be wider than that column. `autoDirection: false` preserves the source direction. Pele's native spacing-tightening passes and `directionBreakpoint` do not run for semantic flowcharts; the semantic engine owns page fitting. A native pass-through diagram keeps Pele's ordinary width behavior.

Role styles use CSS variables, so changing a host's Pele theme recolors the same SVG. Starts, decisions, ends and the declared main path use `--pele-accent`; exits use `--pele-critical`; side boxes have dashed outlines. Override `--semantic-main`, `--semantic-exit` or `--semantic-retry` to change a role's stroke color. Node fills use `--pele-surface`, and label colors remain Pele's. Author `style`, `classDef`, default classes and `linkStyle` take precedence. `colors: false` or `%% @colors off` keeps Pele's colors.

Semantic flowcharts default to `step` curves with small rounded corners. This keeps the painted arrows close to the routes used for collision checks and label placement. Explicit global, source and per-edge curve settings take precedence.

Pele's shapes and label measurements differ from Mermaid's, so positions and the selected candidate can differ too. Pele's native parser compatibility is described in its [compatibility guide](https://pele.run/compatibility).

## Use the CLI

```bash
semantic-mermaid check order.mmd --renderer pele
semantic-mermaid render order.mmd --renderer pele -o order.svg
semantic-mermaid source order.svg
```

Pele SVG needs no `semantic-mermaid setup`. PNG export still needs the headless browser, used only to rasterize the SVG:

```bash
semantic-mermaid setup
semantic-mermaid render order.mmd --renderer pele -o order.svg -o order.png
```

`--page-width`, `--no-fit`, `--no-colors`, `--candidate`, `--verbose` and `--json` work with Pele. The CLI centers narrow images on an 800 px page by default. `--elk` selects the Mermaid baseline and cannot be combined with `--renderer pele`.

For the Node toolchain, use `createRenderer({ renderer: 'pele' })` from `semantic-mermaid/toolchain`. Its `render` and `close` methods have the same contract as the default renderer. Each Pele SVG call owns its state, so calls can run concurrently.

## Runtime and maintenance

This backend retains the async ELK candidate search. It does not inherit the speed or bundle-size claims of native Pele rendering. ELK loads on the first semantic render; native pass-through diagrams load Pele's full renderer on demand.

Pele 1.12.0 does not expose a public measured-layout API. A private bundle of its published core and flowchart entry points supplies that seam. It captures measured shapes, runs the shared semantic engine, and gives the winner back to Pele's own painter. The bundle owns its registry and is pinned to an exact Pele version. Pele's label escaping, URL filtering, image policy and output limits stay in its core. No finished SVG is rewritten to implement layout or role styles.

The bridge's source is [src/pele/bridge.js](../src/pele/bridge.js); [vendor/pele/VENDORED.md](../vendor/pele/VENDORED.md) records provenance and the license. Regenerate it with `npm run vendor:pele`, then run `node scripts/vendor-pele.js --check`, `npm run check-types` and `npm test`. Tests cover the Node and browser APIs, annotated examples, actual shape attachment, lanes and groups, concurrency, native pass-through parity, styles and safety limits, CLI SVG/PNG, source recovery and renderer isolation. A public layout seam in Pele could replace this version-specific bridge later.
