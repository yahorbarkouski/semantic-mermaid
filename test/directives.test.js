import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectives } from '../src/language/directives.js';

test('reads every directive with its line', () => {
  const { annotations, diagnostics, count } = parseDirectives([
    'flowchart TD',
    '  A --> B',
    '  %% @main A B C',
    '  %% @exit B -> X, C --> Y',
    '  %%@retry G -> D',
    '  %% @side Config Logs',
    '  %% @peers P0, P1, P2',
    '  %% @colors off',
  ].join('\n'));
  assert.deepEqual(diagnostics, []);
  assert.equal(count, 6);
  assert.deepEqual(annotations.main, { ids: ['A', 'B', 'C'], line: 3 });
  assert.deepEqual(annotations.exits, [{ from: 'B', to: 'X', line: 4 }, { from: 'C', to: 'Y', line: 4 }]);
  assert.deepEqual(annotations.retries, [{ from: 'G', to: 'D', line: 5 }]);
  assert.deepEqual(annotations.sides, [{ ids: ['Config', 'Logs'], line: 6 }]);
  assert.deepEqual(annotations.peers, [{ ids: ['P0', 'P1', 'P2'], line: 7 }]);
  assert.equal(annotations.colors, false);
});

test('a main path may be written with arrows', () => {
  assert.deepEqual(parseDirectives('%% @main A -> B -> C').annotations.main?.ids, ['A', 'B', 'C']);
});

test('@main none declares that there is no main path', () => {
  const { annotations, diagnostics } = parseDirectives('%% @main none');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(annotations.main, { ids: [], line: 1 });
});

test('ordinary comments and init directives are not directives', () => {
  const { count, diagnostics } = parseDirectives('%% a note about @main\n%%{init: {"theme": "dark"}}%%\nflowchart TD');
  assert.equal(count, 0);
  assert.deepEqual(diagnostics, []);
});

test('reports unknown and malformed directives', () => {
  const { diagnostics, annotations } = parseDirectives([
    '%% @mian A B',
    '%% @exit B X',
    '%% @main A',
    '%% @colors maybe',
    '%% @main A B',
    '%% @main B C',
  ].join('\n'));
  assert.equal(annotations.main?.line, 5);
  assert.deepEqual(diagnostics.map((d) => [d.severity, d.line]), [['error', 1], ['error', 2], ['error', 3], ['error', 4], ['error', 6]]);
  assert.match(diagnostics[0].message, /unknown directive @mian; did you mean @main?/);
  assert.match(diagnostics[1].message, /"From -> To"/);
});

test('no source means no annotations', () => {
  const { annotations, count } = parseDirectives(undefined);
  assert.equal(count, 0);
  assert.equal(annotations.main, null);
  assert.equal(annotations.colors, true);
});

test('Windows line endings read like Unix ones', () => {
  const { annotations, count } = parseDirectives('flowchart TD\r\n  A --> B\r\n  %% @main A B\r\n  %% @exit B -> C\r\n');
  assert.equal(count, 2);
  assert.deepEqual(annotations.main?.ids, ['A', 'B']);
});
