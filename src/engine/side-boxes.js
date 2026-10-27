// Reserve decision routing corridors and adjacent one-link boxes as one measured block. ELK's comment-box
// processor rewrites fixed ports; reserving the block keeps both the port plan and the neighbours.

/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {object} Beside
 * @property {string} id
 * @property {any} step
 * @property {Point} stepAt
 * @property {{ node: any, at: Point, edge: any, port: { x: number, y: number, layoutOptions: Record<string, string> }, before: boolean }[]} boxes
 * @property {Map<string, { end: 'source' | 'target', points: Point[] }>} extensions
 */

/**
 * @param {any} root
 * @param {{ nodes: Map<string, any>, parentOf: Map<string, any> }} index
 * @param {Map<string, string>} portOwner
 * @param {Set<string>} merged
 * @returns {Beside[]}
 */
export function mergeSideBoxes(root, index, portOwner, merged) {
  const down = ['DOWN', 'UP'].includes(root.layoutOptions?.['elk.direction'] ?? 'DOWN');
  const groups = new Map();
  for (const node of index.nodes.values()) {
    if (merged.has(node.id) || !node.ports?.length || node.children?.length) continue;
    const sides = node.ports.map((p) => p.layoutOptions['elk.port.side']).filter((s) => down ? s === 'WEST' || s === 'EAST' : s === 'NORTH' || s === 'SOUTH');
    if (new Set(sides).size < sides.length) groups.set(node.id, []);
  }
  for (const node of index.nodes.values()) {
    if (node.layoutOptions?.['elk.commentBox'] !== 'true') continue;
    const own = root.edges.filter((e) => e.sources[0] === node.id || e.targets[0] === node.id);
    if (own.length !== 1) continue;
    const edge = own[0], other = edge.sources[0] === node.id ? edge.targets[0] : edge.sources[0];
    const partner = portOwner.get(other);
    if (partner === undefined) continue;
    const step = index.nodes.get(partner);
    if (!step || merged.has(step.id) || !step.ports?.length || index.parentOf.get(step.id) !== index.parentOf.get(node.id)) continue;
    const port = step.ports.find((p) => p.id === other);
    if (!port) continue;
    const s = port.layoutOptions?.['elk.port.side'];
    if (down ? s !== 'WEST' && s !== 'EAST' : s !== 'NORTH' && s !== 'SOUTH') continue;
    const before = s === 'WEST' || s === 'NORTH';
    const list = groups.get(step.id) ?? [];
    list.push({ node, edge, port, before }); groups.set(step.id, list);
  }
  const merges = [];
  for (const [stepId, boxes] of groups) {
    const step = index.nodes.get(stepId), parent = index.parentOf.get(stepId);
    const cross = (n) => down ? n.width : n.height;
    const time = (n) => down ? n.height : n.width;
    const point = (a, t) => down ? { x: a, y: t } : { x: t, y: a };
    const selected = new Set(boxes.map((b) => b.edge.id));
    const touching = root.edges.filter((e) => !selected.has(e.id) && [e.sources[0], e.targets[0]].some((p) => portOwner.get(p) === stepId));
    const ports = step.ports.filter((p) => touching.some((e) => e.sources[0] === p.id || e.targets[0] === p.id));
    const corridors = new Map();
    const positive = ['DOWN', 'RIGHT'].includes(root.layoutOptions?.['elk.direction'] ?? 'DOWN');
    // Reversed retries are forward edges during layout. Route them through the forward
    // boundary even when their final attachment is on the earlier half of the decision.
    const earlierBoundary = (p) => positive !== touching.some((e) => e.sources[0] === p.id);
    for (const p of ports) {
      const side = p.layoutOptions['elk.port.side'];
      const earlier = earlierBoundary(p);
      const sharing = ports.filter((q) => q.layoutOptions['elk.port.side'] === side && earlierBoundary(q) === earlier)
        .sort((a, b) => earlier ? (down ? a.y - b.y : a.x - b.x) : (down ? b.y - a.y : b.x - a.x));
      const links = touching.filter((e) => sharing.some((q) => e.sources[0] === q.id || e.targets[0] === q.id));
      const partners = new Set(links.map((e) => portOwner.get(e.sources[0]) === stepId ? e.targets[0] : e.sources[0]));
      const partner = partners.size === 1 ? index.nodes.get([...partners][0]) : undefined;
      // Match ELK's evenly spaced ports on a shared leaf, so parallel branch/return routes
      // need no sideways correction between the reserved block and that leaf.
      const matches = partner && !partner.children?.length && !partner.ports?.length && root.edges.filter((e) => e.sources[0] === partner.id || e.targets[0] === partner.id).length === links.length;
      const stride = matches ? Math.max(12, cross(partner) / (links.length + 1)) : 12;
      corridors.set(p.id, stride * (sharing.indexOf(p) + 1));
    }
    const sides = [true, false].map((before) => {
      const members = boxes.filter((b) => b.before === before);
      const reaches = ports.filter((p) => p.layoutOptions['elk.port.side'] === (down ? (before ? 'WEST' : 'EAST') : (before ? 'NORTH' : 'SOUTH'))).map((p) => corridors.get(p.id) + 12);
      const gap = Math.max(0, ...reaches, ...members.map((b) => (b.edge.labels?.[0]?.[down ? 'width' : 'height'] ?? 0) + 36));
      return { members, gap, width: Math.max(0, ...members.map((b) => cross(b.node))), length: members.reduce((s, b) => s + time(b.node), 0) + Math.max(0, members.length - 1) * 16 };
    });
    const thickness = Math.max(time(step), ...sides.map((s) => s.length));
    const length = cross(step) + sides.reduce((n, s) => n + s.width + s.gap, 0);
    const stepAt = point(sides[0].width + sides[0].gap, (thickness - time(step)) / 2);
    let id = `${stepId}__beside_boxes`;
    while (index.nodes.has(id)) id += '_';
    /** @type {any} */
    const wide = { id, width: down ? length : thickness, height: down ? thickness : length, ports: [], layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };
    const crossAt = down ? stepAt.x : stepAt.y, timeAt = down ? stepAt.y : stepAt.x;
    /** @type {Beside} */
    const merge = { id, step, stepAt, boxes: [], extensions: new Map() };
    sides.forEach((side, i) => {
      let t = (thickness - side.length) / 2;
      for (const box of side.members) {
        const a = i === 0 ? side.width - cross(box.node) : crossAt + cross(step) + side.gap;
        merge.boxes.push({ ...box, at: point(a, t) }); t += time(box.node) + 16;
      }
    });
    // Main ports extend straight through the reserved block. A side-facing branch that has a
    // neighbour in front of it leaves through the gap's near time boundary, clear of that box.
    for (const p of ports) {
      const s = p.layoutOptions['elk.port.side'];
      const actual = { x: stepAt.x + p.x, y: stepAt.y + p.y };
      const alongTime = down ? s === 'NORTH' || s === 'SOUTH' : s === 'WEST' || s === 'EAST';
      let at = actual;
      /** @type {Point[]} */ let via = [];
      let side = s;
      if (alongTime) {
        const before = s === 'NORTH' || s === 'WEST';
        at = point(down ? actual.x : actual.y, before ? 0 : thickness);
      } else {
        const before = s === 'WEST' || s === 'NORTH', neighbour = sides[before ? 0 : 1];
        if (neighbour.gap) {
          const position = down ? p.y : p.x;
          const earlier = earlierBoundary(p);
          const reach = corridors.get(p.id);
          const a = before ? crossAt - reach : crossAt + cross(step) + reach;
          const t = earlier ? 0 : thickness;
          at = point(a, t);
          via = [point(a, timeAt + position)];
          side = down ? (earlier ? 'NORTH' : 'SOUTH') : (earlier ? 'WEST' : 'EAST');
        }
      }
      wide.ports.push({ ...p, x: at.x, y: at.y, layoutOptions: { ...p.layoutOptions, 'elk.port.side': side } });
      for (const e of touching) {
        if (e.sources[0] === p.id) merge.extensions.set(e.id, { end: 'source', points: [actual, ...via, at] });
        if (e.targets[0] === p.id) merge.extensions.set(e.id, { end: 'target', points: [actual, ...via, at] });
      }
    }
    root.edges = root.edges.filter((e) => !selected.has(e.id));
    const removed = new Set([step, ...boxes.map((b) => b.node)]);
    const slot = parent.children.indexOf(step);
    parent.children = parent.children.filter((n) => !removed.has(n));
    parent.children.splice(Math.min(slot, parent.children.length), 0, wide);
    merges.push(merge);
  }
  return merges;
}

/** @param {any} result @param {Beside[]} merges @param {(root: any) => {boxes: Map<string, any>, frameOf: (from: string, to: string) => Point}} frames */
export function splitSideBoxes(result, merges, frames) {
  const placed = new Map();
  const walk = (node) => {
    for (const child of [...(node.children ?? [])]) {
      const merge = merges.find((m) => m.id === child.id);
      if (!merge) { walk(child); continue; }
      placed.set(merge.id, child);
      merge.step.x = child.x + merge.stepAt.x; merge.step.y = child.y + merge.stepAt.y;
      for (const box of merge.boxes) { box.node.x = child.x + box.at.x; box.node.y = child.y + box.at.y; }
      node.children.splice(node.children.indexOf(child), 1, merge.step, ...merge.boxes.map((b) => b.node));
    }
  };
  walk(result);
  const { boxes, frameOf } = frames(result);
  for (const merge of merges) {
    const wide = placed.get(merge.id);
    if (!wide) continue;
    const step = boxes.get(merge.step.id);
    const origin = { x: step.x - merge.stepAt.x, y: step.y - merge.stepAt.y };
    for (const edge of result.edges ?? []) {
      const ext = merge.extensions.get(edge.id), section = edge.sections?.[0];
      if (!ext || !section) continue;
      const offset = frameOf(edge.sources[0], edge.targets[0]);
      const add = ext.points.map((p) => ({ x: origin.x + p.x - offset.x, y: origin.y + p.y - offset.y }));
      if (ext.end === 'source') {
        section.bendPoints = [...add.slice(1, -1), section.startPoint, ...(section.bendPoints ?? [])];
        section.startPoint = add[0];
      } else {
        section.bendPoints = [...(section.bendPoints ?? []), section.endPoint, ...add.slice(1, -1).reverse()];
        section.endPoint = add[0];
      }
      const points = compact([section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
      section.startPoint = points[0]; section.endPoint = points.at(-1); section.bendPoints = points.slice(1, -1);
    }
    for (const box of merge.boxes) {
      const port = { x: step.x + box.port.x, y: step.y + box.port.y };
      const target = boxes.get(box.node.id);
      const incoming = box.edge.sources[0] === box.node.id;
      box.edge.sources = [incoming ? box.node.id : merge.step.id];
      box.edge.targets = [incoming ? merge.step.id : box.node.id];
      const offset = frameOf(box.edge.sources[0], box.edge.targets[0]);
      const down = box.port.layoutOptions['elk.port.side'] === 'WEST' || box.port.layoutOptions['elk.port.side'] === 'EAST';
      const end = down ? { x: target.x + (box.before ? target.w : 0), y: target.y + target.h / 2 }
        : { x: target.x + target.w / 2, y: target.y + (box.before ? target.h : 0) };
      const middle = down ? { x: (port.x + end.x) / 2, y: port.y } : { x: port.x, y: (port.y + end.y) / 2 };
      const middle2 = down ? { x: middle.x, y: end.y } : { x: end.x, y: middle.y };
      let points = compact([port, middle, middle2, end]);
      if (incoming) points = points.reverse();
      points = points.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y }));
      box.edge.sections = [{ id: `${box.edge.id}__s0`, startPoint: points[0], endPoint: points.at(-1), bendPoints: points.slice(1, -1) }];
      for (const label of box.edge.labels ?? []) { label.x = (port.x + end.x - label.width) / 2 - offset.x; label.y = (port.y + end.y - label.height) / 2 - offset.y; }
      result.edges.push(box.edge);
    }
  }
}

/** Remove duplicate points and subdivisions of a straight run without changing its geometry.
 * @param {Point[]} points @returns {Point[]}
 */
function compact(points) {
  const out = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if (Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) > 1e-6 || (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) < 0) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}
