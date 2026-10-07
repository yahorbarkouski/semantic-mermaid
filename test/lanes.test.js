import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectives } from '../src/language/directives.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts } from '../src/facts/resolve.js';
import { layoutLanes, timeRows } from '../src/engine/lanes.js';
import { readGeometry } from '../src/engine/geometry.js';
import { measure } from '../src/engine/score.js';
import { layoutData, elkGraph } from './helpers.js';

// a sign-in handed between three parties, with a decision in the last and a retry back to the start
const ARROWS = ['U1-->S1', 'S1-->S2', 'S2-->U2', 'U2-->I1', 'I1-->I2', 'I2--No-->I3', 'I3-->I4', 'I2--Yes-->I4', 'I4-->U3', 'U3-->S3', 'S3-->U1'];
const PARENTS = { U1: 'User', U2: 'User', U3: 'User', S1: 'App', S2: 'App', S3: 'App', I1: 'IdP', I2: 'IdP', I3: 'IdP', I4: 'IdP' };
const SOURCE = '%% @lanes User App IdP\n%% @main U1 S1 S2 U2 I1 I2 I4 U3 S3\n%% @retry S3 -> U1';

function laneLayout(direction = 'DOWN', parents = PARENTS, /** @type {import('../src/engine/lanes.js').LaneOptions} */ options = { returns: 'between' }) {
  const data = layoutData(ARROWS, { groups: ['User', 'App', 'IdP'], parents, shapes: { I2: 'diamond' } });
  const graph = buildGraph(data);
  const { facts } = resolveFacts(graph, parseDirectives(SOURCE).annotations);
  const root = elkGraph(data);
  root.layoutOptions['elk.direction'] = direction;
  for (const lane of root.children) lane.labels = [{ text: lane.id, width: 40, height: 20 }];
  return { root, facts, laid: layoutLanes(root, graph, facts, options) };
}

test('time rows follow the longest path, with retries and cycle-closing arrows left out', () => {
  const { root, facts } = laneLayout();
  const order = ['U1', 'S1', 'S2', 'U2', 'I1', 'I2', 'I3', 'I4', 'U3', 'S3'];
  const rows = timeRows(order, root.edges, facts);
  assert.deepEqual(order.map((id) => rows.get(id)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const plain = { loops: new Set(), mainPath: [] };
  const cycle = elkGraph(layoutData(['A-->B', 'B-->C', 'C-->B'])).edges;
  assert.deepEqual([...timeRows(['A', 'B', 'C'], cycle, /** @type {any} */ (plain))], [['A', 0], ['B', 1], ['C', 2]]);
  // a box that only feeds another sits one row before its first use
  const late = elkGraph(layoutData(['A-->B', 'B-->C', 'R-->C'])).edges;
  assert.equal(timeRows(['A', 'B', 'C', 'R'], late, /** @type {any} */ (plain)).get('R'), 1);
});

test('lanes are columns in declared order, of one length, each holding its own boxes', () => {
  const { laid } = laneLayout();
  const g = readGeometry(laid);
  const frames = ['User', 'App', 'IdP'].map((id) => /** @type {any} */ (g.groups.get(id)));
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].x >= frames[i - 1].x + frames[i - 1].w, 'side by side, in order');
  assert.ok(frames.every((f) => f.y === frames[0].y && f.h === frames[0].h), 'one length');
  for (const [box, lane] of Object.entries(PARENTS)) {
    const b = /** @type {any} */ (g.boxes.get(box)), f = /** @type {any} */ (g.groups.get(lane));
    assert.ok(b.x >= f.x && b.x + b.w <= f.x + f.w && b.y >= f.y && b.y + b.h <= f.y + f.h, `${box} inside ${lane}`);
  }
  assert.ok(laid.children.every((/** @type {any} */ lane) => lane.semanticFrame), 'Mermaid keeps the frames as laid out');
});

test('the main path runs straight down its lane, and the box it passes steps aside', () => {
  const g = readGeometry(laneLayout().laid);
  const cx = (/** @type {string} */ id) => { const b = /** @type {any} */ (g.boxes.get(id)); return b.x + b.w / 2; };
  assert.equal(cx('I1'), cx('I2'));
  assert.equal(cx('I2'), cx('I4'));
  assert.notEqual(cx('I3'), cx('I4'));
  const yes = g.edges.find((e) => e.from === 'I2' && e.to === 'I4');
  assert.ok(yes && yes.points.every((p) => p.x === cx('I4')), 'the main branch is one straight line');
});

test('arrows between lanes cross nothing, and a return runs where it crosses nothing', () => {
  const { laid, facts } = laneLayout();
  const g = readGeometry(laid);
  const m = measure(g, facts);
  assert.equal(m.crossings, 0);
  assert.equal(m.throughBoxes, 0);
  for (const e of g.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [a, b] = [e.points[i - 1], e.points[i]];
      assert.ok(a.x === b.x || a.y === b.y, `${e.id} runs orthogonally`);
    }
  }
  // between User and App the return would cross every hand-off, so it runs on User's far side
  const retry = /** @type {any} */ (g.edges.find((e) => e.from === 'S3' && e.to === 'U1'));
  assert.ok(Math.min(...retry.points.map((/** @type {any} */ p) => p.x)) < /** @type {any} */ (g.boxes.get('U1')).x);
  const outside = readGeometry(laneLayout('DOWN', PARENTS, { returns: 'outside' }).laid);
  const around = /** @type {any} */ (outside.edges.find((e) => e.from === 'S3' && e.to === 'U1'));
  assert.ok(Math.min(...around.points.map((/** @type {any} */ p) => p.x)) < /** @type {any} */ (outside.groups.get('User')).x, 'or outside the lanes');
});

test('a return between two lanes stays beside them when a corridor there crosses nothing', () => {
  const arrows = ['A1-->A2', 'A2-->B1', 'B1-->B2', 'B2-->B3', 'B3-->A2'];
  const data = layoutData(arrows, { groups: ['A', 'B'], parents: { A1: 'A', A2: 'A', B1: 'B', B2: 'B', B3: 'B' } });
  const graph = buildGraph(data);
  const { facts } = resolveFacts(graph, parseDirectives('%% @lanes A B\n%% @retry B3 -> A2').annotations);
  const root = elkGraph(data);
  const g = readGeometry(layoutLanes(root, graph, facts, { returns: 'between' }));
  const back = /** @type {any} */ (g.edges.find((e) => e.from === 'B3' && e.to === 'A2'));
  const a = /** @type {any} */ (g.groups.get('A')), b = /** @type {any} */ (g.groups.get('B'));
  assert.ok(back.points.every((/** @type {any} */ p) => p.x >= a.x && p.x <= b.x + b.w), 'inside the two lanes');
  assert.equal(measure(g, facts).crossings, 0);
});

test('in a left-to-right diagram the lanes are rows and time runs right', () => {
  const g = readGeometry(laneLayout('RIGHT').laid);
  const frames = ['User', 'App', 'IdP'].map((id) => /** @type {any} */ (g.groups.get(id)));
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].y >= frames[i - 1].y + frames[i - 1].h, 'stacked, in order');
  assert.ok(frames.every((f) => f.x === frames[0].x && f.w === frames[0].w), 'one length');
  const x = (/** @type {string} */ id) => /** @type {any} */ (g.boxes.get(id)).x;
  assert.ok(x('U1') < x('S1') && x('S1') < x('S2') && x('S2') < x('U2'));
});

test('lanes that cannot be laid out are explained when the facts are resolved', () => {
  const explain = (/** @type {any} */ data) => resolveFacts(buildGraph(data), parseDirectives(SOURCE).annotations);
  const beside = layoutData(ARROWS, { groups: ['User', 'App', 'IdP', 'Inner'], parents: { ...PARENTS, I3: 'Inner' }, shapes: { I2: 'diamond' } });
  const besideFacts = explain(beside);
  assert.deepEqual(besideFacts.facts.lanes, []);
  assert.match(besideFacts.diagnostics[0].message, /other groups \(Inner\); lanes must be its only groups/);
  const inside = layoutData(ARROWS, { groups: ['User', 'App', 'IdP', 'Inner'], parents: { ...PARENTS, I3: 'Inner' }, shapes: { I2: 'diamond' } });
  inside.nodes.find((/** @type {any} */ n) => n.id === 'Inner').parentId = 'IdP';
  assert.match(explain(inside).diagnostics[0].message, /IdP contains groups/);
});
