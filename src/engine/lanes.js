// Swimlanes: groups that are parties handing work back and forth, drawn as parallel lanes with time
// running along them.
//
// ELK lays a group out as one block, so the parties end up stacked and the hand-offs between them
// loop around the drawing. Swimlanes are a grid, and this module lays that grid out directly:
//   rows     every box gets a time row: the longest path to it, retries and cycle-closing arrows
//            left out (`timeRows`);
//   columns  every lane is a column; boxes outside every lane share one more column before the
//            lanes. The main path runs down each lane's spine, and a box in a row the main path
//            passes through steps aside, toward the lanes it talks to;
//   arrows   are orthogonal. Between neighbouring rows an arrow turns in the gap between them, on
//            a track of its own, with tracks ordered to avoid crossings. An arrow that skips rows
//            runs straight when nothing is in its way, and otherwise along a corridor at the lane's
//            side. An arrow back in time runs along its lane's side when it stays in one lane;
//            between lanes it runs beside one of them where it crosses nothing, else along a gutter
//            outside the lanes. Labels ride on their arrow's turn, or in a band between rows.
// Everything is computed on two axes, time (`t`) and lane (`l`), and mapped to x and y at the end:
// top-down diagrams run time down with lanes as columns, left-to-right diagrams run time right with
// lanes as rows.

import { drawnEnds } from './elk-graph.js';
import { DECISION_SHAPES } from '../facts/resolve.js';

/** @typedef {import('../facts/resolve.js').Facts} Facts */
/** @typedef {import('../model/graph.js').Graph} Graph */
/** @typedef {{ t: number, l: number }} Pt  a point: along time, across the lanes */
/** @typedef {'before' | 'after' | 'low' | 'high'} Side  before and after face along time; low and high face across the lanes */
/** @typedef {{ width: number, height: number }} Size */

const PAD = 20;       // between a lane's frame and what it holds
const GAP = 16;       // between neighbouring lanes
const TITLE = 36;     // room for a lane's title at its start
const BETWEEN = 28;   // between boxes that share a lane and a row
const CLEAR = 18;     // between the main path and a box that steps aside for it
const TRACK = 12;     // between parallel arrows
const SIDE = 16;      // between boxes and the first corridor track beside them
const STUB = 18;      // between a row's boxes and the first turn in the gap after it
const ROW_GAP = 44;   // a gap no arrow turns in
const MARGIN = 8;     // room an arrow keeps from a box it passes
const INSET = 10;     // how close to a box's corner an arrow may attach
const ROOM = 8;       // around a label on its arrow
const MIN_HALF = 40;  // half the width of an empty lane

/**
 * @typedef {object} Box
 * @property {string} id
 * @property {any} node      Mermaid's ELK node
 * @property {number} column
 * @property {number} row
 * @property {number} along  size along time
 * @property {number} across size across the lanes
 * @property {boolean} diamond  arrows meet it at its corners
 * @property {number} offset centre's distance from its column's spine
 * @property {number} t      centre along time, once rows are placed
 * @property {number} l      centre across the lanes, once columns are placed
 * @property {Record<Side, Port[]>} ports
 */

/**
 * @typedef {object} Port  where an arrow meets a box
 * @property {Box} box
 * @property {Side} side
 * @property {number} key  orders the ports on one side by where their arrows head
 * @property {number} at   position along the side, from its middle
 * @property {Port | null} toward  the port at the arrow's other end, when both face along time
 * @property {boolean} out  the arrow leaves the box here
 */

/**
 * @typedef {object} Turn  an arrow's stretch across the lanes, in the gap after row `gap`
 * @property {number} gap
 * @property {{ l: () => number, late: boolean }[]} ends  where it comes in and goes out; `late` when that end leads to the row after the gap
 * @property {Size | null} label  the arrow's label, when it rides on this stretch
 * @property {number} track
 * @property {number} t
 * @property {boolean} straight   both ends line up, so the arrow does not turn here
 * @property {number[]} keys      where its ends are across the lanes, by key, before anything has a position
 */

/**
 * @typedef {object} Run  an arrow's stretch along a corridor beside a lane, or along a gutter outside the lanes
 * @property {string} corridor  'before' or 'after' for the gutters, `${column}:low` or `${column}:high` beside a lane
 * @property {number} from      in rows: x is row x itself, x.5 the gap after it
 * @property {number} to
 * @property {number} track     0 is nearest the boxes
 * @property {number} l
 */

/**
 * @typedef {object} Route
 * @property {any} edge
 * @property {Size | null} label
 * @property {Turn[]} turns
 * @property {Run[]} runs
 * @property {Port[]} ports
 * @property {boolean} channel   turns once between two ports facing along time
 * @property {number} bandGap    the gap whose label band carries the label when it rides on a straight stretch
 * @property {number} bandRow    which row of that band
 * @property {number} bandShift  how far the label sits beside its line there, across the lanes
 * @property {Turn | 'band' | null} labelOn  null: on the first stretch long enough
 * @property {() => Pt[]} trace  corners in drawn direction, once everything is placed
 */

/**
 * @typedef {object} Column
 * @property {number} low    extent of its boxes before the spine
 * @property {number} high   extent after it
 * @property {number} start  frame start, across the lanes
 * @property {number} spine
 * @property {number} end
 * @property {any} lane      Mermaid's group, or null for the boxes outside every lane
 */

/**
 * @typedef {object} Gap  the space after a row
 * @property {Turn[]} turns
 * @property {number[]} tracks  thickness of each track
 * @property {number[]} bands   label band rows, by size along time; none when no label rides straight through the gap
 * @property {number} size
 * @property {number} start
 * @property {number[]} trackT
 * @property {number[]} bandT
 */

/**
 * @typedef {object} Grid
 * @property {boolean} down
 * @property {Map<string, Box>} boxes
 * @property {Box[][][]} cells  column -> row -> boxes, in order across the lane
 * @property {number} rows
 * @property {Column[]} columns
 * @property {Gap[]} gaps
 * @property {number} length  along time
 * @property {number} width   across the lanes
 * @property {Map<number, { low: number, high: number }>} widen  room columns need for labels beside their lines
 */

/**
 * @typedef {object} LaneOptions
 * @property {'between' | 'outside'} returns  where arrows back in time between two lanes run:
 *   along a corridor between the lanes where they can, or always along a gutter outside them
 */

/**
 * Lay the diagram out in lanes, in place. Returns the laid-out graph, or a reason it cannot.
 * @param {any} root ELK graph built by Mermaid
 * @param {Graph} graph
 * @param {Facts} facts
 * @param {LaneOptions} [options]
 * @returns {any | string}
 */
export function layoutLanes(root, graph, facts, options = { returns: 'between' }) {
  const problem = unsupported(root);
  if (problem) return problem;
  const grid = buildGrid(root, graph, facts);
  // arrows forward in time first, so arrows back in time know which corners already send arrows on
  const back = (/** @type {any} */ e) => { const [s, t] = drawnEnds(e); return (grid.boxes.get(t)?.row ?? 0) < (grid.boxes.get(s)?.row ?? 0) ? 1 : 0; };
  const edges = [...(root.edges ?? [])].sort((a, b) => back(a) - back(b));
  /** @type {Route[]} */
  const routes = [];
  for (const e of edges) {
    const route = planRoute(grid, e, facts, options, routes);
    if (route) routes.push(route);
  }
  const place = () => {
    placeColumns(grid, routes);
    spreadPorts(grid);
    straighten(routes);
    placeRows(grid, routes);
  };
  place();
  // labels set beside their lines may need wider lanes; placing once more with that room settles it
  const widen = [...grid.widen].filter(([, w]) => w.low > 0.5 || w.high > 0.5);
  if (widen.length) {
    for (const [c, w] of widen) { grid.columns[c].low += Math.max(0, w.low); grid.columns[c].high += Math.max(0, w.high); }
    place();
  }
  writeBack(root, grid, routes);
  return root;
}

/**
 * Why the diagram cannot be laid out in lanes, or null when it can. The lanes' structure was
 * checked when the facts were resolved; what is left depends on the candidate's direction.
 * @param {any} root
 * @returns {string | null}
 */
function unsupported(root) {
  const direction = root.layoutOptions?.['elk.direction'] ?? 'DOWN';
  return direction === 'DOWN' || direction === 'RIGHT' ? null : `lanes need a top-down or left-to-right diagram, not ${direction}`;
}

// ---------------------------------------------------------------------------------------------
// The grid: rows, columns, and where each box sits across its lane

/**
 * Rows, columns and the boxes in each cell, before anything has a position.
 * @param {any} root
 * @param {Graph} graph
 * @param {Facts} facts
 * @returns {Grid}
 */
function buildGrid(root, graph, facts) {
  const down = (root.layoutOptions?.['elk.direction'] ?? 'DOWN') === 'DOWN';
  const children = root.children ?? [];
  const lanes = facts.lanes.map((id) => children.find((/** @type {any} */ c) => c.id === id));
  const others = children.filter((/** @type {any} */ c) => !facts.lanes.includes(c.id));
  const first = others.length ? 1 : 0;
  /** @type {any[][]} */
  const members = [...(others.length ? [others] : []), ...lanes.map((l) => l.children ?? [])];
  const rank = timeRows(members.flat().map((n) => n.id), root.edges ?? [], facts);
  /** @type {Map<string, Box>} */
  const boxes = new Map();
  members.forEach((list, column) => {
    for (const node of list) {
      boxes.set(node.id, {
        id: node.id, node, column, row: rank.get(node.id) ?? 0,
        along: down ? node.height : node.width, across: down ? node.width : node.height,
        diamond: DECISION_SHAPES.has(graph.nodes.get(node.id)?.shape ?? ''),
        offset: 0, t: 0, l: 0, ports: { before: [], after: [], low: [], high: [] },
      });
    }
  });
  const rows = Math.max(0, ...[...boxes.values()].map((b) => b.row)) + 1;
  const cells = members.map(() => Array.from({ length: rows }, () => /** @type {Box[]} */ ([])));
  for (const b of boxes.values()) cells[b.column][b.row].push(b);
  arrangeCells(cells, boxes, root.edges ?? [], facts);
  const columns = cells.map((column, c) => {
    const all = column.flat();
    return {
      low: Math.max(MIN_HALF, ...all.map((b) => b.across / 2 - b.offset)),
      high: Math.max(MIN_HALF, ...all.map((b) => b.offset + b.across / 2)),
      start: 0, spine: 0, end: 0, lane: c >= first ? lanes[c - first] : null,
    };
  });
  return { down, boxes, cells, rows, columns, gaps: [], length: 0, width: 0, widen: new Map() };
}

/**
 * Place the boxes of each cell across their lane, relative to the lane's spine. The main path runs
 * down the spine; a box beside it, or in a row the main path passes through in this lane, steps
 * aside toward the lanes it is connected to.
 * @param {Box[][][]} cells
 * @param {Map<string, Box>} boxes
 * @param {any[]} edges
 * @param {Facts} facts
 */
function arrangeCells(cells, boxes, edges, facts) {
  const ends = new Map(edges.map((e) => [e.id, drawnEnds(e)]));
  const onMain = new Set(facts.mainPath.flatMap((id) => ends.get(id) ?? []));
  /** @type {Set<number>[]} rows each column's main path passes without stopping */
  const passed = cells.map(() => new Set());
  for (const id of facts.mainPath) {
    const [s, t] = (ends.get(id) ?? []).map((/** @type {string} */ n) => boxes.get(n));
    if (!s || !t || s.column !== t.column) continue;
    for (let r = Math.min(s.row, t.row) + 1; r < Math.max(s.row, t.row); r++) passed[s.column].add(r);
  }
  /** @type {Map<string, number>} negative: connected mostly to lanes before this one */
  const lean = new Map();
  for (const [s, t] of ends.values()) {
    const a = boxes.get(s), b = boxes.get(t);
    if (!a || !b) continue;
    lean.set(a.id, (lean.get(a.id) ?? 0) + Math.sign(b.column - a.column));
    lean.set(b.id, (lean.get(b.id) ?? 0) + Math.sign(a.column - b.column));
  }
  cells.forEach((column, c) => column.forEach((cell, r) => {
    const main = cell.find((b) => onMain.has(b.id));
    if (!main && !passed[c].has(r)) {
      // nothing to keep clear: the cell is centred on the spine
      let at = -(cell.reduce((s, b) => s + b.across, 0) + BETWEEN * (cell.length - 1)) / 2;
      for (const b of cell) { b.offset = at + b.across / 2; at += b.across + BETWEEN; }
      return;
    }
    const room = main ? main.across / 2 + BETWEEN : CLEAR;
    let low = -room, high = room;
    for (const b of cell) {
      if (b === main) b.offset = 0;
      else if ((lean.get(b.id) ?? 0) < 0) { b.offset = low - b.across / 2; low -= b.across + BETWEEN; }
      else { b.offset = high + b.across / 2; high += b.across + BETWEEN; }
    }
  }));
}

/**
 * A time row for every box: the longest path from a start, with declared retries and any other
 * arrow that closes a cycle left out; a box that only feeds others sits one row before its first use.
 * @param {string[]} ids boxes in source order
 * @param {any[]} edges ELK edges
 * @param {Facts} facts
 * @returns {Map<string, number>}
 */
export function timeRows(ids, edges, facts) {
  const known = new Set(ids);
  /** @type {Map<string, string[]>} */ const succ = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (facts.loops.has(e.id)) continue;
    const [s, t] = drawnEnds(e);
    if (known.has(s) && known.has(t) && s !== t) succ.get(s)?.push(t);
  }
  // drop arrows that close a cycle, depth first in source order
  const state = new Map(), keep = new Map(ids.map((id) => [id, /** @type {string[]} */ ([])]));
  const visit = (/** @type {string} */ u) => {
    state.set(u, 1);
    for (const v of succ.get(u) ?? []) {
      if (state.get(v) === 1) continue;
      keep.get(u)?.push(v);
      if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
  };
  // the walk starts where the main path does, so the arrow that closes a cycle is the one back to it
  const startEdge = edges.find((e) => e.id === facts.mainPath[0]);
  const start = startEdge ? drawnEnds(startEdge)[0] : null;
  for (const id of [...(start && known.has(start) ? [start] : []), ...ids]) if (!state.has(id)) visit(id);
  const preds = new Map(ids.map((id) => [id, /** @type {string[]} */ ([])]));
  for (const [u, vs] of keep) for (const v of vs) preds.get(v)?.push(u);
  /** @type {Map<string, number>} */
  const rank = new Map();
  const rankOf = (/** @type {string} */ v) => {
    if (rank.has(v)) return /** @type {number} */ (rank.get(v));
    rank.set(v, 0);
    const r = Math.max(0, ...(preds.get(v) ?? []).map((u) => rankOf(u) + 1));
    rank.set(v, r);
    return r;
  };
  for (const id of ids) rankOf(id);
  for (const id of ids) {
    if ((preds.get(id) ?? []).length || !(keep.get(id) ?? []).length) continue;
    rank.set(id, Math.max(0, Math.min(...(keep.get(id) ?? []).map((v) => rank.get(v) ?? 0)) - 1));
  }
  return rank;
}

// Before columns have positions, places across the lanes are compared by key: the column times a
// large number, plus the distance from the column's spine. Corridors sit between columns' keys.
const BIG = 1e6;
const keyOf = (/** @type {number} */ column, /** @type {number} */ offset) => column * BIG + offset;
const boxKey = (/** @type {Box} */ b) => keyOf(b.column, b.offset);
const sideKey = (/** @type {Box} */ b, /** @type {Side} */ side) => boxKey(b) + (side === 'low' ? -b.across / 2 : b.across / 2);

/** @param {string} corridor @param {number} columns */
function corridorKey(corridor, columns) {
  if (corridor === 'before') return -BIG / 2;
  if (corridor === 'after') return (columns - 1) * BIG + BIG / 2;
  const [c, side] = corridor.split(':');
  return Number(c) * BIG + (side === 'low' ? -BIG / 4 : BIG / 4);
}

/**
 * Whether nothing but `except` stands in `row` between keys `a` and `b`.
 * @param {Grid} grid
 * @param {number} row
 * @param {number} a
 * @param {number} b
 * @param {Box[]} except
 */
function clearAcross(grid, row, a, b, except) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return grid.cells.every((column) => column[row].every((box) => except.includes(box)
    || boxKey(box) + box.across / 2 + MARGIN <= lo || boxKey(box) - box.across / 2 - MARGIN >= hi));
}

/**
 * Whether a line along time at `offset` in `column` passes the rows strictly between r1 and r2 without touching a box.
 * @param {Grid} grid
 * @param {number} column
 * @param {number} offset
 * @param {number} r1
 * @param {number} r2
 */
function clearAlong(grid, column, offset, r1, r2) {
  for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) {
    if (grid.cells[column][r].some((b) => Math.abs(b.offset - offset) < b.across / 2 + MARGIN)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Routes: how each arrow travels, decided before anything has a position

/**
 * A new port on one side of a box.
 * @param {Box} box
 * @param {Side} side
 * @param {number} key   where its arrow heads, to order the ports on that side
 * @param {boolean} out  the arrow leaves the box here
 * @returns {Port}
 */
function attach(box, side, key, out) {
  /** @type {Port} */
  const port = { box, side, key, at: 0, toward: null, out };
  box.ports[side].push(port);
  return port;
}

/** Where a port facing along time sits across the lanes. */
const lineOf = (/** @type {Port} */ p) => p.box.l + p.at;

/**
 * Where a port sits, once boxes have positions.
 * @param {Port} p
 * @returns {Pt}
 */
function portPoint(p) {
  const { box } = p;
  if (p.side === 'before') return { t: box.t - box.along / 2, l: box.l + p.at };
  if (p.side === 'after') return { t: box.t + box.along / 2, l: box.l + p.at };
  return { t: box.t + p.at, l: box.l + (p.side === 'low' ? -box.across / 2 : box.across / 2) };
}

/**
 * How one arrow travels, chosen from the rows and lanes of its ends.
 * @param {Grid} grid
 * @param {any} edge
 * @param {Facts} facts
 * @param {LaneOptions} options
 * @param {Route[]} planned  routes planned so far (arrows forward in time come first)
 * @returns {Route | null}
 */
function planRoute(grid, edge, facts, options, planned) {
  const [sid, tid] = drawnEnds(edge);
  const S = grid.boxes.get(sid), T = grid.boxes.get(tid);
  if (!S || !T) return null;
  const first = edge.labels?.[0];
  const label = first?.width ? { width: first.width, height: first.height } : null;
  if (S === T) return selfRoute(edge, label, S);
  if (T.row > S.row) {
    const branch = S.diamond && facts.continuation.get(S.id) !== edge.id ? branchRoute(grid, edge, label, S, T) : null;
    return branch ?? forwardRoute(grid, edge, label, S, T);
  }
  if (T.row === S.row) return sameRowRoute(grid, edge, label, S, T);
  if (S.row - T.row === 1 && !facts.loops.has(edge.id)) {
    // a decision's far corner that sends arrows on does not take one back: it comes in where the decision's inputs do
    const sending = T.diamond && T.ports.after.some((p) => p.out);
    return (sending ? aroundRoute(grid, edge, label, S, T) : null)
      ?? channelRoute(edge, label, attach(S, 'before', boxKey(T), true), attach(T, 'after', boxKey(S), false), T.row, T.row);
  }
  // back in time: along the lane's own side; between two lanes, along a corridor beside one of them
  // when the arrow steps straight out and straight in and crosses no arrow planned so far on the way
  // (and the layout asks for that), else along the gutter outside the lanes on the side nearer both
  if (S.column === T.column) return corridorRoute(grid, edge, label, S, T, `${S.column}:low`, false);
  const columns = grid.cells.length;
  const crossesNothing = (/** @type {string} */ corridor) => {
    const key = corridorKey(corridor, columns);
    return planned.every((r) => r.turns.every((x) => x.gap < T.row || x.gap >= S.row || !(Math.min(...x.keys) < key && key < Math.max(...x.keys))));
  };
  const between = options.returns === 'between'
    ? [facingCorridor(T, S), facingCorridor(S, T), farCorridor(T, S), farCorridor(S, T)].find((c) => straightInAndOut(grid, S, T, c) && crossesNothing(c))
    : undefined;
  const gutter = (S.column + T.column) / 2 <= (columns - 1) / 2 ? 'before' : 'after';
  return corridorRoute(grid, edge, label, S, T, between ?? gutter, false);
}

/**
 * Whether an arrow can leave S sideways into `corridor` and enter T sideways from it.
 * @param {Grid} grid
 * @param {Box} S
 * @param {Box} T
 * @param {string} corridor
 */
function straightInAndOut(grid, S, T, corridor) {
  const key = corridorKey(corridor, grid.cells.length);
  const sends = T.diamond && T.ports[sideToward(T, key)].some((p) => p.out);
  return !sends && clearAcross(grid, S.row, sideKey(S, sideToward(S, key)), key, [S]) && clearAcross(grid, T.row, key, sideKey(T, sideToward(T, key)), [T]);
}

/**
 * Forward in time: through the gap between neighbouring rows, straight down a clear line, or along a corridor.
 * @param {Grid} grid
 * @param {any} edge
 * @param {Size | null} label
 * @param {Box} S
 * @param {Box} T
 */
function forwardRoute(grid, edge, label, S, T) {
  // a port is ordered by where its arrow heads next: the other box when it turns right away, its own
  // line when it runs straight on first
  const ports = (/** @type {number} */ sKey, /** @type {number} */ tKey) => /** @type {[Port, Port]} */ ([attach(S, 'after', sKey, true), attach(T, 'before', tKey, false)]);
  if (T.row === S.row + 1) return channelRoute(edge, label, ...ports(boxKey(T), boxKey(S)), S.row, S.row);
  // turn right after the source and run down the target's line, or run down the source's line and turn right before the target
  if (clearAlong(grid, T.column, T.offset, S.row, T.row)) return channelRoute(edge, label, ...ports(boxKey(T), boxKey(T)), S.row, S.row);
  if (clearAlong(grid, S.column, S.offset, S.row, T.row)) return channelRoute(edge, label, ...ports(boxKey(S), boxKey(S)), T.row - 1, S.row);
  // cross the lanes right after the source, into the corridor beside the target's lane; or, when the
  // source cannot step straight into that corridor but the target can be reached straight from the
  // corridor beside the source's lane, cross them right before the target
  const intoTarget = facingCorridor(T, S), outOfSource = facingCorridor(S, T);
  const columns = grid.cells.length;
  const early = clearAcross(grid, S.row, sideKey(S, sideToward(S, corridorKey(intoTarget, columns))), corridorKey(intoTarget, columns), [S]);
  const late = clearAcross(grid, T.row, corridorKey(outOfSource, columns), sideKey(T, sideToward(T, corridorKey(outOfSource, columns))), [T]);
  return corridorRoute(grid, edge, label, S, T, !early && late ? outOfSource : intoTarget, true);
}

/** The corridor beside `box`'s lane on the side facing `other`'s lane (the high side within one lane). */
const facingCorridor = (/** @type {Box} */ box, /** @type {Box} */ other) => `${box.column}:${other.column < box.column ? 'low' : 'high'}`;

/** The corridor beside `box`'s lane on the side away from `other`'s lane. */
const farCorridor = (/** @type {Box} */ box, /** @type {Box} */ other) => `${box.column}:${other.column < box.column ? 'high' : 'low'}`;

/** @returns {Side} */
const sideToward = (/** @type {Box} */ box, /** @type {number} */ key) => (key < boxKey(box) ? 'low' : 'high');

/**
 * A decision's side branch: out of the corner facing the target, across to the target's line, then
 * along time into it. Only when the target lies beyond that corner and both stretches are clear.
 * @param {Grid} grid
 * @param {any} edge
 * @param {Size | null} label
 * @param {Box} S
 * @param {Box} T
 * @returns {Route | null}
 */
function branchRoute(grid, edge, label, S, T) {
  const side = sideToward(S, boxKey(T));
  const corner = sideKey(S, side);
  const beyond = side === 'low' ? boxKey(T) < corner - MARGIN : boxKey(T) > corner + MARGIN;
  if (!beyond || S.ports[side].some((p) => !p.out)) return null;
  if (!clearAcross(grid, S.row, corner, boxKey(T), [S]) || !clearAlong(grid, T.column, T.offset, S.row, T.row)) return null;
  const p = attach(S, side, T.row, true), q = attach(T, 'before', boxKey(S), false);
  return {
    edge, label, turns: [], runs: [], ports: [p, q], channel: false, bandGap: 0, bandRow: 0, bandShift: 0, labelOn: null,
    trace() {
      const P = portPoint(p), Q = portPoint(q);
      return [P, { t: P.t, l: Q.l }, Q];
    },
  };
}

/**
 * Back one row into the corner where a box's inputs arrive: back along the source's line past the
 * target's row, then across in the gap before the target. The source's port sits on the far side of
 * its other arrows to the target, so the two do not cross.
 * @param {Grid} grid
 * @param {any} edge
 * @param {Size | null} label
 * @param {Box} S
 * @param {Box} T
 * @returns {Route | null}
 */
function aroundRoute(grid, edge, label, S, T) {
  if (T.row === 0 || !clearAlong(grid, S.column, S.offset, T.row - 1, S.row)) return null;
  const away = boxKey(T) > boxKey(S) ? -0.5 : 0.5;
  return channelRoute(edge, label, attach(S, 'before', boxKey(T) + away, true), attach(T, 'before', boxKey(S), false), T.row - 1, T.row - 1);
}

/**
 * An arrow between two ports facing along time that turns once, in gap `gap` (or not at all, when
 * the ports line up).
 * @param {any} edge
 * @param {Size | null} label
 * @param {Port} p
 * @param {Port} q
 * @param {number} gap
 * @param {number} bandGap
 * @returns {Route}
 */
function channelRoute(edge, label, p, q, gap, bandGap) {
  /** @type {Turn} */
  const turn = { gap, ends: [{ l: () => lineOf(p), late: p.box.row > gap }, { l: () => lineOf(q), late: q.box.row > gap }], label: null, track: 0, t: 0, straight: false, keys: [boxKey(p.box), boxKey(q.box)] };
  p.toward = q;
  q.toward = p;
  return {
    edge, label, turns: [turn], runs: [], ports: [p, q], channel: true, bandGap, bandRow: 0, bandShift: 0, labelOn: null,
    trace() {
      const P = portPoint(p), Q = portPoint(q);
      return turn.straight ? [P, Q] : [P, { t: turn.t, l: P.l }, { t: turn.t, l: Q.l }, Q];
    },
  };
}

/**
 * An arrow that leaves its source, runs along a corridor and comes in to its target. It leaves and
 * enters from the side facing the corridor when nothing stands in between, and otherwise through
 * the gap next to the box.
 * @param {Grid} grid
 * @param {any} edge
 * @param {Size | null} label
 * @param {Box} S
 * @param {Box} T
 * @param {string} corridor
 * @param {boolean} forward
 * @returns {Route}
 */
function corridorRoute(grid, edge, label, S, T, corridor, forward) {
  const key = corridorKey(corridor, grid.cells.length);
  /** @type {Run} */
  const run = { corridor, from: 0, to: 0, track: 0, l: 0 };
  /** @type {Turn[]} */
  const turns = [];
  const turnAt = (/** @type {number} */ gap, /** @type {{ l: () => number, late: boolean }[]} */ ends, /** @type {Box} */ box) => {
    /** @type {Turn} */
    const turn = { gap, ends, label: null, track: 0, t: 0, straight: false, keys: [boxKey(box), key] };
    turns.push(turn);
    return turn;
  };

  /** @type {Side} */ const sSide = key < boxKey(S) ? 'low' : 'high';
  /** @type {Port} */ let exit;
  /** @type {Turn | null} */ let exitTurn = null;
  if (clearAcross(grid, S.row, sideKey(S, sSide), key, [S])) {
    exit = attach(S, sSide, T.row, true);
    run.from = S.row;
  } else {
    const port = attach(S, forward ? 'after' : 'before', key, true);
    const gap = forward ? S.row : S.row - 1;
    exit = port;
    // the corridor carries on to later rows when the arrow runs forward
    exitTurn = turnAt(gap, [{ l: () => lineOf(port), late: S.row > gap }, { l: () => run.l, late: forward }], S);
    run.from = gap + 0.5;
  }
  // a decision's corner that sends arrows on does not take one in; an arrow back into a decision
  // whose far corner sends comes in where the decision's inputs do
  const sends = (/** @type {Side} */ side) => T.diamond && T.ports[side].some((p) => p.out);
  /** @type {Side} */ const tSide = key < boxKey(T) ? 'low' : 'high';
  /** @type {Port} */ let entry;
  /** @type {Turn | null} */ let entryTurn = null;
  if (!sends(tSide) && clearAcross(grid, T.row, key, sideKey(T, tSide), [T])) {
    entry = attach(T, tSide, S.row, false);
    run.to = T.row;
  } else {
    const before = forward || (T.row > 0 && sends('after'));
    const port = attach(T, before ? 'before' : 'after', key, false);
    const gap = before ? T.row - 1 : T.row;
    entry = port;
    // the corridor arrives from later rows when the arrow runs back
    entryTurn = turnAt(gap, [{ l: () => run.l, late: !forward }, { l: () => lineOf(port), late: T.row > gap }], T);
    run.to = gap + 0.5;
  }
  const exitTurned = exitTurn, entryTurned = entryTurn;
  return {
    edge, label, turns, runs: [run], ports: [exit, entry], channel: false, bandGap: 0, bandRow: 0, bandShift: 0, labelOn: null,
    trace() {
      const E = portPoint(exit), N = portPoint(entry);
      return [
        E,
        ...(exitTurned ? [{ t: exitTurned.t, l: E.l }, { t: exitTurned.t, l: run.l }] : [{ t: E.t, l: run.l }]),
        ...(entryTurned ? [{ t: entryTurned.t, l: run.l }, { t: entryTurned.t, l: N.l }] : [{ t: N.t, l: run.l }]),
        N,
      ];
    },
  };
}

/**
 * Between boxes in the same row: straight across when nothing stands between them, else under both.
 * @param {Grid} grid
 * @param {any} edge
 * @param {Size | null} label
 * @param {Box} S
 * @param {Box} T
 */
function sameRowRoute(grid, edge, label, S, T) {
  const ahead = boxKey(T) > boxKey(S);
  /** @type {Side} */ const sSide = ahead ? 'high' : 'low';
  /** @type {Side} */ const tSide = ahead ? 'low' : 'high';
  if (!clearAcross(grid, S.row, sideKey(S, sSide), sideKey(T, tSide), [S, T])) {
    return channelRoute(edge, label, attach(S, 'after', boxKey(T), true), attach(T, 'after', boxKey(S), false), S.row, S.row);
  }
  const p = attach(S, sSide, T.row, true), q = attach(T, tSide, S.row, false);
  return /** @type {Route} */ ({
    edge, label, turns: [], runs: [], ports: [p, q], channel: false, bandGap: 0, bandRow: 0, bandShift: 0, labelOn: null,
    trace() {
      const P = portPoint(p), Q = portPoint(q);
      if (Math.abs(P.t - Q.t) < 0.5) return [P, Q];
      const l = (P.l + Q.l) / 2;
      return [P, { t: P.t, l }, { t: Q.t, l }, Q];
    },
  });
}

/**
 * An arrow from a box to itself: a small loop off its high side.
 * @param {any} edge
 * @param {Size | null} label
 * @param {Box} S
 */
function selfRoute(edge, label, S) {
  return /** @type {Route} */ ({
    edge, label, turns: [], runs: [], ports: [], channel: false, bandGap: 0, bandRow: 0, bandShift: 0, labelOn: null,
    trace() {
      const a = S.along / 4, l = S.l + S.across / 2;
      return [{ t: S.t - a, l }, { t: S.t - a, l: l + 2 * TRACK }, { t: S.t + a, l: l + 2 * TRACK }, { t: S.t + a, l }];
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Placement

/**
 * Corridor tracks, then every column's place across the lanes.
 * @param {Grid} grid
 * @param {Route[]} routes
 */
function placeColumns(grid, routes) {
  // per corridor, shorter runs nearer the boxes, so nested returns do not cross
  /** @type {Map<string, Run[]>} */
  const byCorridor = new Map();
  for (const run of routes.flatMap((r) => r.runs)) byCorridor.set(run.corridor, [...(byCorridor.get(run.corridor) ?? []), run]);
  /** @type {Map<string, number>} */
  const tracks = new Map();
  for (const [corridor, runs] of byCorridor) {
    const span = (/** @type {Run} */ r) => [Math.min(r.from, r.to), Math.max(r.from, r.to)];
    runs.sort((a, b) => (span(a)[1] - span(a)[0]) - (span(b)[1] - span(b)[0]) || span(a)[0] - span(b)[0]);
    /** @type {number[][][]} */
    const taken = [];
    for (const run of runs) {
      const [lo, hi] = span(run);
      let i = 0;
      while (taken[i]?.some(([a, b]) => a <= hi && lo <= b)) i++;
      (taken[i] ??= []).push([lo, hi]);
      run.track = i;
    }
    tracks.set(corridor, taken.length);
  }
  const zone = (/** @type {number} */ n) => (n ? SIDE + (n - 1) * TRACK : 0);
  let cursor = tracks.get('before') ? MARGIN + zone(tracks.get('before') ?? 0) : 0;
  grid.columns.forEach((col, c) => {
    const low = zone(tracks.get(`${c}:low`) ?? 0), high = zone(tracks.get(`${c}:high`) ?? 0);
    if (col.lane && grid.down) {
      // a lane is at least as wide as its title
      const short = (col.lane.labels?.[0]?.width ?? 0) - (low + high + col.low + col.high);
      if (short > 0) { col.low += short / 2; col.high += short / 2; }
    }
    col.start = cursor;
    col.spine = cursor + (col.lane && !grid.down ? TITLE : 0) + PAD + low + col.low;
    col.end = col.spine + col.high + high + PAD;
    cursor = col.end + GAP;
  });
  const last = grid.columns[grid.columns.length - 1];
  grid.width = last.end + (tracks.get('after') ? zone(tracks.get('after') ?? 0) + MARGIN : 0);
  for (const box of grid.boxes.values()) box.l = grid.columns[box.column].spine + box.offset;
  for (const runs of byCorridor.values()) for (const run of runs) run.l = corridorLine(grid, run);
}

/**
 * @param {Grid} grid
 * @param {Run} run
 * @returns {number}
 */
function corridorLine(grid, run) {
  const { columns } = grid;
  if (run.corridor === 'before') return columns[0].start - SIDE - run.track * TRACK;
  if (run.corridor === 'after') return columns[columns.length - 1].end + SIDE + run.track * TRACK;
  const [c, side] = run.corridor.split(':');
  const col = columns[Number(c)];
  return side === 'low' ? col.spine - col.low - SIDE - run.track * TRACK : col.spine + col.high + SIDE + run.track * TRACK;
}

/**
 * Ports on one side keep the order their arrows head in. A port whose arrow comes from a box that
 * meets it on that box's centre line (a diamond's corner, or the only port on that side) is pinned
 * to that line when the line falls on this side, so the arrow runs straight; the other ports spread
 * evenly around the pinned ones. Diamonds take every arrow at their corners.
 * @param {Grid} grid
 */
function spreadPorts(grid) {
  for (const box of grid.boxes.values()) {
    for (const side of /** @type {Side[]} */ (['before', 'after', 'low', 'high'])) {
      const ports = box.ports[side].sort((a, b) => a.key - b.key);
      if (box.diamond) { for (const p of ports) p.at = 0; continue; }
      const half = (side === 'before' || side === 'after' ? box.across : box.along) / 2;
      /** @type {(number | null)[]} */
      const pins = ports.map((p) => {
        const q = p.toward;
        if (!q || !(q.box.diamond || q.box.ports[q.side].length === 1)) return null;
        const at = q.box.l - box.l;
        return Math.abs(at) <= half - INSET ? at : null;
      });
      // pins out of order or too close to the previous pin give way
      let last = -Infinity;
      pins.forEach((at, i) => { if (at === null) return; if (at < last + TRACK) pins[i] = null; else last = at; });
      let i = 0;
      while (i < ports.length) {
        const pinned = pins[i];
        if (pinned !== null) { ports[i].at = pinned; i++; continue; }
        let j = i;
        while (j < ports.length && pins[j] === null) j++;
        const from = i > 0 ? ports[i - 1].at : -half, to = j < ports.length ? /** @type {number} */ (pins[j]) : half;
        for (let k = i; k < j; k++) ports[k].at = from + ((to - from) * (k - i + 1)) / (j - i + 1);
        i = j;
      }
    }
  }
}

/**
 * An arrow between neighbouring rows runs straight when its boxes overlap across the lanes.
 * @param {Route[]} routes
 */
function straighten(routes) {
  const fits = (/** @type {Port} */ port, /** @type {number} */ l) => !port.box.diamond && port.box.ports[port.side].length === 1 && Math.abs(l - port.box.l) <= port.box.across / 2 - INSET;
  for (const route of routes) {
    if (!route.channel) continue;
    const [p, q] = route.ports;
    if (Math.abs(p.box.row - q.box.row) !== 1 || route.turns[0].gap !== Math.min(p.box.row, q.box.row)) continue;
    const a = lineOf(p), b = lineOf(q);
    if (Math.abs(a - b) < 0.5) continue;
    if (fits(q, a)) q.at = a - q.box.l;
    else if (fits(p, b)) p.at = b - p.box.l;
  }
}

/**
 * Tracks in every gap, then every row's place along time.
 * @param {Grid} grid
 * @param {Route[]} routes
 */
function placeRows(grid, routes) {
  const { down } = grid;
  const alongT = (/** @type {Size} */ s) => (down ? s.height : s.width);
  const acrossL = (/** @type {Size} */ s) => (down ? s.width : s.height);
  /** @type {Gap[]} */
  const gaps = Array.from({ length: grid.rows }, () => ({ turns: [], tracks: [], bands: [], size: ROW_GAP, start: 0, trackT: [], bandT: [] }));
  /** @type {Map<number, { route: Route, l: number }[]>} labels riding straight through each gap */
  const banded = new Map();
  grid.widen = new Map();
  for (const route of routes) {
    for (const turn of route.turns) {
      turn.label = null;
      const [a, b] = turn.ends.map((e) => e.l());
      turn.straight = Math.abs(a - b) < 0.5;
      if (!turn.straight) gaps[turn.gap].turns.push(turn);
    }
    // a label rides on its arrow's turn when the turn is long enough, else in the band of the first
    // gap the arrow crosses, on the stretch that runs through that band
    if (route.label && route.channel) {
      const turn = route.turns[0];
      const [a, b] = turn.ends.map((e) => e.l());
      if (turn.straight || Math.abs(a - b) < acrossL(route.label) + 2 * ROOM) {
        route.labelOn = 'band';
        const through = turn.gap === route.bandGap ? turn.ends.find((e) => e.late) ?? turn.ends[0] : turn.ends[0];
        banded.set(route.bandGap, [...(banded.get(route.bandGap) ?? []), { route, l: through.l() }]);
      } else {
        turn.label = route.label;
        route.labelOn = turn;
      }
    }
  }
  // labels in one band sit on their line, or beside it where that covers fewer other lines through
  // the band, and take as many rows as they need to stay apart
  for (const [k, list] of banded) {
    const lines = linesThrough(routes, k);
    /** @type {{ end: number, size: number }[]} */
    const rows = [];
    for (const { route, l } of list.sort((x, y) => x.l - y.l)) {
      const label = /** @type {Size} */ (route.label), half = acrossL(label) / 2;
      const covered = (/** @type {number} */ c) => lines.filter((x) => Math.abs(x - l) >= 1 && Math.abs(x - c) < half + ROOM / 2).length;
      const centre = [l - half - ROOM / 2, l + half + ROOM / 2].reduce((a, b) => (covered(b) < covered(a) ? b : a), l);
      // a label beside its line must stay inside its lane: note how much wider the lane must be
      const c = grid.columns.findIndex((col) => col.start <= l && l <= col.end);
      if (c >= 0) {
        const col = grid.columns[c], need = grid.widen.get(c) ?? { low: 0, high: 0 };
        need.low = Math.max(need.low, col.start + ROOM / 2 - (centre - half));
        need.high = Math.max(need.high, centre + half - (col.end - ROOM / 2));
        grid.widen.set(c, need);
      }
      let r = rows.findIndex((row) => row.end + ROOM <= centre - half);
      if (r < 0) r = rows.push({ end: -Infinity, size: 0 }) - 1;
      rows[r].end = centre + half;
      rows[r].size = Math.max(rows[r].size, alongT(label));
      route.bandRow = r;
      route.bandShift = centre - l;
    }
    gaps[k].bands = rows.map((row) => row.size);
  }
  for (const gap of gaps) assignTracks(gap, alongT);

  const rowSize = Array.from({ length: grid.rows }, (_, r) => Math.max(0, ...grid.cells.flatMap((column) => column[r].map((b) => b.along))));
  let t = down ? TITLE : PAD;
  for (let r = 0; r < grid.rows; r++) {
    for (const column of grid.cells) for (const b of column[r]) b.t = t + rowSize[r] / 2;
    t += rowSize[r];
    const gap = gaps[r];
    gap.start = t;
    let at = t + STUB;
    gap.trackT = gap.tracks.map((h) => { const c = at + h / 2; at += h; return c; });
    gap.bandT = gap.bands.map((h) => { const c = at + ROOM / 2 + h / 2; at += h + ROOM; return c; });
    if (r < grid.rows - 1 || gap.turns.length) t += gap.size;
  }
  grid.length = t + PAD;
  grid.gaps = gaps;
  for (const route of routes) for (const turn of route.turns) if (!turn.straight) turn.t = gaps[turn.gap].trackT[turn.track];
}

/**
 * Where arrows run along time through the band of gap `k`, after its turns: the later ends of the
 * turns there, and arrows that pass the gap straight.
 * @param {Route[]} routes
 * @param {number} k
 * @returns {number[]}
 */
function linesThrough(routes, k) {
  const lines = [];
  for (const route of routes) {
    for (const turn of route.turns) {
      if (turn.gap === k && !turn.straight) lines.push(...turn.ends.filter((e) => e.late).map((e) => e.l()));
    }
    if (route.channel && route.turns[0].straight) {
      const [p, q] = route.ports;
      if (Math.min(p.box.row, q.box.row) <= k && k < Math.max(p.box.row, q.box.row)) lines.push(lineOf(p));
    }
  }
  return lines;
}

/**
 * Give every turn in a gap a track. Turns that overlap across the lanes need different tracks; of
 * two such turns, the one whose crossings are fewer when it runs nearer the earlier row goes there.
 * @param {Gap} gap
 * @param {(s: Size) => number} alongT
 */
function assignTracks(gap, alongT) {
  const { turns } = gap;
  const span = (/** @type {Turn} */ x) => { const [a, b] = x.ends.map((e) => e.l()); return [Math.min(a, b), Math.max(a, b)]; };
  const overlaps = (/** @type {Turn} */ x, /** @type {Turn} */ y) => { const [a, b] = span(x), [c, d] = span(y); return a < d + MARGIN && c < b + MARGIN; };
  const inside = (/** @type {number} */ l, /** @type {number[]} */ [lo, hi]) => l > lo + 0.5 && l < hi - 0.5;
  // crossings when x runs nearer the earlier row than y: x's ends that lead on to the later row cross
  // y, and y's ends that lead back to the earlier row cross x; and where an end of x leading on and
  // an end of y leading back share a line, the two arrows would run on top of each other there
  const same = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < 1;
  const cost = (/** @type {Turn} */ x, /** @type {Turn} */ y) =>
    x.ends.filter((e) => e.late && inside(e.l(), span(y))).length + y.ends.filter((e) => !e.late && inside(e.l(), span(x))).length
    + 2 * x.ends.filter((e) => e.late && y.ends.some((f) => !f.late && same(e.l(), f.l()))).length;
  const wins = turns.map((x) => turns.filter((y) => y !== x && overlaps(x, y) && cost(x, y) < cost(y, x)).length);
  const order = turns.map((_, i) => i).sort((i, j) => wins[j] - wins[i] || i - j);
  /** @type {Turn[]} */
  const placed = [];
  for (const i of order) {
    const x = turns[i];
    x.track = Math.max(-1, ...placed.filter((y) => overlaps(x, y)).map((y) => y.track)) + 1;
    placed.push(x);
  }
  const count = Math.max(0, ...turns.map((x) => x.track + 1));
  gap.tracks = Array.from({ length: count }, (_, k) => Math.max(TRACK, ...turns.filter((x) => x.track === k && x.label).map((x) => alongT(/** @type {Size} */ (x.label)) + ROOM)));
  if (count || gap.bands.length) gap.size = Math.max(ROW_GAP, STUB + gap.tracks.reduce((s, h) => s + h, 0) + gap.bands.reduce((s, h) => s + h + ROOM, 0) + STUB);
}

// ---------------------------------------------------------------------------------------------
// Back to Mermaid's graph

/**
 * Positions, frames, arrows and labels onto Mermaid's ELK graph, in the frames Mermaid reads them in.
 * @param {any} root
 * @param {Grid} grid
 * @param {Route[]} routes
 */
function writeBack(root, grid, routes) {
  const { down } = grid;
  const xy = (/** @type {Pt} */ p) => (down ? { x: p.l, y: p.t } : { x: p.t, y: p.l });
  for (const col of grid.columns) {
    if (!col.lane) continue;
    const frame = down
      ? { x: col.start, y: 0, width: col.end - col.start, height: grid.length }
      : { x: 0, y: col.start, width: grid.length, height: col.end - col.start };
    // the vendored plugin keeps this frame instead of fitting it to the lane's boxes
    Object.assign(col.lane, frame, { semanticFrame: true });
  }
  const laneOf = (/** @type {string} */ id) => grid.columns[grid.boxes.get(id)?.column ?? -1]?.lane ?? null;
  for (const box of grid.boxes.values()) {
    const corner = xy({ t: box.t - box.along / 2, l: box.l - box.across / 2 });
    const lane = laneOf(box.id);
    box.node.x = corner.x - (lane?.x ?? 0);
    box.node.y = corner.y - (lane?.y ?? 0);
  }
  for (const route of routes) {
    const e = route.edge;
    const [s, t] = drawnEnds(e);
    // an arrow inside one lane is read relative to that lane's frame
    const lane = laneOf(s) && laneOf(s) === laneOf(t) ? laneOf(s) : null;
    const local = (/** @type {Pt} */ p) => { const q = xy(p); return { x: q.x - (lane?.x ?? 0), y: q.y - (lane?.y ?? 0) }; };
    const points = simplify(route.trace());
    const drawn = points.map(local);
    // Mermaid reads sections in layout direction and reverses those of edges laid out reversed
    if (e.layoutReversed) drawn.reverse();
    e.sections = [{ id: `${e.id}_s0`, startPoint: drawn[0], endPoint: drawn[drawn.length - 1], bendPoints: drawn.slice(1, -1) }];
    if (route.label) {
      const centre = local(labelCentre(route, points, grid));
      e.labels = e.labels.map((/** @type {any} */ l) => ({ ...l, x: centre.x - l.width / 2, y: centre.y - l.height / 2 }));
    }
  }
  const size = xy({ t: grid.length, l: grid.width });
  root.width = size.x;
  root.height = size.y;
}

/**
 * @param {Route} route
 * @param {Pt[]} points
 * @param {Grid} grid
 * @returns {Pt}
 */
function labelCentre(route, points, grid) {
  const label = /** @type {Size} */ (route.label);
  const on = route.labelOn;
  if (on && on !== 'band') {
    const [a, b] = on.ends.map((e) => e.l());
    return { t: on.t, l: (a + b) / 2 };
  }
  const runs = points.slice(1).map((q, i) => [points[i], q]);
  if (on === 'band') {
    const t = grid.gaps[route.bandGap].bandT[route.bandRow];
    const run = runs.find(([p, q]) => Math.abs(p.l - q.l) < 0.5 && Math.min(p.t, q.t) <= t && t <= Math.max(p.t, q.t));
    if (run) return { t, l: run[0].l + route.bandShift };
  }
  // the first stretch from the source long enough to carry the label, else the longest
  const alongT = grid.down ? label.height : label.width, acrossL = grid.down ? label.width : label.height;
  const length = (/** @type {Pt[]} */ [p, q]) => Math.abs(p.t - q.t) + Math.abs(p.l - q.l);
  const need = (/** @type {Pt[]} */ [p, q]) => (Math.abs(p.l - q.l) < 0.5 ? alongT : acrossL) + 2 * ROOM;
  const run = runs.find((r) => length(r) >= need(r)) ?? runs.reduce((a, b) => (length(b) > length(a) ? b : a));
  return { t: (run[0].t + run[1].t) / 2, l: (run[0].l + run[1].l) / 2 };
}

/**
 * Drop repeated points and points that do not turn.
 * @param {Pt[]} points
 */
function simplify(points) {
  const same = (/** @type {Pt} */ a, /** @type {Pt} */ b) => Math.abs(a.t - b.t) < 0.5 && Math.abs(a.l - b.l) < 0.5;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (same(out[out.length - 1], p)) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const inLine = (Math.abs(a.t - b.t) < 0.5 && Math.abs(b.t - p.t) < 0.5) || (Math.abs(a.l - b.l) < 0.5 && Math.abs(b.l - p.l) < 0.5);
      if (inLine) out.pop();
    }
    out.push(p);
  }
  return out;
}
