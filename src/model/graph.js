// The diagram as a plain graph, built from the layout data Mermaid hands to a layout loader.
// Everything downstream (facts, layout, colours) reads this model rather than Mermaid's objects.

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} label
 * @property {string} shape        Mermaid shape name, e.g. "diamond", "squareRect", "cylinder"
 * @property {string | undefined} parent  id of the enclosing group
 * @property {boolean} isGroup
 * @property {boolean} styled      the author gave this node its own style or class
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} id           Mermaid's edge id, e.g. "L_A_B_0"; ELK uses the same id
 * @property {string} from
 * @property {string} to
 * @property {string} label
 * @property {boolean} dotted
 * @property {boolean} styled      the author gave this arrow its own style (linkStyle)
 */

/**
 * @typedef {object} Graph
 * @property {Map<string, GraphNode>} nodes  every node and group, by id
 * @property {GraphEdge[]} edges
 * @property {string} direction  Mermaid direction: TB, TD, BT, LR or RL
 */

/**
 * @param {any} data4Layout Mermaid's layout data (nodes, edges, direction)
 * @returns {Graph}
 */
export function buildGraph(data4Layout) {
  /** @type {Map<string, GraphNode>} */
  const nodes = new Map();
  for (const n of data4Layout.nodes ?? []) {
    const classes = String(n.cssClasses ?? '').split(/\s+/).filter((c) => c && c !== 'default');
    nodes.set(n.id, {
      id: n.id,
      label: plainLabel(n.label),
      shape: n.shape ?? 'rect',
      parent: n.parentId ?? undefined,
      isGroup: n.isGroup === true,
      styled: (n.cssStyles?.length ?? 0) > 0 || classes.length > 0,
    });
  }
  const edges = (data4Layout.edges ?? [])
    .filter((e) => nodes.has(e.start) && nodes.has(e.end) && !e.isLayoutOnly)
    .map((e) => ({
      id: e.id,
      from: e.start,
      to: e.end,
      label: plainLabel(e.label),
      dotted: e.pattern === 'dotted' || e.stroke === 'dotted',
      styled: (e.style ?? []).some((s) => !/^fill:\s*none$/.test(String(s).trim())),
    }));
  return { nodes, edges, direction: normalizeDirection(data4Layout.direction) };
}

/** @param {string | undefined} d */
function normalizeDirection(d) {
  const v = String(d ?? 'TB').toUpperCase();
  return v === 'TD' ? 'TB' : ['TB', 'BT', 'LR', 'RL'].includes(v) ? v : 'TB';
}

/** Leaf nodes (boxes), without groups. */
export function boxes(graph) {
  return [...graph.nodes.values()].filter((n) => !n.isGroup);
}

/** Outgoing and incoming arrows of every node, by id. */
export function adjacency(graph) {
  /** @type {Map<string, GraphEdge[]>} */ const out = new Map();
  /** @type {Map<string, GraphEdge[]>} */ const into = new Map();
  for (const id of graph.nodes.keys()) { out.set(id, []); into.set(id, []); }
  for (const e of graph.edges) { out.get(e.from)?.push(e); into.get(e.to)?.push(e); }
  return { out, into };
}

/** @param {unknown} label */
function plainLabel(label) {
  return String(label ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
