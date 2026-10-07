import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectives } from '../src/language/directives.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts } from '../src/facts/resolve.js';
import { applyFeatures } from '../src/engine/elk-graph.js';
import { splitSideGroups } from '../src/engine/side-groups.js';
import { absoluteFrames } from '../src/engine/elk-graph.js';
import { layoutData, elkGraph } from './helpers.js';

const references = (extra = {}) => layoutData(['S-->X', 'R1-->X', 'R2-->X', 'X-->Y'], { groups: ['Refs'], parents: { R1: 'Refs', R2: 'Refs' }, ...extra });
const resolve = (data, source = '') => resolveFacts(buildGraph(data), parseDirectives(source).annotations);

test('a set of references feeding one step is a side group, even in plain Mermaid', () => {
  const { facts } = resolve(references());
  assert.deepEqual(facts.sideGroups.get('Refs'), { step: 'X', members: ['R1', 'R2'], links: ['L_R1_X_1', 'L_R2_X_2'], toward: 'in', source: 'inferred' });
  assert.deepEqual(facts.mainPath, ['L_S_X_0', 'L_X_Y_3']);
});

test('a group with its own flow is a side group only when declared', () => {
  const chain = layoutData(['S-->X', 'Z-->R', 'R-->X', 'X-->Y'], { groups: ['Refs'], parents: { Z: 'Refs', R: 'Refs' } });
  assert.equal(resolve(chain).facts.sideGroups.size, 0);
  assert.equal(resolve(chain, '%% @side Refs').facts.sideGroups.get('Refs')?.source, 'declared');
});

test('listing every box of a group declares the group', () => {
  assert.equal(resolve(references(), '%% @side R1 R2').facts.sideGroups.get('Refs')?.source, 'declared');
});

test('a group that serves two steps, or a step in another group, is explained', () => {
  const two = layoutData(['S-->X', 'R1-->X', 'R2-->Y', 'X-->Y'], { groups: ['Refs'], parents: { R1: 'Refs', R2: 'Refs' } });
  assert.match(resolve(two, '%% @side Refs').diagnostics[0].message, /reach 2 different boxes/);
  const nested = references({ groups: ['Refs', 'Core'], parents: { R1: 'Refs', R2: 'Refs', X: 'Core' } });
  assert.match(resolve(nested, '%% @side Refs').diagnostics[0].message, /X is inside another group/);
  const single = references();
  assert.match(resolve(single, '%% @side R1').diagnostics[0].message, /declare @side Refs/);
});

test('the step and its group merge into one wide box with ports, and split back beside each other', () => {
  const data = references();
  const { facts } = resolve(data);
  const elk = elkGraph(data);
  const inner = new Map([['Refs', { width: 120, height: 130, positions: new Map([['R1', { x: 20, y: 30 }], ['R2', { x: 20, y: 80 }]]), edges: new Map() }]]);
  const features = { spine: true, loops: true, sideBoxes: true, sideGroups: true, ports: true, merge: false, peerOrder: false, direction: null };
  const applied = applyFeatures(elk, buildGraph(data), facts, features, inner);
  const wide = elk.children.find((c) => c.id.includes('__beside_'));
  assert.ok(wide, 'wide box created');
  assert.equal(wide.width, 120 + 56 + 80);
  assert.ok(!elk.children.some((c) => c.id === 'X' || c.id === 'Refs'));
  assert.ok(elk.edges.every((e) => !e.id.startsWith('L_R')), 'links set aside');
  // pretend ELK placed the wide box at (100, 200), and give the other edges straight sections
  wide.x = 100; wide.y = 200;
  for (const e of elk.edges) e.sections = [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 1 } }];
  for (const e of elk.edges) { e.sources = e.sources.map((s) => applied.portOwner.get(s) ?? s); e.targets = e.targets.map((t) => applied.portOwner.get(t) ?? t); }
  splitSideGroups(elk, applied.merges, absoluteFrames);
  const x = elk.children.find((c) => c.id === 'X'), refs = elk.children.find((c) => c.id === 'Refs');
  assert.ok(refs.x + refs.width < x.x, 'group left of the step');
  assert.ok(refs.y < x.y + x.height && x.y < refs.y + refs.height, 'on the same row');
  const link = elk.edges.find((e) => e.id === 'L_R1_X_1');
  assert.ok(link.sections[0].endPoint.x === x.x, 'link ends on the step\'s near side');
});
