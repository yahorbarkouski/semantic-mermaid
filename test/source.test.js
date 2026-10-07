// The diagram's text travels inside the SVG that render writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSource, sourceOf, compactPaths } from '../toolchain/source.js';

test('the text inside an SVG comes back unchanged, characters XML treats specially included', () => {
  const source = 'flowchart TD\n  A["a < b & c"] --> B\n  B -.->|"-->"| C\n  %% @main A B\n';
  const svg = withSource('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g></g></svg>', source);
  assert.match(svg, /^<svg [^>]*><metadata id="semantic-mermaid-source">/);
  assert.doesNotMatch(svg, /a < b/);
  assert.equal(sourceOf(svg), source);
});

test('an SVG not written by render has no text inside', () => {
  assert.equal(sourceOf('<svg></svg>'), null);
});

test('path data is rounded to hundredths, and numbers elsewhere, such as in labels, are left alone', () => {
  const svg = '<svg><path d="M-62 -24 C-37.1994425471872 -24, 3.18278 0, 62.5 -24"/><text>pi is 3.14159</text></svg>';
  assert.equal(compactPaths(svg), '<svg><path d="M-62 -24 C-37.2 -24, 3.18 0, 62.5 -24"/><text>pi is 3.14159</text></svg>');
});
