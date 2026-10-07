import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectives } from '../src/language/directives.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts, describeFacts } from '../src/facts/resolve.js';
import { layoutData } from './helpers.js';

const order = layoutData(['A-->B', 'B--yes-->C', 'C-->D', 'B--no-->X', 'G-->C', 'C-->G', 'R-.->B'], { shapes: { B: 'diamond', A: 'stadium' } });
const facts = (data, source = '') => resolveFacts(buildGraph(data), parseDirectives(source).annotations);

test('plain Mermaid: main path, decisions and side boxes come from structure', () => {
  const { facts: f, diagnostics } = facts(order);
  assert.deepEqual(diagnostics, []);
  assert.equal(f.mainSource, 'inferred');
  assert.deepEqual(f.mainPath, ['L_A_B_0', 'L_B_C_1', 'L_C_D_2']);
  assert.equal(f.nodeRoles.get('B'), 'decision');
  assert.equal(f.continuation.get('B'), 'L_B_C_1');
  assert.equal(f.edgeRoles.get('L_B_X_3'), 'branch');
  // A is a stadium, so it reads as the entry; D is an ordinary box at the end of an inferred path
  assert.equal(f.nodeRoles.get('A'), 'entry');
  assert.equal(f.nodeRoles.get('D'), undefined);
  // R has one dotted link to a step with other arrows
  assert.equal(f.sideBoxes.get('R'), 'inferred');
  assert.equal(f.loops.size, 0);
});

test('declared facts win over inference', () => {
  const { facts: f, diagnostics } = facts(order, '%% @main A B X\n%% @exit B -> C\n%% @retry G -> C\n%% @side R');
  assert.deepEqual(diagnostics, []);
  assert.equal(f.mainSource, 'declared');
  assert.deepEqual(f.mainPath, ['L_A_B_0', 'L_B_X_3']);
  assert.equal(f.edgeRoles.get('L_B_C_1'), 'exit');
  assert.deepEqual([...f.loops], ['L_G_C_4']);
  assert.equal(f.sideBoxes.get('R'), 'declared');
});

test('directives that do not match the diagram are errors that say how to fix them', () => {
  const data = layoutData(['A-->B']);
  data.nodes[0].label = 'Start';
  const { diagnostics } = facts(data, '%% @main A C\n%% @exit B -> A\n%% @retry start -> B');
  assert.deepEqual(diagnostics.map((d) => [d.line, d.message]), [
    [2, '@exit B -> A: the diagram has no such arrow; B has no outgoing arrows'],
    [3, '@retry: no node "start" (did you mean "A"?)'],
    [1, '@main: no node "C"; ids are A, B'],
  ]);
});

test('@main none turns off main-path inference', () => {
  const { facts: f } = facts(order, '%% @main none');
  assert.deepEqual(f.mainPath, []);
  assert.equal(f.mainSource, 'declared');
  assert.equal(f.continuation.size, 0);
});

test('a side box with several arrows is reported and laid out normally', () => {
  const { facts: f, diagnostics } = facts(order, '%% @side C');
  assert.equal(f.sideBoxes.has('C'), false);
  assert.match(diagnostics[0].message, /serves one step, but C has 4 arrows/);
});

test('describeFacts says what was declared and what was inferred', () => {
  const data = order;
  const { facts: f } = facts(data, '%% @exit B -> X');
  const lines = describeFacts(buildGraph(data), f);
  assert.deepEqual(lines, [
    'main path (inferred): A -> B -> C -> D',
    'exits (declared): B -> X',
    'side boxes: R (inferred)',
  ]);
});
