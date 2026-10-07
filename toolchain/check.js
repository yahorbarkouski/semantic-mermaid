// Node API: check a diagram without drawing it. Mermaid's parser runs in Node, and the engine binds
// the directives to the parsed boxes and arrows, so a check needs no browser: it starts in a
// fraction of a second and works without Chromium installed. Only drawing needs the browser.
//
//   const report = await checkDiagram(source);   // throws Mermaid's parse error
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDirectives } from '../src/language/directives.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts, describeFacts } from '../src/facts/resolve.js';

/** @typedef {import('../src/mermaid/loader.js').Report} Report */

/** @type {Promise<any> | null} */
let loading = null;

/**
 * Mermaid, loaded for parsing only. Mermaid passes labels through DOMPurify, which needs a browser
 * DOM. A check produces no HTML, so that DOMPurify instance (the one Mermaid itself imports) passes
 * text through unchanged.
 */
function mermaidParser() {
  loading ??= (async () => {
    const fromMermaid = createRequire(fileURLToPath(import.meta.resolve('mermaid')));
    const purify = path.join(path.dirname(fromMermaid.resolve('dompurify')), 'purify.es.mjs');
    // with a DOM (jsdom in a test runner) DOMPurify works as it is and the app may rely on it
    if (typeof window === 'undefined') {
      const { default: DOMPurify } = await import(pathToFileURL(purify).href);
      Object.assign(DOMPurify, { sanitize: (/** @type {string} */ text) => text, addHook() {}, removeHook() {}, removeHooks() {} });
    }
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    return mermaid;
  })();
  return loading;
}

/**
 * For a diagram other than a flowchart that declares directives: a report saying they have no effect.
 * @param {string} source
 * @returns {Report | null}
 */
export function directivesIgnored(source) {
  const { count, diagnostics } = parseDirectives(source);
  if (!count && !diagnostics.length) return null;
  return { understood: [], diagnostics: [{ severity: 'warning', message: 'directives apply to flowcharts only, so they have no effect on this diagram' }], directives: count, layout: null, colored: false };
}

/**
 * What the engine understands of a diagram, and the problems with its directives. The layout is not
 * computed, so the report has no layout and no notes about it; `render` has both.
 * @param {string} source Mermaid or Semantic Mermaid text
 * @returns {Promise<Report | null>} for a diagram other than a flowchart, null, or a warning when it declares directives
 */
export async function checkDiagram(source) {
  const mermaid = await mermaidParser();
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
  if (typeof diagram.db.getData !== 'function' || !String(diagram.type).startsWith('flowchart')) return directivesIgnored(source);
  const { annotations, diagnostics, count } = parseDirectives(source);
  const graph = buildGraph(diagram.db.getData());
  const resolved = resolveFacts(graph, annotations);
  return {
    understood: describeFacts(graph, resolved.facts),
    diagnostics: [...diagnostics, ...resolved.diagnostics],
    directives: count,
    layout: null,
    colored: false,
  };
}
