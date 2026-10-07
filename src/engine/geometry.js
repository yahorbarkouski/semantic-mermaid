// Absolute geometry of a laid-out ELK graph: the shapes the score and the title placement read.
import { absoluteFrames } from './elk-graph.js';

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/**
 * @typedef {object} Geometry
 * @property {Map<string, Box>} boxes       leaf boxes by id
 * @property {Map<string, Box>} groups      group frames by id
 * @property {Map<string, { w: number, h: number }>} titles  group title sizes by id
 * @property {{ id: string, from: string, to: string, points: Point[], labels: Box[] }[]} edges
 *           arrows as drawn: `from`/`to` follow the author's direction, points run from `from`
 * @property {number} width
 * @property {number} height
 * @property {string} direction  ELK direction of the layout: DOWN, UP, RIGHT or LEFT
 */

/**
 * @param {any} result laid-out ELK graph, ports already mapped back to boxes
 * @returns {Geometry}
 */
export function readGeometry(result) {
  const { boxes: all, frameOf } = absoluteFrames(result);
  /** @type {Map<string, Box>} */ const boxes = new Map();
  /** @type {Map<string, Box>} */ const groups = new Map();
  /** @type {Map<string, { w: number, h: number }>} */ const titles = new Map();
  const walk = (n) => {
    for (const c of n.children ?? []) {
      const b = all.get(c.id);
      if (!b) continue;
      if (c.children?.length) {
        groups.set(c.id, b);
        const label = c.labels?.[0];
        if (label) titles.set(c.id, { w: label.width ?? 0, h: label.height ?? 0 });
        walk(c);
      } else boxes.set(c.id, b);
    }
  };
  walk(result);
  const edges = [];
  for (const e of result.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const o = frameOf(e.sources[0], e.targets[0]);
    let points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
    let [from, to] = [e.sources[0], e.targets[0]];
    if (e.layoutReversed) { points = points.reverse(); [from, to] = [to, from]; }
    const labels = (e.labels ?? []).filter((l) => l.width > 0).map((l) => ({ x: (l.x ?? 0) + o.x, y: (l.y ?? 0) + o.y, w: l.width, h: l.height }));
    edges.push({ id: e.id, from, to, points, labels });
  }
  return { boxes, groups, titles, edges, width: result.width ?? 0, height: result.height ?? 0, direction: result.layoutOptions?.['elk.direction'] ?? 'DOWN' };
}
