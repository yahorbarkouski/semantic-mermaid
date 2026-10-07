// Finishing touches on a laid-out graph, before it is measured and drawn: a main path without small
// sideways steps, arrow ends without small jogs, and arrow labels clear of everything else.

import { absoluteFrames } from './elk-graph.js';

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

const CLEAR = 4;  // room a label keeps from other arrows, boxes and labels
const STEP = 4;   // spacing of the spots tried along the arrow
const STUB = 30;  // longest first stretch of an arrow that a jog after it may be folded into
const JOG = 16;   // largest jog folded away
const INSET = 8;  // how close to a box's corner an arrow end may move
const SHIFT = 48; // largest sideways move that puts a main-path box back on the path's line
const GAP = 8;    // room a moved box keeps from other boxes

/**
 * Put main-path boxes that ELK left a little off the path's line back on it. ELK's node placement
 * shifts a box sideways to balance its arrows, for example where a retry comes back into the top of
 * a main-path box, which leaves a step in a path the author declared straight. Each such box other
 * than a decision moves onto the line most main-path boxes in its group share, when the move is
 * small, keeps clear of other boxes and arrows, and stays inside its group; its arrows move with it,
 * and a main-path arrow between two boxes on the line becomes one straight segment.
 * @param {any} result laid-out ELK graph, box ids already on its edges
 * @param {{ mainPath: string[] }} facts  `mainPath` holds edge ids, in order
 * @param {Set<string>} corners  boxes whose arrows meet them at their corners
 * @returns {any} the same graph
 */
export function alignMainPath(result, facts, corners) {
  const direction = result.layoutOptions?.['elk.direction'] ?? 'DOWN';
  // the cross axis: sideways to the flow
  const across = direction === 'DOWN' || direction === 'UP' ? 'x' : 'y';
  const size = across === 'x' ? 'w' : 'h';
  const mainEdges = new Set(facts.mainPath);
  const edges = (result.edges ?? []).filter((/** @type {any} */ e) => e.sections?.[0]);
  const main = edges.filter((/** @type {any} */ e) => mainEdges.has(e.id));
  if (main.length < 2) return result;
  /** @type {Map<string, any>} */
  const nodes = new Map();
  const walk = (/** @type {any} */ n) => { for (const c of n.children ?? []) { nodes.set(c.id, c); walk(c); } };
  walk(result);
  const { boxes, parent, frameOf } = absoluteFrames(result);
  const pathBoxes = [...new Set(main.flatMap((/** @type {any} */ e) => [e.sources[0], e.targets[0]]))].filter((id) => boxes.has(id) && !nodes.get(id)?.children?.length);
  const centre = (/** @type {string} */ id) => { const b = /** @type {Rect} */ (boxes.get(id)); return b[across] + b[size] / 2; };

  /** An edge's points in absolute coordinates. @param {any} e */
  const pointsOf = (e) => {
    const s = e.sections[0], o = frameOf(e.sources[0], e.targets[0]);
    return [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
  };
  /** @param {any} e @param {Point[]} points */
  const setPoints = (e, points) => {
    const s = e.sections[0], o = frameOf(e.sources[0], e.targets[0]);
    const local = points.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
    s.startPoint = local[0];
    s.endPoint = local[local.length - 1];
    s.bendPoints = local.slice(1, -1);
  };

  // the line: the centre most path boxes in a group share
  /** @type {Map<string | null, number>} */
  const lines = new Map();
  for (const group of new Set(pathBoxes.map((id) => parent.get(id) ?? null))) {
    const counts = new Map();
    for (const id of pathBoxes.filter((b) => (parent.get(b) ?? null) === group)) {
      const c = Math.round(centre(id) * 2) / 2;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const [line, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (count >= 2) lines.set(group, line);
  }

  for (const id of pathBoxes) {
    // a decision stays: its arrows meet it at its corners, and moving them bends the arrows into hooks
    if (corners.has(id)) continue;
    const group = parent.get(id) ?? null;
    const line = lines.get(group);
    if (line === undefined) continue;
    const d = line - centre(id);
    if (Math.abs(d) < 0.5 || Math.abs(d) > SHIFT) continue;
    const box = /** @type {Rect} */ (boxes.get(id));
    const moved = { ...box, [across]: box[across] + d };
    // stays inside its group, clear of other boxes
    const frame = group ? boxes.get(group) : null;
    if (frame && (moved[across] < frame[across] || moved[across] + moved[size] > frame[across] + frame[size])) continue;
    if ([...boxes].some(([other, r]) => other !== id && other !== group && !isAncestor(parent, other, id) && overlaps(grow(moved, GAP), r))) continue;
    // its arrows follow it; no other arrow may pass through it
    const touching = edges.filter((/** @type {any} */ e) => e.sources[0] === id || e.targets[0] === id);
    if (edges.some((/** @type {any} */ e) => !touching.includes(e) && crosses(pointsOf(e), moved))) continue;
    const rerouted = touching.map((/** @type {any} */ e) => {
      let points = pointsOf(e);
      if (e.sources[0] === id) points = follow(points, box, d, across, corners.has(id));
      if (e.targets[0] === id) points = follow(points.reverse(), box, d, across, corners.has(id)).reverse();
      return { e, points };
    });
    // the moved arrows may not pass through other boxes, or cross more arrows than before
    if (rerouted.some(({ e, points }) => [...boxes].some(([other, r]) => other !== e.sources[0] && other !== e.targets[0] && !nodes.get(other)?.children?.length && crosses(points.slice(1, -1).length ? points : [], r)))) continue;
    const others = edges.filter((/** @type {any} */ e) => !touching.includes(e)).map(pointsOf);
    const crossingCount = (/** @type {Point[][]} */ routes) => routes.reduce((n, route) => n + others.reduce((m, o) => m + crossingsBetween(route, o), 0), 0);
    if (crossingCount(rerouted.map((r) => r.points)) > crossingCount(touching.map(pointsOf))) continue;
    nodes.get(id)[across] += d;
    boxes.set(id, moved);
    for (const { e, points } of rerouted) setPoints(e, points);
  }

  // a main-path arrow between two boxes on the line, with at most one sideways step, becomes straight
  for (const e of main) {
    const from = boxes.get(e.sources[0]), to = boxes.get(e.targets[0]);
    if (!from || !to) continue;
    const at = centre(e.sources[0]);
    if (Math.abs(at - centre(e.targets[0])) >= 0.5 || (e.sections[0].bendPoints?.length ?? 0) > 2) continue;
    const points = pointsOf(e);
    // from the side of the source that faces the flow to the side of the target that faces back
    const along = across === 'x' ? 'y' : 'x', length = across === 'x' ? 'h' : 'w';
    const forward = direction === 'DOWN' || direction === 'RIGHT';
    const start = /** @type {Point} */ ({ [across]: at, [along]: forward ? from[along] + from[length] : from[along] });
    const end = /** @type {Point} */ ({ [across]: at, [along]: forward ? to[along] : to[along] + to[length] });
    if (forward ? end[along] <= start[along] : end[along] >= start[along]) continue;
    // only when the straight arrow passes no box and crosses no more arrows than the old one
    if ([...boxes].some(([other, r]) => other !== e.sources[0] && other !== e.targets[0] && !nodes.get(other)?.children?.length && crosses([start, end], r))) continue;
    const others = edges.filter((/** @type {any} */ o) => o !== e).map(pointsOf);
    if (others.reduce((n, o) => n + crossingsBetween([start, end], o), 0) > others.reduce((n, o) => n + crossingsBetween(points, o), 0)) continue;
    setPoints(e, [start, end]);
    const o = frameOf(e.sources[0], e.targets[0]);
    for (const label of e.labels ?? []) label[across] = at - (across === 'x' ? o.x : o.y) - (label[across === 'x' ? 'width' : 'height'] ?? 0) / 2;
  }
  return result;
}

/**
 * The first points of an arrow that leaves `box`, after the box moves by d across the flow. An end on
 * a side that runs across the flow stays put while it is still on that side; an end on a side along
 * the flow, or at a corner, moves with the box, together with the next point when the first stretch
 * runs straight away from the box.
 * @param {Point[]} points  from the box outwards
 * @param {Rect} box  before the move
 * @param {number} d
 * @param {'x' | 'y'} across
 * @param {boolean} atCorner
 * @returns {Point[]}
 */
function follow(points, box, d, across, atCorner) {
  const size = across === 'x' ? 'w' : 'h';
  const [p0, p1] = points;
  const onCrossSide = Math.abs(p0[across] - box[across]) > 0.5 && Math.abs(p0[across] - (box[across] + box[size])) > 0.5;
  const stillOn = p0[across] + 0 >= box[across] + d + INSET && p0[across] <= box[across] + box[size] + d - INSET;
  if (!atCorner && onCrossSide && stillOn) return points;
  const shifted = [{ ...p0, [across]: p0[across] + d }, ...points.slice(1)];
  if (p1 && Math.abs(p1[across] - p0[across]) < 0.5 && points.length > 2) shifted[1] = { ...p1, [across]: p1[across] + d };
  return shifted;
}

/** How many times two polylines cross; meeting at an end does not count. @param {Point[]} a @param {Point[]} b */
function crossingsBetween(a, b) {
  let n = 0;
  for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) if (properlyCross(a[i], a[i + 1], b[j], b[j + 1])) n++;
  return n;
}

/** Whether segments p–q and r–s cross at a point inside both. @param {Point} p @param {Point} q @param {Point} r @param {Point} s */
function properlyCross(p, q, r, s) {
  const side = (/** @type {Point} */ a, /** @type {Point} */ b, /** @type {Point} */ c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const d1 = side(r, s, p), d2 = side(r, s, q), d3 = side(p, q, r), d4 = side(p, q, s);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether `a` contains `b`. @param {Map<string, string | null>} parent @param {string} a @param {string} b */
function isAncestor(parent, a, b) {
  for (let x = parent.get(b) ?? null; x; x = parent.get(x) ?? null) if (x === a) return true;
  return false;
}

/**
 * Fold away a small jog right after an arrow leaves a box, or right before it arrives: the end slides
 * along the box's side onto the line the arrow continues on. ELK leaves such jogs where ports do not
 * line up; Mermaid would straighten them after layout and move their labels, so they are folded
 * here, where the result is measured. Ends at decisions stay at their corners.
 * @param {any} result laid-out ELK graph, box ids already on its edges
 * @param {Set<string>} corners  boxes whose arrows meet them at their corners
 * @returns {any} the same graph
 */
export function straightenEnds(result, corners) {
  const { boxes, frameOf } = absoluteFrames(result);
  for (const e of result.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const o = frameOf(e.sources[0], e.targets[0]);
    let points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
    const fold = (/** @type {Point[]} */ pts, /** @type {string} */ id) => {
      const box = boxes.get(id);
      if (!box || corners.has(id) || pts.length < 4) return pts;
      const [p0, p1, p2, p3] = pts;
      const vertical = Math.abs(p0.x - p1.x) < 0.5 && Math.abs(p2.x - p3.x) < 0.5 && Math.abs(p1.y - p2.y) < 0.5;
      const horizontal = Math.abs(p0.y - p1.y) < 0.5 && Math.abs(p2.y - p3.y) < 0.5 && Math.abs(p1.x - p2.x) < 0.5;
      if (!vertical && !horizontal) return pts;
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > STUB) return pts;
      const jog = vertical ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
      if (jog < 0.5 || jog > JOG) return pts;
      // the end must stay on the box's side, away from its corners
      const along = vertical ? p2.x : p2.y, from = vertical ? box.x : box.y, size = vertical ? box.w : box.h;
      if (along < from + INSET || along > from + size - INSET) return pts;
      const moved = vertical ? { x: p2.x, y: p0.y } : { x: p0.x, y: p2.y };
      return [moved, ...pts.slice(3)];
    };
    points = fold(points, e.sources[0]);
    points = fold(points.slice().reverse(), e.targets[0]).reverse();
    const local = points.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
    section.startPoint = local[0];
    section.endPoint = local[local.length - 1];
    section.bendPoints = local.slice(1, -1);
  }
  return result;
}

/**
 * Move clashing labels, in place, in the order the edges come.
 * @param {any} result laid-out ELK graph, box ids already on its edges
 * @returns {any} the same graph
 */
export function clearLabels(result) {
  const { boxes, frameOf } = absoluteFrames(result);
  /** @type {Rect[]} */
  const leaves = [];
  const walk = (/** @type {any} */ n) => {
    for (const c of n.children ?? []) {
      if (c.children?.length) walk(c);
      else { const b = boxes.get(c.id); if (b) leaves.push(b); }
    }
  };
  walk(result);
  const arrows = (result.edges ?? []).map((/** @type {any} */ e) => {
    const s = e.sections?.[0];
    const o = frameOf(e.sources[0], e.targets[0]);
    /** @type {Point[]} */
    const points = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y })) : [];
    return { e, o, points };
  });
  /** @type {Rect[]} */
  const placed = [];
  for (const { e, o, points } of arrows) {
    for (const l of e.labels ?? []) {
      if (!(l.width > 0) || !Number.isFinite(l.x) || !Number.isFinite(l.y) || points.length < 2) continue;
      const clashes = (/** @type {Rect} */ r) => {
        const room = grow(r, CLEAR);
        return leaves.some((b) => overlaps(room, b)) || placed.some((p) => overlaps(room, p))
          || arrows.some((a) => a.e !== e && crosses(a.points, room));
      };
      let at = { x: l.x + o.x, y: l.y + o.y, w: l.width, h: l.height };
      if (clashes(at)) {
        const centre = { x: at.x + at.w / 2, y: at.y + at.h / 2 };
        let best = null, distance = Infinity;
        for (const c of spotsAlong(points)) {
          const d = Math.hypot(c.x - centre.x, c.y - centre.y);
          if (d >= distance) continue;
          const r = { x: c.x - at.w / 2, y: c.y - at.h / 2, w: at.w, h: at.h };
          if (!clashes(r)) { best = r; distance = d; }
        }
        if (best) {
          at = best;
          l.x = at.x - o.x;
          l.y = at.y - o.y;
        }
      }
      placed.push(at);
    }
  }
  return result;
}

/** Spots every STEP along a polyline. @param {Point[]} points @returns {Point[]} */
function spotsAlong(points) {
  const spots = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = 0; d < length; d += STEP) spots.push({ x: a.x + ((b.x - a.x) * d) / length, y: a.y + ((b.y - a.y) * d) / length });
  }
  return spots;
}

/** @param {Rect} r @param {number} d @returns {Rect} */
const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether a polyline passes through a rectangle. @param {Point[]} points @param {Rect} r */
function crosses(points, r) {
  for (let i = 0; i + 1 < points.length; i++) if (segmentHits(points[i], points[i + 1], r)) return true;
  return false;
}

/** Liang–Barsky: whether segment a–b meets rectangle r. @param {Point} a @param {Point} b @param {Rect} r */
function segmentHits(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
    if (p === 0) { if (q < 0) return false; }
    else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 < t1;
}
