# Render Semantic Mermaid in your app

This guide is for teams whose app already draws Mermaid diagrams in the browser, such as the diagrams in an assistant's replies. Adding Semantic Mermaid is one call before the first render:

```js
import mermaid from 'mermaid';
import { install } from 'semantic-mermaid';

const semantic = install(mermaid, { apply: 'directives' });
mermaid.initialize({ startOnLoad: false });

const { svg } = await mermaid.render('diagram-1', source);
semantic.report('diagram-1'); // undefined unless the semantic layout drew this diagram
```

With `apply: 'directives'`, a flowchart that contains Semantic Mermaid directives is drawn by the semantic layout, and every other diagram is drawn exactly as before. Directives are comment lines such as `%% @main A B C` and `%% @lanes User App`, described in [LANGUAGE.md](LANGUAGE.md). The cost is about 24 KB gzipped when the page loads, 656 KB gzipped more the first time a diagram uses the semantic layout, and about 32 ms per diagram, where ELK, Mermaid 12's default flowchart layout, takes about 21 ms.

## Requirements

- **Mermaid 12.1.** The engine drives a patched copy of Mermaid's ELK layout plugin, `@mermaid-js/layout-elk` 1.0.1, which is tied to Mermaid 12.1's internals. `semantic-mermaid` declares Mermaid `~12.1.0` as a peer dependency.
- **A browser page.** Mermaid measures text in the DOM. To render on a server, see [Render without a page](#render-without-a-page).

Install both packages:

```bash
npm install semantic-mermaid mermaid@~12.1.0
```

Pass `install` the Mermaid instance your app renders with. The package also installs Playwright, about 18 MB on disk, for its command-line tool; a browser bundle never includes it. Type declarations ship with the package, and every Mermaid `securityLevel` works, `sandbox` included.

## Register the layout

`install(mermaid, options)` does two things:

- It registers a Mermaid layout named `semantic`, through Mermaid's `registerLayoutLoaders`.
- It wraps `mermaid.render`, so the engine can read each diagram's text. Mermaid removes `%%` comments before it lays a diagram out, and directives are comments.

Call it once, before the first render. It takes three options:

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `apply` | `'directives'`, `'flowcharts'` | not set | Which diagrams get the semantic layout without a `layout` setting of their own; see [Choose which diagrams get the semantic layout](#choose-which-diagrams-get-the-semantic-layout) |
| `colors` | `true`, `false` | `true` | Whether the engine colours flowcharts by role; see [Themes and colours](#themes-and-colours) |
| `pageWidth` | a width in pixels | not set | The width of the column your diagrams are shown in. A drawing that column would shrink below 40% of its size, such as a long left-to-right row, is drawn turned when that fits better, and its report says so in an `info` note |

It returns an object with two methods. `configure({ colors, pageWidth })` changes those settings for later renders. `report(id)` tells you what the engine did with one diagram; see [Read what the engine did](#read-what-the-engine-did).

## Render with mermaid.render

Directives reach the engine only through `mermaid.render(id, text)`, the call that `install` wraps. Give each render its own id, as Mermaid already requires. The engine reads the diagram's text while Mermaid renders it, and keeps the reports of the 200 most recently rendered ids.

`mermaid.run()` and `startOnLoad: true` read diagram text from the page and bypass the wrapper. A diagram drawn that way still gets the semantic layout when the configuration selects it, but the engine can't see its directives and infers the main path, decisions and side boxes from the diagram's structure. `apply` can't select those diagrams. Their reports are filed under the id Mermaid generates, which is the `id` of the drawn SVG.

## Choose which diagrams get the semantic layout

| Setup | Flowcharts with directives | Flowcharts without directives | Other diagram types |
| --- | --- | --- | --- |
| `install(mermaid, { apply: 'directives' })` | semantic | your configured layout | your configured layout |
| `install(mermaid, { apply: 'flowcharts' })` | semantic | semantic, with meaning inferred | your configured layout |
| `install(mermaid)` and `mermaid.initialize({ layout: 'semantic' })` | semantic | semantic, with meaning inferred | state, class, ER and requirement diagrams get Mermaid's ELK layout; mindmaps fail to render; the rest are unaffected |
| `install(mermaid)` alone | only the diagrams that select `semantic` themselves | | |

For an app that shows model output, use `apply: 'directives'`. Diagrams your users already have keep their current look, and a diagram that carries directives was written for the semantic layout. A diagram whose only directive is misspelt is selected too, so its report can say what is wrong.

`apply: 'flowcharts'` also redraws flowcharts written without directives, and colours their starts, ends, decisions and side boxes. On 236 such flowcharts, the semantic layout drew fewer arrow crossings than ELK, Mermaid 12's default flowchart layout (430 against 443), and fewer crowded arrow ends (776 against 982). It has not been compared with dagre, the default before Mermaid 12, so if your app still draws with dagre, look at your own diagrams before you switch.

Setting `layout: 'semantic'` in Mermaid's configuration also works. Diagram types that follow Mermaid's layout setting then get Mermaid's ELK layout, which the semantic layout builds on. Mindmaps fail to render under it, as they do under `layout: 'elk'` in Mermaid 12.1.

A diagram can select the semantic layout itself, in its frontmatter:

```
---
config:
  layout: semantic
---
flowchart TD
  A --> B
```

or with an init line anywhere in its text: `%%{init: {"layout": "semantic"}}%%`. `apply` selects a diagram by appending that init line to the last line of the text it passes to Mermaid, so error line numbers stay as they were. A diagram that sets `layout` in its own configuration keeps it, so `layout: dagre` in a diagram's frontmatter opts that diagram out; other settings, such as `flowchart.defaultRenderer`, do not.

## Teach your model the directives

Under `apply: 'directives'`, a diagram gets the semantic layout only when its author writes directives. To have a model write them in your app, give it the directive reference and tell it that your app draws them. The "Directives" section of [skills/semantic-mermaid/SKILL.md](../skills/semantic-mermaid/SKILL.md) is that reference in about 20 lines, written for models. Agents that work outside your app can install the whole skill with `npx skills add yahorbarkouski/semantic-mermaid`.

To confirm the setup end to end, render a diagram the model wrote and check that `semantic.report(id)` is defined.

## When a render fails

- A directive that names a box the diagram doesn't have never stops the diagram from rendering. The engine ignores that directive and records an error in the diagram's report.
- A syntax error is Mermaid's own and rejects `mermaid.render` as it always has.
- If the ELK code cannot be downloaded, for example on a dropped connection, the semantic render rejects with "Failed to fetch dynamically imported module", and so does every later semantic render in that page, because the browser remembers the failed import. Catch that rejection, recognised by its message, and render the diagram again with `\n%%{init: {"layout": "dagre"}}%%` added to its text; `install` leaves a diagram that sets its own layout alone. Do this only for that message: a syntax error rendered again reports a line one lower.

## Themes and colours

The semantic layout works with every Mermaid theme and with each look: `neo`, `classic` and `handDrawn`.

The engine also colours flowcharts by role: blue for starts, ends, decisions and the arrows of a declared main path, rose for exits, orange for retries, and a dashed outline for side boxes. It has two palettes, one for each kind of theme:

- **Light:** Mermaid's light themes, `redux-color` (Mermaid 12's default), `redux`, `neo`, `default`, `neutral` and `base`, get pale fills with dark outlines.
- **Dark:** Mermaid's dark themes, `redux-dark-color`, `redux-dark`, `neo-dark` and `dark`, get dark fills with lighter outlines, in the same hues. So does any theme whose `themeVariables` set `darkMode: true`.

Under `forest`, which has colours of its own, a diagram keeps its theme's colours.

- To keep your theme's colours everywhere, call `install(mermaid, { colors: false })`. To change the setting later, call `semantic.configure({ colors })` before re-rendering.
- If your app's dark mode is the `base` theme with dark `themeVariables`, set `darkMode: true` among them, as Mermaid's own dark themes do. Without it, the engine treats `base` as a light theme and draws pale fills.
- If your theme is `base` with your own `themeVariables`, the role palette replaces your node and arrow colours on the diagrams it draws. Set `colors: false` to keep yours.
- The author's own styles (`style`, `classDef`, `linkStyle`) always win, and a diagram can turn the colours off with `%% @colors off`.

## Cost

Sizes were measured with esbuild (minified, with code splitting). Times were measured in Playwright's headless Chromium 1.63 on an Apple M4 Max.

| Part | When it loads | Gzipped size |
| --- | --- | --- |
| The engine and the `render` wrapper | with your bundle | 24 KB |
| ELK and the layout plugin | the first time a diagram uses the semantic layout | 656 KB (2.25 MB minified) |
| KaTeX | only when a label contains math | 78 KB |

The vendored plugin carries its own copy of ELK. Mermaid's own ELK plugin reuses the copy Mermaid already loads lazily and adds about 116 KB; if your app registers it as well, both copies ship. The package ships the vendored plugin unminified (5.1 MB), and your bundler minifies it.

Render times for 16 flowcharts of 5 to 15 boxes, the diagrams in this repository's `examples/` and `samples/` folders:

| Layout | Median render | Slowest render |
| --- | --- | --- |
| dagre (the default before Mermaid 12) | 19 ms | 27 ms |
| ELK (Mermaid 12's default) | 21 ms | 37 ms |
| Semantic | 32 ms | 77 ms |

The semantic layout runs ELK several times with different settings, scores each result, and keeps the best one. The first semantic render in a page also loads and compiles the ELK code; served locally, it took about 210 ms. Large diagrams cost more: a real flowchart with 90 arrows takes about 0.5 s, and the engine limits its most expensive layout on densely cross-linked graphs, which still take up to a few seconds.

Mermaid runs `render` and `parse` calls one at a time, and each runs on the main thread, so a semantic render delays every diagram queued behind it. A reply with ten flowcharts takes under half a second to draw. If your app draws diagrams while a reply streams in, render each one once its code block is complete.

## Read what the engine did

`report(id)` returns what the engine understood and decided for the diagram last rendered under that id, and `undefined` when the semantic layout didn't draw it. For [examples/order.mmd](../examples/order.mmd), with `@exit B -> X` changed to `@exit B -> Y`:

```js
semantic.report('diagram-1');
// {
//   understood: [
//     'main path (declared): A -> B -> C -> D -> E -> F',
//     'retries, drawn as returns (declared): G -> D',
//     'side branches of main-path decisions (inferred): B -> X, D -> G',
//     'side boxes: R (declared)',
//   ],
//   diagnostics: [
//     { severity: 'error', line: 11, message: '@exit: no node "Y"; ids are A, B, C, D, E, F, G, X, R' },
//   ],
//   directives: 4,
//   layout: { chosen: 'semantic', tried: [...], measurements: {...}, baseline: {...}, unapplied: [] },
//   colored: true,
// }
```

- `understood` lists the facts the engine used, each marked declared (from a directive) or inferred (from the diagram's structure).
- `diagnostics` holds problems with the directives, with line numbers, and `info` notes about the layout. `severity` is `error` for a directive the engine ignored, `warning` for one that doesn't fit the diagram, and `info` for a note.
- `layout.chosen` names the layout the engine kept. `layout.tried` lists every layout it tried, best first, each with its score (lower is better). `layout.unapplied` lists declared facts the chosen layout leaves out, with the reason.

The report is useful in development tools and logs, for example to show a diagram's author why a directive had no effect.

## Render without a page

To render on a server or export images, `createRenderer` from `semantic-mermaid/toolchain` runs Mermaid and the engine in headless Chromium through Playwright. `npx semantic-mermaid setup` downloads that browser once (about 95 MB), and needs Node 22.12 or later. The README's ["From Node"](../README.md#from-node) section shows the code.

## Limits

- The engine works with Mermaid 12.1 only.
- It lays out flowcharts (`flowchart` and `graph`) only.
- Diagrams drawn through `mermaid.run` or `startOnLoad` lose their directives, and `apply` can't select them.
- With `layout: 'semantic'` in Mermaid's configuration, mindmaps fail to render; use `apply` instead.
