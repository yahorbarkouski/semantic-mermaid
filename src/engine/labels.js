// Finishing touches on a laid-out graph, before it is measured and drawn: arrow ends without small
// jogs, and arrow labels clear of everything else.

import { absoluteFrames } from './elk-graph.js';

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

const CLEAR = 4;  // room a label keeps from other arrows, boxes and labels
const STEP = 4;   // spacing of the spots tried along the arrow
const STUB = 30;  // longest first stretch of an arrow that a jog after it may be folded into
const JOG = 16;   // largest jog folded away
const INSET = 8;  // how close to a box's corner an arrow end may move

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
