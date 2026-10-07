// The semantic layout: try a few layouts derived from the facts (ELK configurations, and a lane
// layout of our own when lanes are declared), measure each result, keep the best. Plain ELK is
// always one of them, so the engine never picks a layout its own score rates worse than ELK's.
import { applyFeatures, undoFeatures } from './elk-graph.js';
import { layoutSideGroups } from './side-groups.js';
import { layoutLanes } from './lanes.js';
import { alignMainPath, clearLabels, straightenEnds } from './labels.js';
import { DECISION_SHAPES } from '../facts/resolve.js';
import { readGeometry } from './geometry.js';
import { measure, score } from './score.js';

/** @typedef {import('../model/graph.js').Graph} Graph */
/** @typedef {import('../facts/resolve.js').Facts} Facts */
/** @typedef {import('./elk-graph.js').Features} Features */
/** @typedef {import('./score.js').Measurements} Measurements */

/**
 * @typedef {object} Candidate
 * @property {string} name
 * @property {Features} features
 * @property {import('./lanes.js').LaneOptions} [lanes]  lay the diagram out in its declared lanes instead
 */

/**
 * @typedef {object} Choice
 * @property {string} chosen                     name of the chosen candidate
 * @property {{ name: string, score: number, error?: string }[]} tried  every candidate, best first
 * @property {Measurements} measurements          of the chosen layout
 * @property {Measurements} baseline              of plain ELK
 * @property {string[]} unapplied                 declared facts the chosen layout leaves out, and why
 */

const NONE = { spine: false, loops: false, sideBoxes: false, sideGroups: false, ports: false, merge: false, peerOrder: false, direction: null };

/** Width-to-height ratio beyond which a drawing is a strip worth turning. */
const STRIP = 8;

/** Mermaid's ELK direction for a diagram, and the one readers expect instead of it. */
const READING = { UP: 'DOWN', LEFT: 'RIGHT' };

/**
 * The candidates worth trying for this diagram. Each one is a reason to deviate from ELK: declared
 * lanes, the meaning-driven settings, the same with fan-outs drawn as buses or with network-simplex
 * placement, without decision ports, forced peer order, loop reversal or side groups when those
 * exist, and the other direction for a strip or a bottom-up drawing.
 * @param {Facts} facts
 * @param {{ direction: string, aspect: number }} base  plain ELK's direction and shape
 * @returns {Candidate[]}
 */
export function candidates(facts, base) {
  const semantic = { ...NONE, spine: true, loops: true, sideBoxes: true, sideGroups: facts.sideGroups.size > 0, ports: true, peerOrder: facts.peers.length > 0 };
  /** @type {Candidate[]} */
  const list = [
    { name: 'elk', features: NONE },
    ...(facts.lanes.length ? [
      { name: 'lanes', features: NONE, lanes: /** @type {const} */ ({ returns: 'between' }) },
      { name: 'lanes-outside', features: NONE, lanes: /** @type {const} */ ({ returns: 'outside' }) },
    ] : []),
    { name: 'semantic', features: semantic },
    { name: 'semantic+bus', features: { ...semantic, merge: true } },
    { name: 'semantic-simplex', features: { ...semantic, simplex: true } },
  ];
  if (facts.continuation.size) list.push({ name: 'semantic-no-ports', features: { ...semantic, ports: false } });
  // forcing peer order fixes every box's order; the score weighs that against a free order
  if (facts.peers.length) list.push({ name: 'semantic-free-order', features: { ...semantic, peerOrder: false } });
  if (facts.loops.size) list.push({ name: 'semantic-no-loops', features: { ...semantic, loops: false } });
  if (facts.sideGroups.size) list.push({ name: 'semantic-groups-in-place', features: { ...semantic, sideGroups: false } });

  const directions = [];
  if (READING[base.direction]) directions.push(READING[base.direction]);
  // only an extreme strip is turned: judges preferred compact left-to-right drawings up to about
  // 7:1 over the tall columns that turning them produced, and preferred a turned 13:1 tree
  else if (base.direction === 'RIGHT' && base.aspect > STRIP) directions.push('DOWN');
  else if (base.direction === 'DOWN' && base.aspect > STRIP) directions.push('RIGHT');
  for (const direction of directions) {
    for (const c of list.filter((x) => !x.lanes).slice(0, 3)) list.push({ name: `${c.name}@${direction.toLowerCase()}`, features: { ...c.features, direction } });
    for (const c of list.filter((x) => x.lanes && !x.features.direction)) list.push({ name: `${c.name}@${direction.toLowerCase()}`, features: { ...NONE, direction }, lanes: c.lanes });
  }
  return list;
}

/** Drawing against the reading direction costs a little, so a top-down version wins ties. */
const UPSTREAM_COST = { UP: 1, LEFT: 1 };

/**
 * What a candidate costs for ignoring structure the author declared: the author said what the
 * diagram is, so a layout that leaves it out must win on geometry by a clear margin. Judges agreed
 * when the margin was clear: a pipeline whose stages were declared as lanes read better as stacked
 * groups than as a staircase across five mostly empty lanes.
 * @param {Candidate} candidate
 * @param {Facts} facts
 */
function ignoredCost(candidate, facts) {
  const lanes = facts.lanes.length && !candidate.lanes ? 2 : 0;
  const groups = candidate.lanes || candidate.features.sideGroups ? 0 : [...facts.sideGroups.values()].filter((g) => g.source === 'declared').length * 1.5;
  return lanes + groups;
}

/**
 * Lay out Mermaid's ELK graph semantically.
 * @param {any} elkGraph the graph Mermaid built
 * @param {{ layout: (g: any) => Promise<any> }} elk  Mermaid's ELK instance
 * @param {{ graph: Graph, facts: Facts, force?: string }} context  `force` names a candidate to use regardless of score (for inspection)
 * @returns {Promise<{ result: any, choice: Choice }>} the laid-out graph for Mermaid, and why
 */
export async function layoutSemantically(elkGraph, elk, { graph, facts, force }) {
  // candidates run on data-only copies (Mermaid's graph carries functions); the winner is then
  // replayed on Mermaid's own graph object, which Mermaid reads back after layout
  const inner = await layoutSideGroups(elkGraph, elk, facts);
  const corners = new Set([...graph.nodes.values()].filter((n) => DECISION_SHAPES.has(n.shape)).map((n) => n.id));
  /** Lay a candidate out with ELK, or with the lane router. */
  const lay = async (/** @type {any} */ target, /** @type {Candidate} */ candidate) => {
    if (candidate.lanes) {
      if (candidate.features.direction) target.layoutOptions['elk.direction'] = candidate.features.direction;
      const laid = layoutLanes(target, graph, facts, candidate.lanes);
      if (typeof laid === 'string') throw new Error(laid);
      return laid;
    }
    const applied = applyFeatures(target, graph, facts, candidate.features, inner);
    return undoFeatures(await elk.layout(target), applied);
  };
  /** The finishing touches; `align` puts main-path boxes back on the path's line. */
  const finish = (/** @type {any} */ laid, /** @type {Candidate} */ candidate, /** @type {boolean} */ align) => {
    if (candidate.lanes) return clearLabels(laid);
    if (align) alignMainPath(laid, facts, corners);
    return clearLabels(straightenEnds(laid, corners));
  };
  const scored = (/** @type {any} */ result, /** @type {Candidate} */ candidate) => {
    const measurements = measure(readGeometry(result), facts);
    const direction = result.layoutOptions?.['elk.direction'] ?? 'DOWN';
    return { measurements, score: score(measurements) + (UPSTREAM_COST[direction] ?? 0) + ignoredCost(candidate, facts) };
  };
  const run = async (/** @type {Candidate} */ candidate) => {
    const laid = await lay(JSON.parse(JSON.stringify(elkGraph)), candidate);
    // aligning the main path moves boxes after ELK placed them; it is kept only where it scores
    // better, and plain ELK stays as ELK draws it, the baseline the other candidates are measured against
    const plain = { candidate, align: false, ...scored(finish(JSON.parse(JSON.stringify(laid)), candidate, false), candidate) };
    if (candidate.lanes || !candidate.features.spine) return plain;
    const aligned = { candidate, align: true, ...scored(finish(laid, candidate, true), candidate) };
    return aligned.score < plain.score ? aligned : plain;
  };

  const base = await run({ name: 'elk', features: NONE });
  const plan = candidates(facts, { direction: elkGraph.layoutOptions?.['elk.direction'] ?? 'DOWN', aspect: base.measurements.aspect });
  const runs = [base];
  /** @type {{ name: string, error: string }[]} */
  const failed = [];
  for (const candidate of plan.slice(1)) {
    try {
      runs.push(await run(candidate));
    } catch (error) {
      // a candidate that fails (an ELK exception, lanes that cannot be laid out) is ruled out; the
      // others, and plain ELK, remain
      failed.push({ name: candidate.name, error: String(/** @type {any} */ (error)?.message ?? error).slice(0, 160) });
    }
  }
  // stable sort: on equal scores the earlier candidate, plain ELK first, wins
  const ranked = runs.map((r, i) => ({ r, i })).sort((a, b) => a.r.score - b.r.score || a.i - b.i).map((x) => x.r);
  const best = ranked.find((r) => r.candidate.name === force) ?? ranked[0];
  return {
    result: finish(await lay(elkGraph, best.candidate), best.candidate, best.align),
    choice: {
      chosen: best.candidate.name,
      tried: [...ranked.map((r) => ({ name: r.candidate.name, score: round(r.score) })), ...failed.map((f) => ({ name: f.name, score: NaN, error: f.error }))],
      measurements: best.measurements,
      baseline: base.measurements,
      unapplied: unapplied(best.candidate, best.measurements, facts, runs.some((r) => r.candidate.lanes)),
    },
  };
}

/**
 * Declared facts the chosen layout leaves out. Each was tried: a candidate that applies it scored
 * worse, so the layout keeps the fact's colours and says why its geometry differs. (Lanes that
 * could not be laid out at all are reported with the reason instead.)
 * @param {Candidate} candidate
 * @param {Measurements} m
 * @param {Facts} facts
 * @param {boolean} lanesRan  a lane layout was made and scored
 * @returns {string[]}
 */
function unapplied(candidate, m, facts, lanesRan) {
  const notes = [];
  if (candidate.lanes) return notes;
  if (lanesRan) notes.push('the declared lanes are drawn as ordinary groups: the lane layout scored worse (lanes suit parties that hand work back and forth, not stages a process passes once)');
  if (facts.mainSource === 'declared' && facts.mainPath.length && !candidate.features.spine && (m.spine ?? 1) < 1) {
    notes.push('the declared main path is coloured but not drawn straight: the layouts that straighten it scored worse');
  }
  if (m.peerDisorder > 0) {
    notes.push(`declared peers are out of order in ${m.peerDisorder} place${m.peerDisorder > 1 ? 's' : ''}: the layouts that keep the order scored worse`);
  }
  if (!candidate.features.sideGroups) {
    for (const [id, group] of facts.sideGroups) {
      if (group.source === 'declared') notes.push(`side group ${id} stays where ELK put it: the layouts that put it beside ${group.step} scored worse`);
    }
  }
  return notes;
}

const round = (x) => Math.round(x * 100) / 100;
