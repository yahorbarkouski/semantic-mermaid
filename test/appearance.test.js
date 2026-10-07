// Automatic colours apply with Mermaid's light themes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAppearance } from '../src/style/appearance.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts } from '../src/facts/resolve.js';
import { parseDirectives } from '../src/language/directives.js';
import { layoutData } from './helpers.js';

/** @param {object} config Mermaid's configuration as the layout receives it */
function colored(config) {
  const data = { ...layoutData(['A-->B', 'B-->C']), config };
  const graph = buildGraph(data);
  const { facts } = resolveFacts(graph, parseDirectives('').annotations);
  return applyAppearance(data, graph, facts);
}

test('colours apply with the light themes, including Mermaid 12\'s default', () => {
  for (const theme of ['redux-color', 'redux', 'neo', 'default', 'neutral', 'base']) assert.equal(colored({ theme }), true, theme);
});

test('colours stay off with dark themes and whenever the theme variables set darkMode', () => {
  for (const theme of ['dark', 'neo-dark', 'redux-dark', 'redux-dark-color', 'forest']) assert.equal(colored({ theme }), false, theme);
  assert.equal(colored({ theme: 'base', themeVariables: { darkMode: true } }), false);
});
