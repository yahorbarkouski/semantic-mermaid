// The diagram's text travels inside the SVG that render writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSource, sourceOf } from '../toolchain/source.js';

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
