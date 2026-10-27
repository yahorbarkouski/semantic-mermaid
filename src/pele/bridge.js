// Bundled into vendor/pele/runtime.js so Pele's registry is private to this adapter.
import { parse, render, register, detectType, PeleError } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';

export { detectType, PeleError };

/** @typedef {import('pele').RenderOptions} RenderOptions */
/** @typedef {{ id: string, label?: string, shape: string, parentId?: string, isGroup: boolean, cssStyles: string[], cssCompiledStyles: string[], cssClasses: string }} FlowNode */
/** @typedef {{ id: string, start: string, end: string, label: string, pattern?: string, thickness?: string, style: string[], cssCompiledStyles: string[] }} FlowEdge */
/** @typedef {{ nodes: FlowNode[], edges: FlowEdge[] }} FlowGraph */
/** @typedef {{ w: number, h: number, parent: number, isGroup: boolean, dir?: string, padX: number, padTop: number, padBottom: number, minW: number, x: number, y: number }} MeasuredNode */
/** @typedef {{ src: number, dst: number, minlen: number, labelW: number, labelH: number, route: number[], labelX: number, labelY: number }} MeasuredEdge */
/** @typedef {{ nodeSep: number, edgeSep: number, rankSep: number }} Spacing */
/** @typedef {{ nodes: MeasuredNode[], edges: MeasuredEdge[], direction: string, spacing: Spacing }} Measured */
/** @typedef {(nodes: MeasuredNode[], edges: MeasuredEdge[]) => { width: number, height: number }} Placement */
/**
 * @typedef {object} Prepared
 * @property {FlowGraph} graph
 * @property {NonNullable<RenderOptions['config']>} config
 * @property {Measured} measured
 * @property {(apply: Placement) => import('pele').RenderResult} finish
 */

/**
 * Parse through Pele's own preprocessing and protections. Each parsed model retains its own
 * renderer, so restoring this private registry before returning does not affect an in-flight job.
 * @param {string} source
 * @param {RenderOptions} options
 * @param {(graph: FlowGraph, direction: string) => void} prepareGraph
 * @returns {Prepared}
 */
export function prepare(source, options, prepareGraph) {
  const captured = {};
  /** @type {Measured | undefined} */
  let measured;
  /** @type {Placement | undefined} */
  let placement;
  /** @type {FlowGraph | undefined} */
  let prepared;
  /** @type {NonNullable<RenderOptions['config']>} */
  let effectiveConfig = {};
  const variant = {
    type: 'flowchart',
    prepare(/** @type {FlowGraph} */ graph) { prepared = graph; },
    layout(/** @type {MeasuredNode[]} */ nodes, /** @type {MeasuredEdge[]} */ edges, /** @type {string} */ direction, /** @type {Spacing} */ spacing) {
      if (placement) return placement(nodes, edges);
      measured = { nodes, edges, direction, spacing };
      throw captured;
    },
  };
  register({
    ...flowchart,
    render(model, config, drawOptions) {
      effectiveConfig = config;
      variant.prepare = (graph) => {
        prepared = graph;
        prepareGraph(graph, model.direction ?? 'TB');
      };
      // Pele 1.12's exported diagram points at renderFlowchart, whose fourth argument is a
      // FlowVariant. This single private seam is frozen into the reproducible vendor bundle.
      return Reflect.apply(flowchart.render, flowchart, [model, config, drawOptions, variant]);
    },
  });
  let model;
  try { model = parse(source, options); }
  finally { register(flowchart); }
  // Semantic page fitting owns direction selection; Pele must measure and draw the same pass.
  const drawOptions = { ...options, maxWidth: undefined, autoDirection: false };
  try { render(model, drawOptions); }
  catch (error) { if (error !== captured) throw error; }
  if (!measured || !prepared) throw new Error('Pele did not call the pinned flowchart layout bridge');
  const snapshot = measured;
  return {
    graph: prepared,
    config: effectiveConfig,
    measured: snapshot,
    /** @param {Placement} apply */
    finish(apply) {
      placement = (nodes, edges) => {
        if (nodes.length !== snapshot.nodes.length || edges.length !== snapshot.edges.length || nodes.some((n, i) => n.w !== snapshot.nodes[i].w || n.h !== snapshot.nodes[i].h)) {
          throw new Error('Pele measurements changed between layout and drawing; text, icon and math resolvers must be deterministic');
        }
        return apply(nodes, edges);
      };
      return render(model, drawOptions);
    },
  };
}
