// The "semantic" Mermaid layout: Mermaid's own ELK layout and drawing, with the semantic engine
// choosing how ELK lays the graph out. Registered through Mermaid's layout-loader API.
import elkLayouts from '../../vendor/layout-elk/mermaid-layout-elk.esm.mjs';
import { parseDirectives } from '../language/directives.js';
import { buildGraph } from '../model/graph.js';
import { resolveFacts, describeFacts } from '../facts/resolve.js';
import { layoutSemantically } from '../engine/layout.js';
import { applyAppearance } from '../style/appearance.js';

/** @typedef {import('../language/directives.js').Diagnostic} Diagnostic */
/** @typedef {import('../engine/layout.js').Choice} Choice */

/**
 * @typedef {object} Report  what the engine understood and decided for one diagram
 * @property {string[]} understood       facts in short lines
 * @property {Diagnostic[]} diagnostics  directive problems and layout notes
 * @property {number} directives         how many directives the source declared
 * @property {Choice | null} layout
 * @property {boolean} colored
 */

/**
 * @typedef {object} LoaderState
 * @property {Map<string, string>} sources   diagram id -> source text, filled by the render wrapper
 * @property {Map<string, Report>} reports   diagram id -> report of its last render
 * @property {{ colors: boolean, candidate?: string }} settings  `candidate` forces one layout candidate, for inspection
 */

const HOOK = '__semanticMermaidLayout';

/**
 * @param {LoaderState} state
 */
export function createSemanticLayout(state) {
  const found = elkLayouts.find((l) => l.name === 'elk');
  if (!found) throw new Error('the vendored ELK plugin has no "elk" layout');
  const elk = found;
  // the vendored ELK plugin reads one global hook, so semantic renders run one at a time
  let queue = Promise.resolve();

  /** Mermaid layout-loader render function. */
  const render = (/** @type {any} */ data4Layout, /** @type {any} */ svg, /** @type {any} */ helpers, /** @type {any} */ options) => {
    const job = queue.then(() => renderOne(data4Layout, svg, helpers, options));
    queue = job.catch(() => undefined);
    return job;
  };

  async function renderOne(data4Layout, svg, helpers, options) {
    const { render: elkRender } = await elk.loader();
    // the engine reads flowcharts; other diagram types drawn with this layout get Mermaid's plain ELK
    if (data4Layout.type !== 'flowchart-v2') return elkRender(data4Layout, svg, helpers, { ...options, algorithm: 'elk.layered' });
    const id = data4Layout.diagramId;
    const source = state.sources.get(id);
    const { annotations, diagnostics, count } = parseDirectives(source);
    const graph = buildGraph(data4Layout);
    const resolved = resolveFacts(graph, annotations);
    const facts = resolved.facts;
    if (!state.settings.colors) facts.colors = false;
    /** @type {Report} */
    const report = { understood: describeFacts(graph, facts), diagnostics: [...diagnostics, ...resolved.diagnostics], directives: count, layout: null, colored: false };
    if (source === undefined) report.diagnostics.push({ severity: 'info', message: 'source text not available to the layout; directives ignored, meaning inferred from structure' });
    report.colored = applyAppearance(data4Layout, graph, facts);

    /** @type {Choice | null} */
    let choice = null;
    /** @type {any} */ (globalThis)[HOOK] = async (/** @type {any} */ elkGraph, /** @type {any} */ elkInstance) => {
      const laid = await layoutSemantically(elkGraph, elkInstance, { graph, facts, force: state.settings.candidate });
      choice = laid.choice;
      return laid.result;
    };
    try {
      await elkRender(data4Layout, svg, helpers, { ...options, algorithm: 'elk.layered' });
    } finally {
      delete /** @type {any} */ (globalThis)[HOOK];
    }
    if (choice) {
      report.layout = choice;
      moveTitles(svg, id, /** @type {Choice} */ (choice).measurements.titleSides);
      for (const t of /** @type {Choice} */ (choice).tried) if (t.error) report.diagnostics.push({ severity: 'info', message: `layout candidate ${t.name} was skipped: ${t.error}` });
      for (const note of /** @type {Choice} */ (choice).unapplied) report.diagnostics.push({ severity: 'info', message: note });
    }
    state.reports.set(id, report);
  }

  return { name: 'semantic', loader: async () => ({ render }), algorithm: 'elk.layered' };
}

/**
 * Move group titles to the side the engine chose (Mermaid centres them).
 * @param {any} svg d3 selection of the diagram's SVG
 * @param {string} diagramId
 * @param {Map<string, 'center' | 'left' | 'right'>} sides
 */
function moveTitles(svg, diagramId, sides) {
  const root = svg.node?.();
  if (!root) return;
  for (const [groupId, side] of sides) {
    if (side === 'center') continue;
    const cluster = root.querySelector(`g.cluster[id="${CSS.escape(`${diagramId}-${groupId}`)}"]`);
    const frame = cluster?.querySelector(':scope > rect');
    const label = cluster?.querySelector(':scope > g.cluster-label');
    const content = label?.querySelector('foreignObject, text');
    const match = label?.getAttribute('transform')?.match(/translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/);
    if (!frame || !label || !match) continue;
    const x = Number(frame.getAttribute('x')), w = Number(frame.getAttribute('width'));
    const labelWidth = Number(content?.getAttribute('width')) || content?.getBBox?.().width || 0;
    const left = side === 'left' ? x + 8 : x + w - labelWidth - 8;
    label.setAttribute('transform', `translate(${left}, ${match[2]})`);
  }
}
