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
import { createSemanticLayout } from './mermaid/loader.js';

export { parseDirectives, DIRECTIVES } from './language/directives.js';
export { buildGraph } from './model/graph.js';
export { resolveFacts, describeFacts } from './facts/resolve.js';
export { layoutSemantically, candidates } from './engine/layout.js';
export { PALETTE } from './style/appearance.js';

/** How many diagram sources and reports to remember. */
const KEEP = 200;

/** @param {Map<string, unknown>} map */
function forgetOldest(map) {
  for (const key of map.keys()) {
    if (map.size <= KEEP) return;
    map.delete(key);
  }
}

/**
 * @param {any} mermaid a Mermaid 12 instance
 * @param {{ colors?: boolean }} [options]
 */
export function install(mermaid, options = {}) {
  /** @type {import('./mermaid/loader.js').LoaderState} */
  const state = { sources: new Map(), reports: new Map(), settings: { colors: options.colors !== false } };
  mermaid.registerLayoutLoaders([createSemanticLayout(state)]);

  const render = mermaid.render.bind(mermaid);
  mermaid.render = (/** @type {string} */ id, /** @type {string} */ text, /** @type {Element | undefined} */ container) => {
    state.sources.set(id, text);
    forgetOldest(state.sources);
    forgetOldest(state.reports);
    return render(id, text, container);
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
