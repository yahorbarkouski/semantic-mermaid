// Automatic colours: a small visual vocabulary that follows the diagram's meaning.
//
// Blue marks where the flow starts, decides and ends, and (when declared) the main path; rose
// marks declared exits, orange declared retries, slate side boxes. Ordinary steps stay neutral,
// nothing is coloured from a guess about failure (a "No" is not an error), and anything the
// author styled keeps the author's style. The palette is for Mermaid's light themes.

/** @typedef {import('../model/graph.js').Graph} Graph */
/** @typedef {import('../facts/resolve.js').Facts} Facts */

export const PALETTE = {
  text: '#1F2933',
  step: { fill: '#FFFFFF', stroke: '#64748B', width: 1.25 },
  endpoint: { fill: '#EAF2FB', stroke: '#35658A', width: 1.6 },
  decision: { fill: '#EAF2FB', stroke: '#35658A', width: 1.6 },
  exit: { fill: '#FDF2F2', stroke: '#B4473C', width: 1.5 },
  side: { fill: '#F8FAFC', stroke: '#94A3B8', width: 1.25, dash: '4 3' },
  group: { fill: '#F8FAFC', stroke: '#CBD5E1' },
  arrow: { stroke: '#64748B', width: 1.4 },
  main: { stroke: '#35658A', width: 2.2 },
  retry: { stroke: '#C2410C', width: 1.6 },
  exitArrow: { stroke: '#B4473C', width: 1.5 },
};

const LIGHT_THEMES = new Set(['default', 'neutral', 'base', undefined]);

/** @param {{ fill: string, stroke: string, width?: number, dash?: string }} s */
const nodeStyle = (s) => [`fill:${s.fill}`, `stroke:${s.stroke}`, `stroke-width:${s.width ?? 1}px`, ...(s.dash ? [`stroke-dasharray:${s.dash}`] : [])];
/** @param {{ stroke: string, width: number }} s */
const arrowStyle = (s) => [`stroke:${s.stroke}`, `stroke-width:${s.width}px`, 'fill:none'];

/**
 * Colour Mermaid's layout data in place, before Mermaid draws it.
 * @param {any} data4Layout
 * @param {Graph} graph
 * @param {Facts} facts
 * @returns {boolean} whether colours were applied
 */
export function applyAppearance(data4Layout, graph, facts) {
  const theme = data4Layout.config?.theme;
  if (!facts.colors || !LIGHT_THEMES.has(theme)) return false;
  for (const n of data4Layout.nodes ?? []) {
    const node = graph.nodes.get(n.id);
    if (!node || node.styled) continue;
    if (node.isGroup) { n.cssStyles = nodeStyle({ ...PALETTE.group, width: 1 }); continue; }
    const role = facts.nodeRoles.get(n.id);
    const look = role === 'entry' || role === 'end' ? PALETTE.endpoint
      : role === 'decision' ? PALETTE.decision
        : role === 'exit' ? PALETTE.exit
          : role === 'side' ? PALETTE.side
            : PALETTE.step;
    n.cssStyles = nodeStyle(look);
  }
  const edges = new Map(graph.edges.map((x) => [x.id, x]));
  for (const e of data4Layout.edges ?? []) {
    const edge = edges.get(e.id);
    if (!edge || edge.styled) continue;
    const role = facts.edgeRoles.get(e.id);
    // the main path is emphasised only when declared: an inferred path may be wrong
    const look = role === 'main' && facts.mainSource === 'declared' ? PALETTE.main
      : role === 'retry' ? PALETTE.retry
        : role === 'exit' ? PALETTE.exitArrow
          : PALETTE.arrow;
    e.style = arrowStyle(look);
  }
  return true;
}
