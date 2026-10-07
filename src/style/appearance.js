// Automatic colours: a small visual vocabulary that follows the diagram's meaning.
//
// Blue marks where the flow starts, decides and ends, and (when declared) the main path; rose
// marks declared exits, orange declared retries, slate side boxes. Ordinary steps stay neutral,
// nothing is coloured from a guess about failure (a "No" is not an error), and anything the
// author styled keeps the author's style. Mermaid's light themes get PALETTE, its dark themes (and any
// theme whose variables set darkMode) get DARK_PALETTE, the same roles in dark fills and lighter
// strokes; a theme with colours of its own, such as forest, keeps them.

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

export const DARK_PALETTE = {
  text: '#E6EAF0',
  step: { fill: '#1F242B', stroke: '#8B98A9', width: 1.25 },
  endpoint: { fill: '#15283B', stroke: '#6CA0D0', width: 1.6 },
  decision: { fill: '#15283B', stroke: '#6CA0D0', width: 1.6 },
  exit: { fill: '#35191A', stroke: '#E0776B', width: 1.5 },
  side: { fill: '#1A1F26', stroke: '#748196', width: 1.25, dash: '4 3' },
  group: { fill: '#181C22', stroke: '#3B4552' },
  arrow: { stroke: '#8B98A9', width: 1.4 },
  main: { stroke: '#6CA0D0', width: 2.2 },
  retry: { stroke: '#E8894A', width: 1.6 },
  exitArrow: { stroke: '#E0776B', width: 1.5 },
};

const LIGHT_THEMES = new Set(['redux-color', 'redux', 'neo', 'default', 'neutral', 'base', undefined]);
const DARK_THEMES = new Set(['redux-dark-color', 'redux-dark', 'neo-dark', 'dark']);

/**
 * The palette for Mermaid's theme, or null for a theme with colours of its own.
 * @param {{ theme?: string, themeVariables?: { darkMode?: boolean } }} config
 */
function paletteFor(config) {
  if (config.themeVariables?.darkMode || DARK_THEMES.has(config.theme ?? '')) return DARK_PALETTE;
  return LIGHT_THEMES.has(config.theme) ? PALETTE : null;
}

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
  const palette = paletteFor(data4Layout.config ?? {});
  if (!facts.colors || !palette) return false;
  for (const n of data4Layout.nodes ?? []) {
    const node = graph.nodes.get(n.id);
    if (!node || node.styled) continue;
    if (node.isGroup) { n.cssStyles = nodeStyle({ ...palette.group, width: 1 }); continue; }
    const role = facts.nodeRoles.get(n.id);
    const look = role === 'entry' || role === 'end' ? palette.endpoint
      : role === 'decision' ? palette.decision
        : role === 'exit' ? palette.exit
          : role === 'side' ? palette.side
            : palette.step;
    n.cssStyles = nodeStyle(look);
  }
  const edges = new Map(graph.edges.map((x) => [x.id, x]));
  for (const e of data4Layout.edges ?? []) {
    const edge = edges.get(e.id);
    if (!edge || edge.styled) continue;
    const role = facts.edgeRoles.get(e.id);
    // the main path is emphasised only when declared: an inferred path may be wrong
    const look = role === 'main' && facts.mainSource === 'declared' ? palette.main
      : role === 'retry' ? palette.retry
        : role === 'exit' ? palette.exitArrow
          : palette.arrow;
    e.style = arrowStyle(look);
  }
  return true;
}
