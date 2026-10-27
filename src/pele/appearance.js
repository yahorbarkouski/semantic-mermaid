/** @typedef {import('../model/graph.js').Graph} Graph */
/** @typedef {import('../facts/resolve.js').Facts} Facts */
/** @typedef {import('./bridge.js').FlowGraph} FlowGraph */

// Pele's CSS tokens remain live when the host switches themes. Role tokens can be overridden too.
const MAIN = 'var(--semantic-main,var(--pele-accent,#35658A))';
const EXIT = 'var(--semantic-exit,var(--pele-critical,#B4473C))';
const RETRY = 'var(--semantic-retry,#C2410C)';

/** @param {FlowGraph} data @param {Graph} graph @param {Facts} facts */
export function applyAppearance(data, graph, facts) {
  if (!facts.colors) return false;
  for (const n of data.nodes) {
    if (graph.nodes.get(n.id)?.styled) continue;
    // The default class is an author style too, even though it has no explicit class name.
    if (n.cssCompiledStyles.length) continue;
    const role = facts.nodeRoles.get(n.id);
    const stroke = role === 'exit' ? EXIT : role === 'entry' || role === 'end' || role === 'decision' ? MAIN : undefined;
    if (stroke) n.cssStyles = [`stroke:${stroke}`, 'fill:var(--pele-surface,#f3f3f3)', 'stroke-width:1.6px'];
    if (role === 'side') n.cssStyles = ['stroke-dasharray:4 3'];
  }
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  for (const e of data.edges) {
    if (edges.get(e.id)?.styled || e.cssCompiledStyles.length) continue;
    const role = facts.edgeRoles.get(e.id);
    const stroke = role === 'retry' ? RETRY : role === 'exit' ? EXIT : role === 'main' && facts.mainSource === 'declared' ? MAIN : undefined;
    if (stroke) e.style = [`stroke:${stroke}`, `stroke-width:${role === 'main' ? 2.2 : 1.6}px`];
  }
  return true;
}
