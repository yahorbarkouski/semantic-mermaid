// Automatic colours: a light palette for Mermaid's light themes, a dark one for its dark themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAppearance, PALETTE, DARK_PALETTE } from '../src/style/appearance.js';
import { buildGraph } from '../src/model/graph.js';
import { resolveFacts } from '../src/facts/resolve.js';
import { parseDirectives } from '../src/language/directives.js';
import { layoutData } from './helpers.js';

/**
 * The fill the engine gives a plain step under this configuration, or null when it leaves colours alone.
 * @param {object} config Mermaid's configuration as the layout receives it
 */
function stepFill(config) {
  const data = { ...layoutData(['A-->B', 'B-->C']), config };
  const graph = buildGraph(data);
  const { facts } = resolveFacts(graph, parseDirectives('').annotations);
  if (!applyAppearance(data, graph, facts)) return null;
  const step = data.nodes.find((/** @type {any} */ n) => n.id === 'B');
  return step.cssStyles.find((/** @type {string} */ s) => s.startsWith('fill:')).slice(5);
}

test('light themes, including Mermaid 12\'s default, get the light palette', () => {
  for (const theme of ['redux-color', 'redux', 'neo', 'default', 'neutral', 'base']) assert.equal(stepFill({ theme }), PALETTE.step.fill, theme);
  assert.equal(stepFill({}), PALETTE.step.fill);
});

test('dark themes, and any theme whose variables set darkMode, get the dark palette', () => {
  for (const theme of ['redux-dark-color', 'redux-dark', 'neo-dark', 'dark']) assert.equal(stepFill({ theme }), DARK_PALETTE.step.fill, theme);
  assert.equal(stepFill({ theme: 'base', themeVariables: { darkMode: true } }), DARK_PALETTE.step.fill);
});

test('a theme with colours of its own keeps them', () => {
  assert.equal(stepFill({ theme: 'forest' }), null);
});
