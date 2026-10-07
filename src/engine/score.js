// How readable a layout is, as one number (lower is better) and the measurements behind it.
// The weights were set by hand against blind pairwise judgments of earlier layouts: defects first
// (arrows through boxes, crossings, label clashes), then length, bends, shape and the meaning
// terms (a straight main path, arrows with the flow, declared peers in order).

/** @typedef {import('./geometry.js').Geometry} Geometry */
/** @typedef {import('./geometry.js').Box} Box */
/** @typedef {import('./geometry.js').Point} Point */
/** @typedef {import('../facts/resolve.js').Facts} Facts */

/** @typedef {'center' | 'left' | 'right'} TitleSide */

/**
 * @typedef {object} Measurements
 * @property {number} throughBoxes     arrow segments passing through a box they do not connect
 * @property {number} crossings
 * @property {number} labelClashes     arrow labels over boxes, other labels or other arrows
 * @property {number} hugging          pairs of unrelated arrows running side by side closer than 8 px
 * @property {number} crowdedEnds      arrows meeting one box 0.5-14 px apart (a comb, stacked heads)
 * @property {number} titleCrossings   arrows across group titles, with titles at their best side
 * @property {number} edgeLength       mean arrow length, in box sizes
 * @property {number} bends            mean bends per arrow
 * @property {number} againstFlow      share of non-loop arrows pointing against the flow
 * @property {number} aspect           width / height
 * @property {number | null} spine     share of main-path arrows drawn as one straight line through both boxes' centres
 * @property {number} peerDisorder     declared peers out of order
 * @property {Map<string, TitleSide>} titleSides
 */

const inside = (p, b, pad = 0) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const shrink = (b, d) => ({ x: b.x + d, y: b.y + d, w: Math.max(0, b.w - 2 * d), h: Math.max(0, b.h - 2 * d) });

/** Points along a polyline every `step` px, for containment tests. */
function sample(points, step = 4) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  if (points.length) out.push(points[points.length - 1]);
  return out;
}

/** Axis-aligned segments of a polyline, as { vertical, at, from, to }. */
function straightRuns(points) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (Math.abs(a.x - b.x) < 1) out.push({ vertical: true, at: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) });
    else if (Math.abs(a.y - b.y) < 1) out.push({ vertical: false, at: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) });
  }
  return out;
}

/** Two parallel segments closer than 8 px that share more than 16 px of their length. */
function hug(r, q) {
  return r.vertical === q.vertical && Math.abs(r.at - q.at) < 8 && Math.min(r.to, q.to) - Math.max(r.from, q.from) > 16;
}

/** Proper intersection of segments ab and cd, or null. */
function cross(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } : null;
}

const FLOW = { DOWN: [0, 1], UP: [0, -1], RIGHT: [1, 0], LEFT: [-1, 0] };

/**
 * @param {Geometry} g
 * @param {Facts} facts
 * @returns {Measurements}
 */
export function measure(g, facts) {
  const boxes = [...g.boxes.entries()];
  const near = (p) => boxes.some(([, b]) => inside(p, b, 6));

  let throughBoxes = 0;
  for (const e of g.edges) {
    const pts = sample(e.points);
    for (const [id, b] of boxes) if (id !== e.from && id !== e.to && pts.some((p) => inside(p, shrink(b, 3)))) throughBoxes++;
  }

  // arrows from one box (or into one box) may share a trunk and part where it ends: they touch there
  // without crossing, which the proper-intersection test below already leaves out
  let crossings = 0;
  for (let i = 0; i < g.edges.length; i++) for (let j = i + 1; j < g.edges.length; j++) {
    const a = g.edges[i], b = g.edges[j];
    const found = [];
    for (let s = 0; s + 1 < a.points.length; s++) for (let t = 0; t + 1 < b.points.length; t++) {
      const x = cross(a.points[s], a.points[s + 1], b.points[t], b.points[t + 1]);
      if (x && !near(x) && !found.some((f) => Math.hypot(f.x - x.x, f.y - x.y) < 8)) found.push(x);
    }
    crossings += found.length;
  }

  const labels = g.edges.flatMap((e) => e.labels.map((l) => ({ ...l, edge: e.id })));
  const samples = new Map(g.edges.map((e) => [e.id, sample(e.points, 3)]));
  let labelClashes = 0;
  labels.forEach((l, i) => {
    for (const [, b] of boxes) if (overlap(l, b) > 4) labelClashes++;
    for (let k = i + 1; k < labels.length; k++) if (overlap(l, labels[k]) > 4) labelClashes++;
    // another arrow through the label, or passing close enough to touch it
    const room = shrink(l, -2);
    for (const e of g.edges) if (e.id !== l.edge && (samples.get(e.id) ?? []).some((p) => inside(p, room))) labelClashes++;
  });

  // unrelated arrows that run side by side read as one line
  let hugging = 0;
  const runs = g.edges.map((e) => straightRuns(e.points));
  for (let i = 0; i < g.edges.length; i++) for (let j = i + 1; j < g.edges.length; j++) {
    const a = g.edges[i], b = g.edges[j];
    if (a.from === b.from || a.to === b.to || a.from === b.to || a.to === b.from) continue;
    if (runs[i].some((r) => runs[j].some((q) => hug(r, q)))) hugging++;
  }

  /** @type {Map<string, Point[]>} */
  const ends = new Map();
  const addEnd = (/** @type {string} */ id, /** @type {Point} */ p) => { const list = ends.get(id); if (list) list.push(p); else ends.set(id, [p]); };
  for (const e of g.edges) {
    if (!e.points.length) continue;
    addEnd(e.from, e.points[0]);
    addEnd(e.to, e.points[e.points.length - 1]);
  }
  let crowdedEnds = 0;
  for (const ps of ends.values()) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
    if (d > 0.5 && d < 14) crowdedEnds++;
  }

  const { titleCrossings, titleSides } = placeTitles(g, g.direction === 'RIGHT' || g.direction === 'LEFT' ? new Set(facts.lanes) : new Set());

  const unit = Math.sqrt(boxes.reduce((s, [, b]) => s + b.w * b.h, 0) / Math.max(1, boxes.length)) || 1;
  let length = 0, bends = 0;
  for (const e of g.edges) {
    for (let i = 0; i + 1 < e.points.length; i++) length += Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
    bends += Math.max(0, e.points.length - 2);
  }

  const axis = FLOW[g.direction] ?? FLOW.DOWN;
  let against = 0, forward = 0;
  for (const e of g.edges) {
    if (facts.loops.has(e.id)) continue;
    const s = g.boxes.get(e.from), t = g.boxes.get(e.to);
    if (!s || !t) continue;
    forward++;
    if ((t.x + t.w / 2 - s.x - s.w / 2) * axis[0] + (t.y + t.h / 2 - s.y - s.h / 2) * axis[1] < -10) against++;
  }

  // a main-path arrow is straight when it is one line that runs through both boxes' centres, so the
  // path keeps one column (or row) instead of stepping sideways at a box
  const main = new Set(facts.mainPath);
  let straight = 0, counted = 0;
  for (const e of g.edges) {
    if (!main.has(e.id) || e.points.length < 2) continue;
    counted++;
    const a = e.points[0], s = g.boxes.get(e.from), t = g.boxes.get(e.to);
    const onX = (/** @type {Box | undefined} */ b) => !b || Math.abs(b.x + b.w / 2 - a.x) < 3;
    const onY = (/** @type {Box | undefined} */ b) => !b || Math.abs(b.y + b.h / 2 - a.y) < 3;
    if ((e.points.every((p) => Math.abs(p.x - a.x) < 3) && onX(s) && onX(t)) || (e.points.every((p) => Math.abs(p.y - a.y) < 3) && onY(s) && onY(t))) straight++;
  }

  let peerDisorder = 0;
  const across = axis[0] === 0 ? 'x' : 'y';
  for (const peers of facts.peers) {
    const pos = peers.flatMap((id) => { const b = g.boxes.get(id); return b ? [b[across] + (across === 'x' ? b.w : b.h) / 2] : []; });
    for (let i = 0; i + 1 < pos.length; i++) if (pos[i] > pos[i + 1]) peerDisorder++;
  }

  return {
    throughBoxes, crossings, labelClashes, hugging, crowdedEnds, titleCrossings,
    edgeLength: length / Math.max(1, g.edges.length) / unit,
    bends: bends / Math.max(1, g.edges.length),
    againstFlow: forward ? against / forward : 0,
    aspect: g.height > 0 ? g.width / g.height : 1,
    spine: counted ? straight / counted : null,
    peerDisorder,
    titleSides,
  };
}

/**
 * Each group title goes to the centre of its frame's top edge, or to the left or right end of
 * it, whichever the fewest arrows cross. The centre wins ties, except for lanes running across the
 * page, whose titles read best at the start of the lane.
 * @param {Geometry} g
 * @param {Set<string>} [startFirst]  groups whose titles prefer the left end
 */
export function placeTitles(g, startFirst = new Set()) {
  /** @type {Map<string, TitleSide>} */
  const titleSides = new Map();
  let titleCrossings = 0;
  const samples = g.edges.map((e) => sample(e.points, 3));
  for (const [id, frame] of g.groups) {
    const t = g.titles.get(id);
    if (!t || t.w <= 0) continue;
    /** @type {[TitleSide, number][]} */
    const options = [['center', frame.x + (frame.w - t.w) / 2], ['left', frame.x + 8], ['right', frame.x + frame.w - t.w - 8]];
    if (startFirst.has(id)) options.unshift(/** @type {[TitleSide, number]} */ (options.splice(1, 1)[0]));
    let best = /** @type {[TitleSide, number]} */ (['center', Infinity]);
    for (const [side, x] of options) {
      const box = { x: x - 3, y: frame.y, w: t.w + 6, h: t.h + 6 };
      const hits = samples.filter((pts) => pts.some((p) => inside(p, box))).length;
      if (hits < best[1]) best = [side, hits];
    }
    titleSides.set(id, best[0]);
    titleCrossings += best[1];
  }
  return { titleCrossings, titleSides };
}

/**
 * One number per layout; compare layouts of the same diagram only.
 * @param {Measurements} m
 */
export function score(m) {
  return 8 * m.throughBoxes
    + m.crossings
    + 0.7 * m.labelClashes
    + 0.5 * m.hugging
    + 0.25 * m.crowdedEnds
    + 1.5 * m.titleCrossings
    + 0.75 * m.edgeLength
    + 0.45 * m.bends
    + 3 * m.againstFlow
    + 1.2 * Math.max(0, Math.abs(Math.log(m.aspect)) - Math.log(6))
    - (m.spine ?? 0)
    + 1.5 * m.peerDisorder;
}
