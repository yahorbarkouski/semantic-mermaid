import { readGeometry } from '../engine/geometry.js';

/** @typedef {import('./bridge.js').Measured} Measured */
/** @typedef {import('./bridge.js').FlowGraph} FlowGraph */

const DIRECTIONS = { TB: 'DOWN', TD: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

/** Pele measures shapes and labels; the shared semantic engine works on this ELK representation.
 * @param {FlowGraph} graph
 * @param {Measured} measured
 */
export function toElk(graph, measured) {
  const { nodes, edges, spacing } = measured;
  let rootId = '__semantic_root';
  const ids = new Set(graph.nodes.map((n) => n.id));
  while (ids.has(rootId)) rootId += '_';
  const root = {
    id: rootId,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': DIRECTIONS[measured.direction] ?? 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.spacing.nodeNode': String(spacing.nodeSep),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.rankSep),
      'elk.spacing.edgeEdge': String(spacing.edgeSep),
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    children: /** @type {any[]} */ ([]),
    edges: /** @type {any[]} */ ([]),
  };
  const elkNodes = nodes.map((n, i) => {
    const node = graph.nodes[i];
    const labelW = Math.max(0, n.minW - 2 * n.padX + 12);
    const labelH = Math.max(0, n.padTop - 16);
    return {
      id: node.id, width: n.w, height: n.h,
      layoutOptions: n.isGroup ? {
        'elk.padding': `[top=${n.padTop + 8},left=${n.padX},bottom=${n.padBottom},right=${n.padX}]`,
        'nodeSize.minimum': `(${n.minW},${n.padTop + n.padBottom})`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        ...(n.dir ? { 'elk.direction': DIRECTIONS[n.dir] ?? 'DOWN' } : {}),
      } : {},
      ...(n.isGroup ? { children: /** @type {any[]} */ ([]), labels: [{ text: node.label ?? '', width: labelW, height: labelH }] } : {}),
    };
  });
  nodes.forEach((n, i) => {
    const parent = n.parent < 0 ? root : elkNodes[n.parent];
    if (!parent.children) throw new Error(`Pele node ${graph.nodes[i].id} has a non-group parent`);
    parent.children.push(elkNodes[i]);
  });
  edges.forEach((e, i) => {
    // Pele reserves loop space in the node measurement and paints loops itself.
    if (e.src === e.dst) return;
    root.edges.push({
      id: graph.edges[i].id, minlen: e.minlen,
      sources: [graph.nodes[e.src].id], targets: [graph.nodes[e.dst].id],
      labels: e.labelW ? [{ text: graph.edges[i].label, width: e.labelW, height: e.labelH }] : [],
    });
  });
  return root;
}

/** Return a placement callback for Pele's painter, with routes in the author's direction.
 * @param {any} result
 * @param {FlowGraph} graph
 * @returns {import('./bridge.js').Placement}
 */
export function toPele(result, graph) {
  const geometry = readGeometry(result);
  const frames = new Map([...geometry.boxes, ...geometry.groups]);
  const routes = new Map(geometry.edges.map((e) => [e.id, e]));
  for (const node of graph.nodes) {
    const frame = frames.get(node.id);
    if (!frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite)) throw new Error(`semantic layout has no finite frame for ${node.id}`);
  }
  for (const edge of graph.edges) {
    if (edge.start === edge.end) continue;
    const route = routes.get(edge.id);
    if (!route || route.points.length < 2 || !route.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error(`semantic layout has no finite route for ${edge.id}`);
  }
  return (nodes, edges) => {
    nodes.forEach((node, i) => {
      const b = frames.get(graph.nodes[i].id);
      if (!b) throw new Error('semantic frame disappeared');
      node.x = b.x + b.w / 2; node.y = b.y + b.h / 2;
      if (node.isGroup) { node.w = b.w; node.h = b.h; }
    });
    edges.forEach((edge, i) => {
      const route = routes.get(graph.edges[i].id);
      if (!route) return; // self-loops are painted by Pele
      edge.route = route.points.flatMap((p, j, points) => {
        // At the destination Pele needs the incoming axis; at the source the outgoing one.
        const other = j === points.length - 1 ? points[j - 1] : points[j + 1];
        return [p.x, p.y, Math.abs(other.x - p.x) > Math.abs(other.y - p.y) ? 1 : 0];
      });
      const label = route.labels[0];
      if (label) { edge.labelX = label.x + label.w / 2; edge.labelY = label.y + label.h / 2; }
    });
    return { width: geometry.width, height: geometry.height };
  };
}

/**
 * Adapt Pele's minimum rank spans and physical group widths to ELK 0.9's layered coordinates.
 * This wraps each candidate after semantic transformations, so reversed loops and turned layouts
 * get the same constraints. Temporary rank nodes never reach the scorer or the SVG painter.
 * @param {{ layout: (root: any) => Promise<any> }} elk
 * @param {FlowGraph} graph
 * @param {Measured} measured
 */
export function elkAdapter(elk, graph, measured) {
  const spans = new Map(graph.edges.map((e, i) => [e.id, measured.edges[i].minlen]));
  return {
    async layout(root) {
      const groups = new Map();
      const owner = new Map();
      const minimums = new Map();
      const temporary = new Set();
      const walk = (node, parent, inherited) => {
        const direction = node.layoutOptions?.['elk.direction'] ?? inherited;
        if (parent) owner.set(node.id, parent);
        for (const port of node.ports ?? []) owner.set(port.id, node);
        if (node.children) groups.set(node.id, node);
        const minimum = node.layoutOptions?.['nodeSize.minimum'];
        // ELK 0.9 interprets minimum sizes in layered axes, whereas Pele measures physical w/h.
        if (minimum && (direction === 'DOWN' || direction === 'UP')) {
          const size = String(minimum).match(/^\(([\d.]+),\s*([\d.]+)\)$/);
          if (size) { minimums.set(node.id, minimum); node.layoutOptions['nodeSize.minimum'] = `(${size[2]},${size[1]})`; }
        }
        for (const child of node.children ?? []) walk(child, node, direction);
      };
      walk(root, null, root.layoutOptions?.['elk.direction'] ?? 'DOWN');
      const ancestor = (id) => {
        const chain = [];
        for (let node = owner.get(id); node; node = owner.get(node.id)) chain.push(node);
        return chain;
      };
      const originals = [...(root.edges ?? [])];
      const allIds = new Set([...owner.keys(), ...groups.keys(), ...originals.map((e) => e.id)]);
      const fresh = () => {
        let id = `__semantic_rank_${temporary.size}`;
        while (allIds.has(id)) id += '_';
        allIds.add(id); temporary.add(id); return id;
      };
      for (const edge of originals) {
        const span = spans.get(edge.id) ?? 1;
        if (span <= 1) continue;
        const from = edge.sources[0], to = edge.targets[0];
        const targets = new Set(ancestor(to));
        const parent = ancestor(from).find((n) => targets.has(n)) ?? root;
        let previous = from;
        for (let i = 1; i < span; i++) {
          const id = fresh();
          parent.children.push({ id, width: 0, height: 0 });
          root.edges.push({ id: fresh(), sources: [previous], targets: [id] });
          previous = id;
        }
        root.edges.push({ id: fresh(), sources: [previous], targets: [to] });
      }
      const clean = (node) => {
        if (minimums.has(node.id)) node.layoutOptions['nodeSize.minimum'] = minimums.get(node.id);
        if (node.children) node.children = node.children.filter((n) => !temporary.has(n.id));
        if (node.edges) node.edges = node.edges.filter((e) => !temporary.has(e.id));
        for (const child of node.children ?? []) clean(child);
        return node;
      };
      try { return clean(await elk.layout(root)); }
      finally { clean(root); }
    },
  };
}
