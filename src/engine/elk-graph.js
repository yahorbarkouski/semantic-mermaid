// Turning facts into ELK settings. Each function edits a copy of the ELK graph Mermaid built, and
// the graph is then laid out by ELK itself, so routing, label space and drawing stay Mermaid's.
//
// ELK graph conventions used here (Mermaid's): every edge sits at the root with the Mermaid edge id,
// `sources[0]`/`targets[0]` name boxes, and `layoutReversed` marks an edge whose ends were swapped
// for layout (Mermaid swaps them back when drawing).

import { mergeSideGroups, splitSideGroups } from './side-groups.js';

/** @typedef {import('../model/graph.js').Graph} Graph */
/** @typedef {import('../facts/resolve.js').Facts} Facts */
/** @typedef {import('./side-groups.js').Inner} Inner */
/** @typedef {import('./side-groups.js').Merge} Merge */

/**
 * @typedef {object} Features
 * @property {boolean} spine      straighten the main path
 * @property {boolean} loops      lay out declared retries as returns
 * @property {boolean} sideBoxes  put side boxes and terminal exits beside the box they belong to
 * @property {boolean} sideGroups put groups that serve one step beside that step
 * @property {boolean} ports      decisions: continuation from the vertex facing the flow, exits and
 *                                retries from the side vertices
 * @property {boolean} merge      arrows leaving one box share a trunk (a bus)
 * @property {boolean} peerOrder  keep declared peers in their declared order
 * @property {boolean} [simplex]  network-simplex node placement, which honours the main path's
 *                                straightness priority (Brandes-Köpf, ELK's default, mostly does not)
 * @property {string | null} direction  ELK direction to use instead of Mermaid's (DOWN, RIGHT)
 */

/**
 * Index of an ELK graph. Parents are kept in a Map keyed by object, because a diagram may name a
 * box "root", which is also the id of ELK's top-level graph.
 * @param {any} root
 */
function indexGraph(root) {
  /** @type {Map<string, any>} */ const nodes = new Map();
  /** @type {Map<string, any>} */ const parentOf = new Map();
  const walk = (n) => {
    for (const c of n.children ?? []) { nodes.set(c.id, c); parentOf.set(c.id, n); walk(c); }
  };
  walk(root);
  return { nodes, parentOf };
}

/** Ends of an ELK edge as the author drew the arrow. */
export const drawnEnds = (e) => (e.layoutReversed ? [e.targets[0], e.sources[0]] : [e.sources[0], e.targets[0]]);

/**
 * @typedef {object} Applied  what applyFeatures changed and must be undone after layout
 * @property {Map<string, string>} portOwner  port id -> box id
 * @property {Merge[]} merges                 steps merged with their side groups
 */

/**
 * Apply one candidate's features to an ELK graph (in place).
 * @param {any} root ELK graph
 * @param {Graph} graph
 * @param {Facts} facts
 * @param {Features} features
 * @param {Map<string, Inner>} [inner] side groups laid out on their own (layoutSideGroups)
 * @returns {Applied}
 */
export function applyFeatures(root, graph, facts, features, inner = new Map()) {
  const index = indexGraph(root);
  /** @type {Map<string, string>} */
  const portOwner = new Map();
  if (features.direction) root.layoutOptions['elk.direction'] = features.direction;
  if (features.simplex) root.layoutOptions['elk.layered.nodePlacement.strategy'] = 'NETWORK_SIMPLEX';
  if (features.loops) reverseLoops(root, facts);
  if (features.spine) straightenMainPath(root, facts);
  const merges = features.sideGroups ? mergeSideGroups(root, index, facts, inner, portOwner) : [];
  const merged = new Set(merges.map((m) => m.step.id));
  if (features.sideBoxes) placeSideBoxes(root, index, graph, facts, merged);
  if (features.ports) decisionPorts(root, index, facts, portOwner, merged);
  if (features.merge) mergeFanOuts(root, index, graph, facts, portOwner);
  if (features.peerOrder) orderPeers(root, index, facts);
  return { portOwner, merges };
}

/**
 * After layout: undo applyFeatures (ports, merged side groups) so Mermaid reads the graph it built.
 * @param {any} result laid-out ELK graph
 * @param {Applied} applied
 */
export function undoFeatures(result, applied) {
  restoreEdges(result, applied.portOwner);
  splitSideGroups(result, applied.merges, absoluteFrames);
  return result;
}

/** Declared retries become returns: ELK lays them out against the flow. */
function reverseLoops(root, facts) {
  for (const e of root.edges ?? []) {
    if (!facts.loops.has(e.id) || e.layoutReversed) continue;
    [e.sources, e.targets] = [e.targets, e.sources];
    e.layoutReversed = true;
  }
}

/**
 * The main path gets ELK's straightness priority. An inferred path is not straightened where that
 * would break a symmetric shape: at a fan-out without a known continuation, into a merge, or
 * through a decision whose branches meet again a few steps later. A declared path is the author's
 * choice and is straightened everywhere.
 */
function straightenMainPath(root, facts) {
  const edges = root.edges ?? [];
  const out = new Map(), into = new Map();
  for (const e of edges) {
    if (facts.loops.has(e.id)) continue;
    const [s, t] = drawnEnds(e);
    (out.get(s) ?? out.set(s, []).get(s)).push(t);
    into.set(t, (into.get(t) ?? 0) + 1);
  }
  const reach = (u) => {
    const seen = new Set([u]);
    let frontier = [u];
    for (let step = 0; step < 3; step++) {
      frontier = frontier.flatMap((x) => out.get(x) ?? []).filter((x) => !seen.has(x));
      frontier.forEach((x) => seen.add(x));
    }
    return seen;
  };
  const rejoins = (s) => {
    const sets = (out.get(s) ?? []).map(reach);
    return sets.length >= 2 && sets.every((r) => [...r].some((x) => sets.every((q) => q.has(x))));
  };
  const declared = facts.mainSource === 'declared';
  const main = new Set(facts.mainPath);
  for (const e of edges) {
    if (!main.has(e.id)) continue;
    const [s, t] = drawnEnds(e);
    const fork = (out.get(s)?.length ?? 0) >= 2;
    const known = facts.continuation.get(s) === e.id;
    const symmetric = !declared && ((fork && (!known || rejoins(s))) || (into.get(t) ?? 0) >= 2);
    if (symmetric) continue;
    e.layoutOptions = { ...(e.layoutOptions ?? {}), 'elk.layered.priority.straightness': '10', 'elk.layered.priority.shortness': '5' };
  }
}

/** Longest arrow label a box beside its step may carry; a longer one would push the box far away. */
const SIDE_LABEL = 24;

/**
 * Side boxes, and exits that end the flow right after a decision, become ELK comment boxes: ELK
 * places a comment box beside the box it is attached to. ELK supports this only for a box with a
 * single link inside the same group, and an arrow label needs room, so labelled links get extra
 * spacing and long labels are left alone.
 */
function placeSideBoxes(root, index, graph, facts, merged) {
  const links = new Map();
  for (const e of root.edges ?? []) for (const id of [e.sources[0], e.targets[0]]) links.set(id, [...(links.get(id) ?? []), e]);
  const edgeLabel = new Map(graph.edges.map((e) => [e.id, e.label]));
  const terminalExits = new Set();
  for (const [edgeId, role] of facts.edgeRoles) {
    if (role !== 'exit' && role !== 'branch') continue;
    const e = graph.edges.find((x) => x.id === edgeId);
    if (e && facts.nodeRoles.get(e.from) === 'decision') terminalExits.add(e.to);
  }
  const perPartner = new Map();
  /** @type {Map<any, number>} ELK reads comment spacing from the graph that holds the comment box */
  const roomIn = new Map();
  for (const id of new Set([...facts.sideBoxes.keys(), ...terminalExits])) {
    const node = index.nodes.get(id), own = links.get(id) ?? [];
    if (!node || node.children?.length || own.length !== 1) continue;
    const e = own[0], partner = e.sources[0] === id ? e.targets[0] : e.sources[0];
    const partnerNode = index.nodes.get(partner);
    if (!partnerNode || merged.has(partner) || partnerNode.children?.length || index.parentOf.get(partner) !== index.parentOf.get(id)) continue;
    const label = edgeLabel.get(e.id) ?? '';
    if (label.length > SIDE_LABEL) continue;
    // at most two boxes beside one step, or the step disappears among them
    const n = (perPartner.get(partner) ?? 0) + 1;
    if (n > 2) continue;
    perPartner.set(partner, n);
    node.layoutOptions = { ...(node.layoutOptions ?? {}), 'elk.commentBox': 'true' };
    const holder = index.parentOf.get(id);
    const room = label ? (e.labels?.[0]?.width ?? label.length * 7) + 56 : 36;
    roomIn.set(holder, Math.max(roomIn.get(holder) ?? 36, room));
  }
  for (const [holder, room] of roomIn) holder.layoutOptions = { ...(holder.layoutOptions ?? {}), 'elk.spacing.commentNode': String(room) };
}

/** Smallest fan-out drawn as a bus. */
const BUS = 4;

const SIDES = {
  DOWN: { arrive: 'NORTH', flow: 'SOUTH', first: 'EAST', second: 'WEST' },
  UP: { arrive: 'SOUTH', flow: 'NORTH', first: 'EAST', second: 'WEST' },
  RIGHT: { arrive: 'WEST', flow: 'EAST', first: 'SOUTH', second: 'NORTH' },
  LEFT: { arrive: 'EAST', flow: 'WEST', first: 'SOUTH', second: 'NORTH' },
};

/**
 * A decision with a known continuation gets fixed ports at its vertices: the continuation leaves
 * from the vertex facing the flow, exits and other branches from one side vertex, and every arrow
 * arrives at the opposite vertex. A branch whose target is a declared peer of the continuation's
 * target (or of another branch's target) leaves from the side that peer order puts it on; other
 * branches alternate sides. A retry leaves from the side its target sits on, or from the side away
 * from the branches when its target is on the main path. A side box comes in at a free side corner.
 */
function decisionPorts(root, index, facts, portOwner, merged) {
  const sides = SIDES[root.layoutOptions['elk.direction'] ?? 'DOWN'] ?? SIDES.DOWN;
  const at = (n, side) => ({ NORTH: [n.width / 2, 0], SOUTH: [n.width / 2, n.height], EAST: [n.width, n.height / 2], WEST: [0, n.height / 2] })[side];
  const target = (/** @type {any} */ e) => drawnEnds(e)[1];
  /** @type {{ id: string, touching: any[], side: Map<string, string>, retries: any[] }[]} */
  const decisions = [];
  for (const [id, continuation] of facts.continuation) {
    const node = index.nodes.get(id);
    if (!node || merged.has(id) || node.children?.length) continue;
    const touching = (root.edges ?? []).filter((e) => e.sources[0] === id || e.targets[0] === id);
    if (touching.some((e) => e.sources[0] === e.targets[0])) continue;
    const leaving = touching.filter((e) => drawnEnds(e)[0] === id);
    if (leaving.length < 2 || leaving.length > 3) continue;
    /** @type {Map<string, string>} */
    const side = new Map([[continuation, sides.flow]]);
    const ahead = target(leaving.find((e) => e.id === continuation) ?? leaving[0]);
    // peers come before the continuation's target on the second side and after it on the first
    const byPeers = (/** @type {string} */ x) => {
      const list = facts.peers.find((p) => p.includes(x));
      if (!list) return null;
      const other = list.includes(ahead) ? ahead : leaving.map(target).find((y) => y !== x && y !== ahead && list.includes(y));
      if (!other) return null;
      return list.indexOf(x) < list.indexOf(other) ? sides.second : sides.first;
    };
    let next = sides.first;
    const retries = [];
    for (const e of leaving) {
      if (e.id === continuation) continue;
      const role = facts.edgeRoles.get(e.id);
      const peer = byPeers(target(e));
      if (role === 'retry') retries.push(e);
      else if (role === 'exit') side.set(e.id, sides.first);
      else if (peer) side.set(e.id, peer);
      else { side.set(e.id, next); next = next === sides.first ? sides.second : sides.first; }
    }
    decisions.push({ id, touching, side, retries });
  }
  // a box off the main path sits on the side of the branch that reaches it; a retry heads for its
  // target's side, and for the side away from the branches when its target is on the main path
  const onMain = new Set((root.edges ?? []).filter((e) => facts.mainPath.includes(e.id)).flatMap(drawnEnds));
  /** @type {Map<string, string>} */
  const offSide = new Map();
  for (const { touching, side } of decisions) {
    for (const e of touching) {
      const s = side.get(e.id);
      if (!s || s === sides.flow) continue;
      const queue = [target(e)];
      while (queue.length) {
        const n = /** @type {string} */ (queue.shift());
        if (onMain.has(n) || offSide.has(n)) continue;
        offSide.set(n, s);
        for (const x of root.edges ?? []) if (drawnEnds(x)[0] === n && !facts.loops.has(x.id)) queue.push(target(x));
      }
    }
  }
  for (const { id, touching, side, retries } of decisions) {
    for (const e of retries) side.set(e.id, offSide.get(target(e)) ?? sides.second);
    const node = index.nodes.get(id);
    node.ports = [];
    node.layoutOptions = { ...(node.layoutOptions ?? {}), 'elk.portConstraints': 'FIXED_POS' };
    const port = (s) => {
      const pid = `${id}__port_${s}`;
      if (!portOwner.has(pid)) {
        const [x, y] = at(node, s);
        node.ports.push({ id: pid, x, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': s } });
        portOwner.set(pid, id);
      }
      return pid;
    };
    // a side box feeding the decision comes in at a side corner no arrow leaves from, so it can sit
    // beside the decision instead of above it
    const sending = new Set([...side.values()]);
    const free = [sides.second, sides.first].find((s) => !sending.has(s));
    for (const e of touching) {
      const fromSide = e.targets[0] === id && facts.sideBoxes.has(drawnEnds(e)[0]);
      const s = side.get(e.id) ?? (fromSide && free ? free : sides.arrive);
      if (e.sources[0] === id) e.sources = [port(s)];
      else e.targets = [port(s)];
    }
  }
}

/**
 * ELK's edge merging draws the arrows leaving one box as a shared trunk: a bus. Judges read a bus
 * as clean for a wide fan-out and as overlapping arrows for two or three, and a shared arrowhead as
 * hiding where arrows come from. So only fan-outs of BUS or more arrows merge: arrows of smaller
 * fan-outs, arrows into a box that several arrows reach, labelled arrows, a decision's outcomes and
 * returns keep a port of their own, which ELK never merges.
 */
function mergeFanOuts(root, index, graph, facts, portOwner) {
  root.layoutOptions['elk.layered.mergeEdges'] = true;
  const labelled = new Set(graph.edges.filter((e) => e.label).map((e) => e.id));
  const decisions = new Set([...facts.nodeRoles].filter(([, r]) => r === 'decision').map(([id]) => id));
  const fanIn = new Map(), fanOut = new Map();
  for (const e of root.edges ?? []) {
    fanIn.set(e.targets[0], (fanIn.get(e.targets[0]) ?? 0) + 1);
    fanOut.set(e.sources[0], (fanOut.get(e.sources[0]) ?? 0) + 1);
  }
  // ports sit on the side the flow implies (ELK refuses sideless ports on boxes it sizes)
  const sides = SIDES[root.layoutOptions['elk.direction'] ?? 'DOWN'] ?? SIDES.DOWN;
  const ownPort = (id, side) => {
    const node = index.nodes.get(id);
    if (!node || node.children?.length || node.layoutOptions?.['elk.portConstraints'] === 'FIXED_POS') return null;
    node.ports ??= [];
    const pid = `${id}__port_${node.ports.length}`;
    node.ports.push({ id: pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } });
    node.layoutOptions = { ...(node.layoutOptions ?? {}), 'elk.portConstraints': 'FIXED_SIDE' };
    portOwner.set(pid, id);
    return pid;
  };
  for (const e of root.edges ?? []) {
    const [s, t] = [e.sources[0], e.targets[0]];
    const loop = e.layoutReversed === true;
    if (loop || (fanIn.get(t) ?? 0) >= 2) { const p = ownPort(t, sides.arrive); if (p) e.targets = [p]; }
    if (loop || labelled.has(e.id) || decisions.has(s) || (fanOut.get(s) ?? 0) < BUS) { const p = ownPort(s, sides.flow); if (p) e.sources = [p]; }
  }
}

/**
 * Declared peers keep their order: ELK follows the model order of children when forced to, so
 * the peers are moved into declared order within the slots they already occupy.
 */
function orderPeers(root, index, facts) {
  root.layoutOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
  root.layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'] = true;
  for (const peers of facts.peers) {
    const parent = index.parentOf.get(peers[0]);
    if (!parent || peers.some((id) => index.parentOf.get(id) !== parent)) continue;
    const slots = parent.children.map((c, i) => (peers.includes(c.id) ? i : -1)).filter((i) => i >= 0);
    const ordered = peers.map((id) => index.nodes.get(id));
    slots.forEach((slot, k) => { parent.children[slot] = ordered[k]; });
  }
}

/**
 * After layout: put box ids back where ports stood (Mermaid looks edges up by box), and make sure
 * every edge section runs from its source, which ELK does not guarantee for comment boxes.
 * @param {any} result laid-out ELK graph
 * @param {Map<string, string>} portOwner
 */
export function restoreEdges(result, portOwner) {
  for (const e of result.edges ?? []) {
    e.sources = e.sources.map((x) => portOwner.get(x) ?? x);
    e.targets = e.targets.map((x) => portOwner.get(x) ?? x);
  }
  placeUnplacedLabels(result);
  const { boxes, frameOf } = absoluteFrames(result);
  const distance = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));
  for (const e of result.edges ?? []) {
    const section = e.sections?.[0], s = boxes.get(e.sources[0]), t = boxes.get(e.targets[0]);
    if (!section || !s || !t) continue;
    const o = frameOf(e.sources[0], e.targets[0]);
    const a = { x: section.startPoint.x + o.x, y: section.startPoint.y + o.y };
    const b = { x: section.endPoint.x + o.x, y: section.endPoint.y + o.y };
    if (distance(a, t) + 1 < distance(a, s) && distance(b, s) + 1 < distance(b, t)) {
      section.bendPoints = (section.bendPoints ?? []).slice().reverse();
      [section.startPoint, section.endPoint] = [section.endPoint, section.startPoint];
    }
  }
  return result;
}

/** @param {{ x: number, y: number }} p @param {{ x: number, y: number }[]} pts */
function distanceToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

/**
 * ELK leaves the label of a comment box's link unplaced. Such a label goes on the middle of the
 * link's longest segment, in the same frame as the link's points.
 * @param {any} result
 */
function placeUnplacedLabels(result) {
  for (const e of result.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    // a label counts as unplaced when it has no position or sits away from its own arrow
    const labels = (e.labels ?? []).filter((l) => l.width > 0 && !(Number.isFinite(l.x) && Number.isFinite(l.y)
      && distanceToPolyline({ x: l.x + l.width / 2, y: l.y + l.height / 2 }, pts) < Math.max(l.width, l.height)));
    if (!labels.length) continue;
    let a = pts[0], b = pts[1], longest = -1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (d > longest) { longest = d; a = pts[i]; b = pts[i + 1]; }
    }
    for (const l of labels) { l.x = (a.x + b.x) / 2 - l.width / 2; l.y = (a.y + b.y) / 2 - l.height / 2; }
  }
}

/**
 * Absolute boxes of a laid-out ELK graph, and the offset of the frame an edge's coordinates are
 * given in: Mermaid reads an edge relative to the lowest common ancestor of its two ends.
 * @param {any} root
 */
export function absoluteFrames(root) {
  /** @type {Map<string, { x: number, y: number, w: number, h: number }>} */ const boxes = new Map();
  /** @type {Map<string, string | null>} */ const parent = new Map();
  const walk = (n, ox, oy, pid) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0), y = oy + (c.y ?? 0);
      boxes.set(c.id, { x, y, w: c.width ?? 0, h: c.height ?? 0 });
      parent.set(c.id, pid);
      walk(c, x, y, c.id);
    }
  };
  walk(root, 0, 0, null);
  const ancestor = (u, v) => {
    if (u === v) return parent.get(u) ?? null;
    const seen = new Set();
    for (let x = u; x; x = parent.get(x) ?? null) seen.add(x);
    for (let x = v; x; x = parent.get(x) ?? null) if (seen.has(x)) return x;
    return null;
  };
  const frameOf = (u, v) => { const f = ancestor(u, v); const b = f ? boxes.get(f) : null; return { x: b?.x ?? 0, y: b?.y ?? 0 }; };
  return { boxes, parent, frameOf };
}
