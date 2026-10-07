// Side groups: a group whose boxes all serve one step sits beside that step, on the step's row.
//
// ELK lays out every group as one block in a layer of its own, so a group of references lands
// above the step it feeds. Here the step and its group are merged into one wide box for the main
// layout: the step at one end, the group at the other, with fixed ports where the step's own arrows
// meet it. ELK keeps that room free. Afterwards the wide box is split back into the step and the
// group, the group's inside comes from a small layout of its own, and the short arrows between the
// group and the step are drawn across the gap between them.
//
// In a top-down diagram the group sits to the left of a step it feeds and to the right of a step
// that feeds it; in a left-to-right diagram, above and below.

/** @typedef {import('../facts/resolve.js').Facts} Facts */
/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {object} Inner  the inside of one side group, laid out on its own
 * @property {number} width
 * @property {number} height
 * @property {Map<string, Point>} positions  member id -> position inside the group frame
 * @property {Map<string, { sections: any[], labels: any[] }>} edges  arrows between members
 */

/**
 * @typedef {object} Merge  one step and its side group, merged into a wide box
 * @property {string} wideId
 * @property {any} step          the step's ELK node
 * @property {any} group         the group's ELK node
 * @property {Point} stepAt      step position inside the wide box
 * @property {Point} groupAt     group position inside the wide box
 * @property {Inner} inner
 * @property {'in' | 'out'} toward
 * @property {boolean} down      the diagram runs top-down (group beside the step), else left-to-right (above or below)
 * @property {any[]} links       arrows between the members and the step (laid out here)
 * @property {any[]} innerEdges  arrows between members (laid out by the inner layout)
 * @property {Map<string, { end: 'source' | 'target', at: Point }>} extend  edge id -> where its
 *           end must continue from the wide box's border to the step's border, in wide-box coordinates
 */

/** Room between the group and its step. */
const GAP = 56;

/**
 * Lay out the inside of every side group: members in a column beside a top-down step, in a row
 * above or below a left-to-right step.
 * @param {any} elkGraph Mermaid's ELK graph
 * @param {{ layout: (g: any) => Promise<any> }} elk
 * @param {Facts} facts
 * @returns {Promise<Map<string, Inner>>}
 */
export async function layoutSideGroups(elkGraph, elk, facts) {
  /** @type {Map<string, Inner>} */
  const inner = new Map();
  if (!facts.sideGroups.size) return inner;
  const direction = elkGraph.layoutOptions?.['elk.direction'] ?? 'DOWN';
  const nodes = new Map();
  const walk = (n) => { for (const c of n.children ?? []) { nodes.set(c.id, c); walk(c); } };
  walk(elkGraph);
  for (const [groupId, side] of facts.sideGroups) {
    const group = nodes.get(groupId);
    if (!group) continue;
    const members = new Set(side.members);
    const edges = (elkGraph.edges ?? []).filter((e) => members.has(e.sources[0]) && members.has(e.targets[0]));
    const graph = {
      id: `${groupId}__inside`,
      layoutOptions: {
        'elk.algorithm': 'layered',
        // a set of references stacks across the flow, beside the step (unconnected boxes share a
        // layer); a group with arrows of its own keeps the diagram's direction
        'elk.direction': edges.length ? direction : direction === 'RIGHT' ? 'DOWN' : 'RIGHT',
        'elk.separateConnectedComponents': 'false',
        'elk.padding': group.layoutOptions?.['elk.padding'] ?? '[top=32,left=16,bottom=16,right=16]',
        'elk.spacing.nodeNode': '24',
        'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      },
      children: (group.children ?? []).map((c) => ({ id: c.id, width: c.width, height: c.height })),
      edges: edges.map((e) => ({ id: e.id, sources: [e.sources[0]], targets: [e.targets[0]], labels: (e.labels ?? []).map((l) => ({ text: l.text, width: l.width, height: l.height })) })),
    };
    const laid = await elk.layout(graph);
    const minimum = String(group.layoutOptions?.['nodeSize.minimum'] ?? '').match(/\(([\d.]+)/);
    inner.set(groupId, {
      width: Math.max(laid.width ?? 0, minimum ? Number(minimum[1]) : 0),
      height: laid.height ?? 0,
      positions: new Map((laid.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])),
      edges: new Map((laid.edges ?? []).map((e) => [e.id, { sections: e.sections ?? [], labels: e.labels ?? [] }])),
    });
  }
  return inner;
}

/**
 * Merge each step with its side group into one wide box (in place). Arrows touching the step are
 * moved to fixed ports on the wide box at the step's end; arrows inside or into the group are set
 * aside and drawn after layout.
 * @param {any} root ELK graph
 * @param {{ nodes: Map<string, any>, parentOf: Map<string, any> }} index
 * @param {Facts} facts
 * @param {Map<string, Inner>} inner
 * @param {Map<string, string>} portOwner  filled with wide-box port id -> step id
 * @returns {Merge[]}
 */
export function mergeSideGroups(root, index, facts, inner, portOwner) {
  const direction = root.layoutOptions?.['elk.direction'] ?? 'DOWN';
  if (direction !== 'DOWN' && direction !== 'RIGHT') return [];
  /** @type {Merge[]} */
  const merges = [];
  const taken = new Set();
  for (const [groupId, side] of facts.sideGroups) {
    const group = index.nodes.get(groupId), step = index.nodes.get(side.step), box = inner.get(groupId);
    const parent = index.parentOf.get(groupId);
    if (!group || !step || !box || step.children?.length || index.parentOf.get(side.step) !== parent || taken.has(side.step)) continue;
    taken.add(side.step);

    const down = direction === 'DOWN';
    const before = side.toward === 'in'; // the group comes first: left of a top-down step, above a left-to-right one
    const along = (w, h) => (down ? w : h), across = (w, h) => (down ? h : w);
    const length = along(box.width, box.height) + GAP + along(step.width, step.height);
    const thickness = Math.max(across(box.width, box.height), across(step.width, step.height));
    const groupAlong = before ? 0 : along(step.width, step.height) + GAP;
    const stepAlong = before ? along(box.width, box.height) + GAP : 0;
    const centre = (size) => (thickness - size) / 2;
    const pos = (a, c) => (down ? { x: a, y: c } : { x: c, y: a });
    const stepAt = pos(stepAlong, centre(across(step.width, step.height)));
    const groupAt = pos(groupAlong, centre(across(box.width, box.height)));
    const wide = { id: `${side.step}__beside_${groupId}`, width: down ? length : thickness, height: down ? thickness : length, ports: /** @type {any[]} */ ([]), layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };

    const members = new Set(side.members), links = new Set(side.links);
    const merge = /** @type {Merge} */ ({ wideId: wide.id, step, group, stepAt, groupAt, inner: box, toward: side.toward, down, links: [], innerEdges: [], extend: new Map() });
    const kept = [];
    /** @type {{ e: any, end: 'source' | 'target', side: 'arrive' | 'leave' | 'far' }[]} */
    const touching = [];
    for (const e of root.edges ?? []) {
      const [s, t] = [e.sources[0], e.targets[0]];
      if (links.has(e.id)) merge.links.push(e);
      else if (members.has(s) && members.has(t)) merge.innerEdges.push(e);
      else if (s === side.step || t === side.step) { touching.push({ e, end: s === side.step ? 'source' : 'target', side: facts.loops.has(e.id) ? 'far' : t === side.step ? 'arrive' : 'leave' }); kept.push(e); }
      else kept.push(e);
    }
    root.edges = kept;

    // ports on the wide box, spread over the step's own extent
    const stepBox = { x: stepAt.x, y: stepAt.y, w: step.width, h: step.height };
    for (const where of /** @type {const} */ (['arrive', 'leave', 'far'])) {
      const list = touching.filter((t) => t.side === where);
      list.sort((a, b) => Number(facts.mainPath.includes(b.e.id)) - Number(facts.mainPath.includes(a.e.id)));
      list.forEach((t, k) => {
        const offset = spread(k, list.length);
        let at, end;
        if (where === 'far') {
          // the side of the step away from the group: the wide box's border there is the step's own
          const farEdge = before ? (down ? stepBox.x + stepBox.w : stepBox.y + stepBox.h) : (down ? stepBox.x : stepBox.y);
          at = down ? { x: farEdge, y: stepBox.y + stepBox.h * offset } : { x: stepBox.x + stepBox.w * offset, y: farEdge };
          end = at;
        } else if (down) {
          const x = stepBox.x + stepBox.w * offset;
          at = { x, y: where === 'arrive' ? 0 : wide.height };
          end = { x, y: where === 'arrive' ? stepBox.y : stepBox.y + stepBox.h };
        } else {
          const y = stepBox.y + stepBox.h * offset;
          at = { x: where === 'arrive' ? 0 : wide.width, y };
          end = { x: where === 'arrive' ? stepBox.x : stepBox.x + stepBox.w, y };
        }
        const portSide = where === 'far' ? (down ? (before ? 'EAST' : 'WEST') : (before ? 'SOUTH' : 'NORTH')) : down ? (where === 'arrive' ? 'NORTH' : 'SOUTH') : (where === 'arrive' ? 'WEST' : 'EAST');
        const pid = `${wide.id}__port_${where}_${k}`;
        wide.ports.push({ id: pid, x: at.x, y: at.y, width: 0, height: 0, layoutOptions: { 'elk.port.side': portSide } });
        portOwner.set(pid, side.step);
        if (t.end === 'source') t.e.sources = [pid]; else t.e.targets = [pid];
        if (end.x !== at.x || end.y !== at.y) merge.extend.set(t.e.id, { end: t.end, at: end });
      });
    }

    const slot = parent.children.indexOf(step);
    parent.children = parent.children.filter((c) => c !== step && c !== group);
    parent.children.splice(Math.max(0, Math.min(slot, parent.children.length)), 0, wide);
    merges.push(merge);
  }
  return merges;
}

/** Positions along a side for k of n arrows: the first in the middle, the rest alternating outwards. */
function spread(k, n) {
  if (n === 1) return 0.5;
  const order = [...Array(n).keys()].sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
  return (order[k] + 1) / (n + 1);
}

/**
 * After layout: split each wide box back into its step and group, extend the step's arrows from the
 * wide box's border to the step, and draw the arrows between the group and the step.
 * @param {any} result laid-out ELK graph, ports already mapped back to boxes
 * @param {Merge[]} merges
 * @param {(root: any) => { boxes: Map<string, { x: number, y: number, w: number, h: number }>, frameOf: (u: string, v: string) => Point }} frames
 */
export function splitSideGroups(result, merges, frames) {
  if (!merges.length) return;
  const placed = new Map();
  const walk = (n) => {
    for (const c of n.children ?? []) {
      const merge = merges.find((m) => m.wideId === c.id);
      if (merge) placed.set(merge.wideId, { parent: n, x: c.x ?? 0, y: c.y ?? 0 });
      walk(c);
    }
  };
  walk(result);
  for (const m of merges) {
    const at = placed.get(m.wideId);
    if (!at) continue;
    m.step.x = at.x + m.stepAt.x; m.step.y = at.y + m.stepAt.y;
    m.group.x = at.x + m.groupAt.x; m.group.y = at.y + m.groupAt.y;
    m.group.width = m.inner.width; m.group.height = m.inner.height;
    for (const c of m.group.children ?? []) { const p = m.inner.positions.get(c.id); if (p) { c.x = p.x; c.y = p.y; } }
    const slot = at.parent.children.findIndex((c) => c.id === m.wideId);
    at.parent.children.splice(slot, 1, m.step, m.group);
    for (const e of m.innerEdges) {
      const laid = m.inner.edges.get(e.id);
      if (laid) { e.sections = laid.sections; e.labels = (e.labels ?? []).map((l, i) => ({ ...l, ...(laid.labels[i] ? { x: laid.labels[i].x, y: laid.labels[i].y } : {}) })); }
    }
    result.edges = [...(result.edges ?? []), ...m.innerEdges, ...m.links];
  }

  const { boxes, frameOf } = frames(result);
  for (const m of merges) {
    const at = placed.get(m.wideId);
    if (!at) continue;
    const wide = { x: (boxes.get(m.step.id)?.x ?? 0) - m.stepAt.x, y: (boxes.get(m.step.id)?.y ?? 0) - m.stepAt.y };
    // the step's own arrows: from the wide box's border to the step's border
    for (const e of result.edges) {
      const ext = m.extend.get(e.id), section = e.sections?.[0];
      if (!ext || !section) continue;
      const o = frameOf(e.sources[0], e.targets[0]);
      const p = { x: wide.x + ext.at.x - o.x, y: wide.y + ext.at.y - o.y };
      if (ext.end === 'target') { section.bendPoints = [...(section.bendPoints ?? []), section.endPoint]; section.endPoint = p; }
      else { section.bendPoints = [section.startPoint, ...(section.bendPoints ?? [])]; section.startPoint = p; }
    }
    // the arrows between the group and the step
    const step = boxes.get(m.step.id), group = boxes.get(m.group.id);
    if (step && group) routeLinks(m, step, group, boxes, frameOf);
  }
}

/**
 * Short orthogonal arrows across the gap. Each arrow meets the step at its own point; arrows that
 * must bend turn in their own lane, the one with the longest detour nearest the step, so none cross.
 */
function routeLinks(m, step, group, boxes, frameOf) {
  const before = m.toward === 'in', across = m.down;
  const ends = m.links.map((e) => {
    const member = boxes.get(e.sources[0] === m.step.id ? e.targets[0] : e.sources[0]);
    return { e, member };
  }).filter((x) => x.member);
  // a = the axis the arrows run along (x when the group is beside a top-down step), c = across it
  const A = across ? 'x' : 'y', C = across ? 'y' : 'x', LEN = across ? 'w' : 'h', WID = across ? 'h' : 'w';
  ends.sort((p, q) => (p.member[C] + p.member[WID] / 2) - (q.member[C] + q.member[WID] / 2));
  const n = ends.length;
  const stepFace = before ? step[A] : step[A] + step[LEN];
  const groupFace = before ? group[A] + group[LEN] : group[A];
  const targets = ends.map((x, k) => {
    const mid = x.member[C] + x.member[WID] / 2;
    const lo = step[C] + 6, hi = step[C] + step[WID] - 6;
    return mid >= lo && mid <= hi ? mid : step[C] + step[WID] * (k + 1) / (n + 1);
  });
  // lanes: the longer the detour, the nearer the step
  const detour = ends.map((x, k) => Math.abs(x.member[C] + x.member[WID] / 2 - targets[k]));
  const rank = detour.map((d, k) => [d, k]).sort((p, q) => q[0] - p[0]).map(([, k]) => k);
  const lane = new Map(rank.map((k, r) => [k, r]));
  const gap = Math.abs(stepFace - groupFace);
  const step8 = Math.min(10, (gap - 16) / Math.max(1, n));
  ends.forEach(({ e, member }, k) => {
    const mid = member[C] + member[WID] / 2, t = targets[k];
    const memberFace = before ? member[A] + member[LEN] : member[A];
    const turn = before ? stepFace - 10 - (lane.get(k) ?? 0) * step8 : stepFace + 10 + (lane.get(k) ?? 0) * step8;
    const pt = (a, c) => (across ? { x: a, y: c } : { x: c, y: a });
    const path = Math.abs(mid - t) < 1 ? [pt(memberFace, t), pt(stepFace, t)] : [pt(memberFace, mid), pt(turn, mid), pt(turn, t), pt(stepFace, t)];
    // arrows run in the author's direction: member -> step for inputs, step -> member for outputs
    const points = e.sources[0] === m.step.id ? [...path].reverse() : path;
    const o = frameOf(e.sources[0], e.targets[0]);
    const local = points.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
    e.sections = [{ id: `${e.id}__s0`, startPoint: local[0], endPoint: local[local.length - 1], bendPoints: local.slice(1, -1) }];
    if (e.labels?.length) {
      const a = local[0], b = local[1];
      e.labels = e.labels.map((l) => ({ ...l, x: (a.x + b.x) / 2 - (l.width ?? 0) / 2, y: (a.y + b.y) / 2 - (l.height ?? 0) / 2 }));
    }
  });
}
