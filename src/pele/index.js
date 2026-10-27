import { prepare, detectType, PeleError } from '../../vendor/pele/runtime.js';
import { buildGraph } from '../model/graph.js';
import { parseDirectives } from '../language/directives.js';
import { resolveFacts, describeFacts } from '../facts/resolve.js';
import { layoutSemantically } from '../engine/layout.js';
import { toElk, toPele, elkAdapter } from './geometry.js';
import { applyAppearance } from './appearance.js';

/** @typedef {import('../mermaid/loader.js').Report} Report */
/**
 * @typedef {import('pele').RenderOptions & {
 *   colors?: boolean, candidate?: string, apply?: 'flowcharts' | 'directives'
 * }} RenderOptions
 */
/** @typedef {import('pele').RenderResult & { report: Report | null }} RenderResult */

/** @param {string} source @param {RenderOptions} options */
function validate(source, options) {
  if (typeof source !== 'string') throw new TypeError('render and check take diagram source text');
  const limit = options.limit ?? 50000;
  if (source.length > limit) throw new PeleError(`Diagram source is longer than the limit of ${limit} characters.`, 'limit');
  if (options.apply !== undefined && !['flowcharts', 'directives'].includes(options.apply)) throw new Error('apply must be "flowcharts" or "directives"');
  if (options.maxWidth !== undefined && (!Number.isFinite(options.maxWidth) || options.maxWidth <= 0)) throw new Error('maxWidth must be a positive finite number');
}

/** @param {string} source @param {RenderOptions} options */
function prepareDiagram(source, options) {
  const parsed = parseDirectives(source);
  /** @type {{ graph: ReturnType<typeof buildGraph>, facts: import('../facts/resolve.js').Facts, flow: import('./bridge.js').FlowGraph, report: Report } | undefined} */
  let context;
  const job = prepare(source, options, (data, direction) => {
    // Internal IDs keep parallel edges and repeated author edge IDs distinct in ELK. The painter
    // still receives the original IDs, so links, styles and data-id attributes keep their meaning.
    const ids = new Set(data.nodes.map((n) => n.id));
    const flow = { ...data, edges: data.edges.map((e, i) => {
      let id = `__semantic_edge_${i}`;
      while (ids.has(id)) id += '_';
      ids.add(id);
      return { ...e, id };
    }) };
    if (!context) {
      const shapes = { diam: 'diamond', circ: 'circle', 'dbl-circ': 'doublecircle', 'double-circle': 'doublecircle', pill: 'stadium', event: 'rounded', roundedRect: 'rounded', stateStart: 'start', stateEnd: 'stop' };
      const graph = buildGraph({ ...flow, nodes: flow.nodes.map((n) => ({ ...n, shape: shapes[n.shape] ?? n.shape, cssClasses: n.cssClasses.split(/\s+/).filter((c) => c !== 'clickable').join(' ') })), edges: flow.edges.map((e) => ({ ...e, isLayoutOnly: e.thickness === 'invisible' })), direction });
      const resolved = resolveFacts(graph, parsed.annotations);
      const facts = resolved.facts;
      if (options.colors === false) facts.colors = false;
      context = { graph, facts, flow, report: { understood: describeFacts(graph, facts), diagnostics: [...parsed.diagnostics, ...resolved.diagnostics], directives: parsed.count, layout: null, colored: false } };
    }
    context.report.colored = applyAppearance(flow, context.graph, context.facts);
    flow.edges.forEach((e, i) => { data.edges[i].style = e.style; });
  });
  if (!context) throw new Error('Pele did not prepare a flowchart');
  const layout = job.config.layout;
  // Pele resolves YAML and init directives in their actual precedence order; the shared source
  // scanner's layout warning can describe a setting that a later directive superseded.
  context.report.diagnostics = context.report.diagnostics.filter((d) => !d.message.startsWith("the diagram's configuration sets layout:"));
  if (layout !== undefined && layout !== 'semantic' && parsed.count) {
    context.report.diagnostics.push({ severity: 'warning', message: `the diagram's configuration sets layout: ${layout}, so the semantic layout does not run and the directives have no effect; remove that setting` });
  }
  return { ...context, job };
}

/** Check syntax and semantic directives with Pele's parser, without ELK or a browser.
 * @param {string} source @param {RenderOptions} [options]
 * @returns {Promise<Report | null>}
 */
export async function check(source, options = {}) {
  validate(source, options);
  if (detectType(source) !== 'flowchart') {
    const { parse } = await import('pele');
    parse(source, options);
    const { count, diagnostics } = parseDirectives(source);
    return count || diagnostics.length ? { understood: [], diagnostics: [{ severity: 'warning', message: 'directives apply to flowcharts only, so they have no effect on this diagram' }], directives: count, layout: null, colored: false } : null;
  }
  const { report } = prepareDiagram(source, { ...options, colors: false });
  return report;
}

/**
 * Render with Pele's parser, shapes and SVG painter and Semantic Mermaid's layout.
 * No DOM or browser is needed. `maxWidth` gives the semantic scorer the reading-column width;
 * Pele's native tight/turned retries are replaced by the semantic engine's direction selection.
 * @param {string} source
 * @param {RenderOptions} [options]
 * @returns {Promise<RenderResult>}
 */
export async function render(source, options = {}) {
  validate(source, options);
  const parsed = parseDirectives(source);
  if (detectType(source) !== 'flowchart' || (options.apply === 'directives' && !parsed.count && !parsed.diagnostics.length)) {
    const { render: native } = await import('pele');
    return { ...native(source, options), report: null };
  }
  const { job, graph, facts, flow, report } = prepareDiagram(source, options);
  if (job.config.layout !== undefined && job.config.layout !== 'semantic') {
    const { render: native } = await import('pele');
    return { ...native(source, options), report: null };
  }
  const { default: elkModule } = await import('elkjs/lib/elk.bundled.js');
  // elkjs's CJS constructor exports itself as .default, also described by its declarations.
  const elk = new elkModule.default();
  const laid = await layoutSemantically(toElk(flow, job.measured), elkAdapter(elk, flow, job.measured), { graph, facts, force: options.candidate, pageWidth: options.maxWidth, preserveDirection: options.autoDirection === false });
  const rendered = job.finish(toPele(laid.result, flow));
  report.layout = laid.choice;
  for (const t of laid.choice.tried) if (t.error) report.diagnostics.push({ severity: 'info', message: `layout candidate ${t.name} was skipped: ${t.error}` });
  for (const note of laid.choice.unapplied) report.diagnostics.push({ severity: 'info', message: note });
  return { ...rendered, report };
}
