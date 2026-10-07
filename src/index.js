// Semantic Mermaid in the browser: register the "semantic" layout with a Mermaid instance.
//
//   import mermaid from 'mermaid';
//   import { install } from 'semantic-mermaid';
//   const semantic = install(mermaid);
//   mermaid.initialize({ layout: 'semantic' });
//   const { svg } = await mermaid.render('d1', source);
//   semantic.report('d1');   // what the engine understood and chose
//
// Directives live in `%%` comments, which Mermaid strips before layout, so `install` wraps
// `mermaid.render` to hand each diagram's text to the layout. Diagrams rendered another way
// (for example `mermaid.run`) still get the semantic layout, with meaning inferred from structure.
//
// `install(mermaid, { apply: 'directives' })` gives the semantic layout to the flowcharts that
// declare directives and leaves every other diagram on Mermaid's configured layout;
// `apply: 'flowcharts'` gives it to every flowchart. docs/EMBEDDING.md compares the ways to opt in.
import { createSemanticLayout } from './mermaid/loader.js';
import { parseDirectives, layoutSettings } from './language/directives.js';

export { parseDirectives, DIRECTIVES } from './language/directives.js';
export { buildGraph } from './model/graph.js';
export { resolveFacts, describeFacts } from './facts/resolve.js';
export { layoutSemantically, candidates } from './engine/layout.js';
export { PALETTE, DARK_PALETTE } from './style/appearance.js';

/** How many diagram sources and reports to remember. */
const KEEP = 200;

/** Selects the semantic layout for one diagram; Mermaid reads it wherever it stands in the text. */
const SELECT = '%%{init: {"layout": "semantic"}}%%';
const FLOWCHARTS = new Set(['flowchart', 'flowchart-v2']);
const APPLY = new Set(['flowcharts', 'directives']);

/** @param {Map<string, unknown>} map */
function forgetOldest(map) {
  for (const key of map.keys()) {
    if (map.size <= KEEP) return;
    map.delete(key);
  }
}

/**
 * @param {any} mermaid a Mermaid 12 instance
 * @param {{ colors?: boolean, apply?: 'flowcharts' | 'directives' }} [options]
 *   `apply` picks the diagrams that get the semantic layout without a `layout` setting:
 *   'flowcharts' every flowchart, 'directives' the flowcharts that declare at least one directive.
 *   A diagram that sets a layout in its own configuration keeps that layout.
 */
export function install(mermaid, options = {}) {
  if (options.apply !== undefined && !APPLY.has(options.apply)) throw new Error(`install: apply must be "flowcharts" or "directives", got ${JSON.stringify(options.apply)}`);
  /** Whether `apply` selects the semantic layout for this diagram text. */
  const selects = (/** @type {string} */ text) => {
    if (!options.apply || typeof text !== 'string' || layoutSettings(text).length) return false;
    let type;
    try {
      type = mermaid.detectType(text);
    } catch {
      return false; // not a diagram Mermaid knows; its own render reports the error
    }
    return FLOWCHARTS.has(type) && (options.apply === 'flowcharts' || parseDirectives(text).count > 0);
  };
  /** @type {import('./mermaid/loader.js').LoaderState} */
  const state = { sources: new Map(), reports: new Map(), settings: { colors: options.colors !== false } };
  mermaid.registerLayoutLoaders([createSemanticLayout(state)]);

  const render = mermaid.render.bind(mermaid);
  mermaid.render = (/** @type {string} */ id, /** @type {string} */ text, /** @type {Element | undefined} */ container) => {
    state.sources.set(id, text);
    forgetOldest(state.sources);
    forgetOldest(state.reports);
    return render(id, selects(text) ? `${text}\n${SELECT}\n` : text, container);
  };

  return {
    /** @param {{ colors?: boolean, candidate?: string }} settings  `candidate` forces one layout candidate, for inspection */
    configure(settings) {
      if (settings.colors !== undefined) state.settings.colors = settings.colors;
      if ('candidate' in settings) state.settings.candidate = settings.candidate;
    },
    /** Report of the last render of a diagram id, or undefined. */
    report: (/** @type {string} */ id) => state.reports.get(id),
  };
}
