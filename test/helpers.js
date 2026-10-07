// Small builders for tests: Mermaid-like layout data and ELK graphs without a browser.

/**
 * Layout data as Mermaid hands it to a layout loader.
 * @param {string[]} arrows  "A-->B", "A-.->B" (dotted) or "A--label-->B"
 * @param {{ shapes?: Record<string, string>, parents?: Record<string, string>, groups?: string[] }} [extra]
 */
export function layoutData(arrows, { shapes = {}, parents = {}, groups = [] } = {}) {
  const ids = new Set();
  const edges = arrows.map((text, i) => {
    const m = text.match(/^(\w+)(-\.->|--(?:([^-]+)--)?>)(\w+)$/);
    if (!m) throw new Error(`bad arrow ${text}`);
    ids.add(m[1]); ids.add(m[4]);
    return { id: `L_${m[1]}_${m[4]}_${i}`, start: m[1], end: m[4], label: m[3] ?? '', pattern: m[2] === '-.->' ? 'dotted' : 'normal', style: [] };
  });
  const nodes = [
    ...groups.map((id) => ({ id, label: id, shape: 'rect', isGroup: true, cssClasses: '' })),
    ...[...ids].map((id) => ({ id, label: id, shape: shapes[id] ?? 'squareRect', isGroup: false, parentId: parents[id], cssStyles: [], cssClasses: 'default ' })),
  ];
  return { nodes, edges, direction: 'TB', config: { theme: 'default' }, diagramId: 'd' };
}

/** An ELK graph like the one Mermaid builds from the same layout data (flat, edges at the root). */
export function elkGraph(data) {
  const byParent = new Map();
  for (const n of data.nodes) {
    const node = { id: n.id, width: 80, height: 40, layoutOptions: {}, ...(n.isGroup ? { children: [] } : {}) };
    byParent.set(n.id, node);
  }
  const root = { id: 'root', layoutOptions: { 'elk.direction': 'DOWN' }, children: [], edges: [] };
  for (const n of data.nodes) (n.parentId ? byParent.get(n.parentId).children : root.children).push(byParent.get(n.id));
  root.edges = data.edges.map((e) => ({ id: e.id, sources: [e.start], targets: [e.end], labels: e.label ? [{ text: e.label, width: 20, height: 16 }] : [] }));
  return root;
}
