import { test } from 'node:test';
import assert from 'node:assert/strict';
import ELK from 'elkjs/lib/elk.bundled.js';
import { buildGraph } from '../src/model/graph.js';
import { parseDirectives } from '../src/language/directives.js';
import { resolveFacts } from '../src/facts/resolve.js';
import { applyFeatures, undoFeatures } from '../src/engine/elk-graph.js';
import { readGeometry } from '../src/engine/geometry.js';
import { layoutData, elkGraph } from './helpers.js';

const features = { spine: true, loops: true, sideBoxes: true, sideGroups: false, ports: true, merge: false, peerOrder: true, direction: null };

// Run the actual ELK transformation and its inverse. Endpoint checks catch wrong frames and
// reversed restored references even when an SVG still renders and all its numbers are finite.
for (const nested of [false, true]) for (const direction of ['DOWN', 'RIGHT', 'UP', 'LEFT']) {
  test(`side-box reservation restores directed routes in ${direction}, nested=${nested}`, async () => {
    const data = layoutData(
      ['A-->B', 'B--yes-->C', 'C-->D', 'B--no-->E', 'E-->B', 'B--reject-->X', 'R-.->B', 'S-.->B'],
      { shapes: { B: 'diamond' }, groups: nested ? ['Outer', 'Inner'] : [], parents: nested ? { B: 'Inner', X: 'Inner', R: 'Inner', S: 'Inner', C: 'Outer', E: 'Outer' } : {} },
    );
    if (nested) data.nodes.find((n) => n.id === 'Inner').parentId = 'Outer';
    const graph = buildGraph(data);
    const { facts } = resolveFacts(graph, parseDirectives('%% @main A B C D\n%% @exit B -> X\n%% @retry E -> B\n%% @side R S').annotations);
    const root = elkGraph(data);
    root.layoutOptions = { 'elk.direction': direction, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' };
    const applied = applyFeatures(root, graph, facts, features);
    assert.equal(applied.sideBoxes.length, 1);
    assert.deepEqual(applied.sideBoxes[0].boxes.map((b) => b.node.id), ['R', 'S']);
    const laid = undoFeatures(await new ELK().layout(root), applied);
    const g = readGeometry(laid);
    assert.equal(g.edges.length, 8);
    assert.equal(g.boxes.size, 8);
    const near = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));
    for (const edge of g.edges) {
      assert.ok(near(edge.points[0], g.boxes.get(edge.from)) < 0.01, `${edge.from}->${edge.to}: start misses source`);
      assert.ok(near(edge.points.at(-1), g.boxes.get(edge.to)) < 0.01, `${edge.from}->${edge.to}: end misses target`);
      assert.ok(edge.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
    for (const id of ['R', 'S']) assert.ok(g.edges.some((e) => e.from === id && e.to === 'B'), `${id}: reference direction changed`);
    const leaves = [...g.boxes.values()];
    for (let i = 0; i < leaves.length; i++) for (const b of leaves.slice(i + 1)) {
      const a = leaves[i];
      assert.ok(Math.min(a.x + a.w, b.x + b.w) <= Math.max(a.x, b.x) || Math.min(a.y + a.h, b.y + b.h) <= Math.max(a.y, b.y), 'reserved nodes overlap');
    }
    assert.ok(laid.edges.every((e) => [...e.sources, ...e.targets].every((id) => !id.includes('__port_'))), 'temporary port endpoints escaped');
  });
}

test('both ends of a connection can belong to separate reserved decisions', async () => {
  const data = layoutData(['A-->B', 'B-->C', 'C-->D', 'B-->E', 'E-->B', 'B-->X', 'R-.->B', 'C-->F', 'F-->C', 'C-->Y', 'S-.->C'], { shapes: { B: 'diamond', C: 'diamond' } });
  const graph = buildGraph(data);
  const { facts } = resolveFacts(graph, parseDirectives('%% @main A B C D\n%% @exit B -> X\n%% @exit C -> Y\n%% @retry E -> B\n%% @retry F -> C\n%% @side R S').annotations);
  const root = elkGraph(data);
  const applied = applyFeatures(root, graph, facts, features);
  assert.equal(applied.sideBoxes.length, 2);
  const g = readGeometry(undoFeatures(await new ELK().layout(root), applied));
  assert.equal(g.edges.length, 11);
  assert.equal(g.boxes.size, 10);
  const edge = g.edges.find((e) => e.from === 'B' && e.to === 'C');
  const b = g.boxes.get('B'), c = g.boxes.get('C');
  assert.deepEqual(edge.points[0], { x: b.x + b.w / 2, y: b.y + b.h });
  assert.deepEqual(edge.points.at(-1), { x: c.x + c.w / 2, y: c.y });
});
