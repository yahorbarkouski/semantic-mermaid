// The check runs Mermaid's parser in Node, with no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkDiagram } from '../toolchain/check.js';

const ORDER = fs.readFileSync(new URL('./fixtures/order.mmd', import.meta.url), 'utf8');

test('a correct diagram checks clean and says what the engine understood', async () => {
  const report = await checkDiagram(ORDER);
  assert.deepEqual(report?.diagnostics, []);
  assert.equal(report?.directives, 4);
  assert.ok(report?.understood.includes('main path (declared): A -> B -> C -> D -> E -> F'));
  assert.equal(report?.layout, null);
});

test('a wrong directive is an error that names the fix', async () => {
  const report = await checkDiagram(ORDER.replace('%% @exit B -> X', '%% @exit B -> Y'));
  assert.deepEqual(report?.diagnostics.map((d) => d.message), ['@exit: no node "Y"; ids are A, B, C, D, E, F, G, X, R']);
});

test('a layout chosen in the configuration is a warning, because it switches the directives off', async () => {
  const report = await checkDiagram(`---\nconfig:\n  layout: elk\n---\n${ORDER}`);
  assert.equal(report?.diagnostics[0].severity, 'warning');
  assert.equal(report?.diagnostics[0].line, 3);
  assert.match(report?.diagnostics[0].message ?? '', /sets layout: elk, so the semantic layout does not run/);
});

test('diagrams other than flowcharts have nothing to check', async () => {
  assert.equal(await checkDiagram('sequenceDiagram\n  A->>B: hi'), null);
});

test('a parse error surfaces as Mermaid reports it', async () => {
  await assert.rejects(checkDiagram('flowchart TD\n  A --> B((\n'), /Parse error/);
});
