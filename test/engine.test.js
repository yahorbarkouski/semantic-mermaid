import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectives } from '../src/language/directives.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts } from '../src/facts/resolve.js';
import { applyFeatures, restoreEdges } from '../src/engine/elk-graph.js';
import { candidates } from '../src/engine/layout.js';
import { measure, placeTitles, score } from '../src/engine/score.js';
import { alignMainPath } from '../src/engine/labels.js';
import { layoutData, elkGraph } from './helpers.js';

const ALL = { spine: true, loops: true, sideBoxes: true, sideGroups: true, ports: true, merge: false, peerOrder: false, direction: null };
const setup = (arrows, source, extra) => {
  const data = layoutData(arrows, extra);
  const graph = buildGraph(data);
  const { facts } = resolveFacts(graph, parseDirectives(source).annotations);
  return { graph, facts, elk: elkGraph(data) };
};

test('declared retries are laid out as returns, the main path is straightened', () => {
  const { graph, facts, elk } = setup(['A-->B', 'B-->C', 'C-->B'], '%% @main A B C\n%% @retry C -> B');
  applyFeatures(elk, graph, facts, ALL);
  const back = elk.edges.find((e) => e.id === 'L_C_B_2');
  assert.equal(back.layoutReversed, true);
  assert.deepEqual([back.sources, back.targets], [['B'], ['C']]);
  for (const id of ['L_A_B_0', 'L_B_C_1']) assert.equal(elk.edges.find((e) => e.id === id).layoutOptions['elk.layered.priority.straightness'], '10');
});

test('a decision gets ports: continuation down, exit to one side, retry to the other; restored after layout', () => {
  const { graph, facts, elk } = setup(['A-->D', 'D--ok-->E', 'D--bad-->X', 'D--again-->A', 'X-->Y'], '%% @main A D E\n%% @exit D -> X\n%% @retry D -> A', { shapes: { D: 'diamond' } });
  const { portOwner: owner } = applyFeatures(elk, graph, facts, ALL);
  const d = elk.children.find((n) => n.id === 'D');
  const side = (edgeId) => d.ports.find((p) => [...elk.edges.find((e) => e.id === edgeId).sources, ...elk.edges.find((e) => e.id === edgeId).targets].includes(p.id)).layoutOptions['elk.port.side'];
  assert.equal(side('L_D_E_1'), 'SOUTH');
  assert.equal(side('L_D_X_2'), 'EAST');
  assert.equal(side('L_D_A_3'), 'WEST');
  assert.equal(side('L_A_D_0'), 'NORTH');
  restoreEdges(elk, owner);
  assert.ok(elk.edges.every((e) => !e.sources[0].includes('__port') && !e.targets[0].includes('__port')));
});

test('side boxes and terminal exits become comment boxes inside their group', () => {
  const { graph, facts, elk } = setup(['A-->D', 'D--ok-->E', 'D--no-->X', 'R-.->D', 'E-->F', 'F-->G'], '%% @exit D -> X\n%% @side R', { shapes: { D: 'diamond' }, groups: ['G1'], parents: { A: 'G1', D: 'G1', E: 'G1', X: 'G1', R: 'G1' } });
  applyFeatures(elk, graph, facts, ALL);
  const group = elk.children.find((n) => n.id === 'G1');
  const comment = (id) => group.children.find((n) => n.id === id)?.layoutOptions['elk.commentBox'];
  assert.equal(comment('X'), 'true');
  assert.equal(comment('R'), 'true');
  assert.equal(comment('E'), undefined);
  // spacing is read from the graph that holds the comment, and leaves room for the "no" label
  assert.ok(Number(group.layoutOptions['elk.spacing.commentNode']) >= 56);
});

test('plain ELK is always a candidate; strips and bottom-up drawings get a turned candidate', () => {
  const { facts } = setup(['A-->B', 'B-->C'], '');
  assert.equal(candidates(facts, { direction: 'DOWN', aspect: 1 })[0].name, 'elk');
  assert.ok(candidates(facts, { direction: 'RIGHT', aspect: 9 }).some((c) => c.features.direction === 'DOWN'));
  assert.ok(candidates(facts, { direction: 'DOWN', aspect: 13 }).some((c) => c.features.direction === 'RIGHT'));
  assert.ok(!candidates(facts, { direction: 'RIGHT', aspect: 6 }).some((c) => c.features.direction));
  assert.ok(candidates(facts, { direction: 'UP', aspect: 1 }).some((c) => c.features.direction === 'DOWN'));
  // a drawing its page would shrink below 40% is tried turned, and only when a page width is known
  assert.ok(candidates(facts, { direction: 'RIGHT', aspect: 5, width: 2500, pageWidth: 800 }).some((c) => c.features.direction === 'DOWN'));
  assert.ok(!candidates(facts, { direction: 'RIGHT', aspect: 5, width: 2500 }).some((c) => c.features.direction));
  assert.ok(!candidates(facts, { direction: 'RIGHT', aspect: 5, width: 1500, pageWidth: 800 }).some((c) => c.features.direction));
});

test('the score counts crossings and arrows through boxes, and moves a crossed title aside', () => {
  const facts = { loops: new Set(), mainPath: [], peers: [] };
  const geometry = {
    boxes: new Map([['A', { x: 0, y: 0, w: 40, h: 20 }], ['B', { x: 0, y: 200, w: 40, h: 20 }], ['C', { x: 100, y: 100, w: 40, h: 20 }], ['P', { x: -100, y: 100, w: 40, h: 20 }], ['Q', { x: 300, y: 100, w: 40, h: 20 }]]),
    groups: new Map([['G', { x: 0, y: 60, w: 200, h: 120 }]]),
    titles: new Map([['G', { w: 60, h: 20 }]]),
    edges: [
      { id: 'a', from: 'A', to: 'B', points: [{ x: 20, y: 20 }, { x: 20, y: 200 }], labels: [] },
      { id: 'b', from: 'P', to: 'Q', points: [{ x: -60, y: 150 }, { x: 300, y: 150 }], labels: [] },
    ],
    width: 400, height: 220, direction: 'DOWN',
  };
  const m = measure(/** @type {any} */ (geometry), /** @type {any} */ (facts));
  assert.equal(m.crossings, 1);
  assert.equal(m.throughBoxes, 0);
  // the vertical arrow at x=20 crosses the left end of the frame's top edge, not the centre
  assert.equal(placeTitles(/** @type {any} */ (geometry)).titleSides.get('G'), 'center');
  geometry.edges[0].points = [{ x: 100, y: 20 }, { x: 100, y: 200 }];
  assert.equal(placeTitles(/** @type {any} */ (geometry)).titleSides.get('G'), 'left');
  assert.ok(Number.isFinite(score(m)));
});

/** A laid-out ELK graph: A, B and C down one column with B pushed 22 px right, and a retry from R into B's top. */
function shiftedColumn(extra = []) {
  return {
    id: 'root', layoutOptions: { 'elk.direction': 'DOWN' },
    children: [
      { id: 'A', x: 100, y: 0, width: 100, height: 40 },
      { id: 'B', x: 122, y: 100, width: 100, height: 40 },
      { id: 'C', x: 100, y: 200, width: 100, height: 40 },
      { id: 'R', x: 300, y: 200, width: 100, height: 40 },
      ...extra,
    ],
    edges: [
      { id: 'e1', sources: ['A'], targets: ['B'], sections: [{ startPoint: { x: 150, y: 40 }, bendPoints: [{ x: 150, y: 70 }, { x: 172, y: 70 }], endPoint: { x: 172, y: 100 } }] },
      { id: 'e2', sources: ['B'], targets: ['C'], sections: [{ startPoint: { x: 150, y: 140 }, endPoint: { x: 150, y: 200 } }] },
      { id: 'e3', sources: ['R'], targets: ['B'], sections: [{ startPoint: { x: 350, y: 200 }, bendPoints: [{ x: 350, y: 80 }, { x: 200, y: 80 }], endPoint: { x: 200, y: 100 } }] },
    ],
  };
}

test('a main-path box ELK pushed aside moves back onto the path, and its arrows follow', () => {
  const result = alignMainPath(shiftedColumn(), { mainPath: ['e1', 'e2'] }, new Set());
  const box = (id) => result.children.find((c) => c.id === id);
  const edge = (id) => result.edges.find((e) => e.id === id).sections[0];
  assert.equal(box('B').x, 100);
  assert.deepEqual([edge('e1').startPoint, edge('e1').endPoint, edge('e1').bendPoints], [{ x: 150, y: 40 }, { x: 150, y: 100 }, []]);
  // the retry ended at B's top corner, so its last stretch moves with the box
  assert.deepEqual([edge('e3').bendPoints[1], edge('e3').endPoint], [{ x: 178, y: 80 }, { x: 178, y: 100 }]);
});

test('a main-path box stays where it is when moving it would crowd another box', () => {
  const result = alignMainPath(shiftedColumn([{ id: 'N', x: 40, y: 100, width: 55, height: 40 }]), { mainPath: ['e1', 'e2'] }, new Set());
  assert.equal(result.children.find((c) => c.id === 'B').x, 122);
});
