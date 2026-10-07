// install(): which diagrams the `apply` option gives the semantic layout, with a stand-in for Mermaid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../src/index.js';

const SELECT = '%%{init: {"layout": "semantic"}}%%';

/** Records the text each render hands to Mermaid. */
function fakeMermaid() {
  /** @type {string[]} */
  const rendered = [];
  return {
    rendered,
    registerLayoutLoaders() {},
    detectType(/** @type {string} */ text) {
      if (/^\s*(flowchart|graph)\b/.test(text)) return 'flowchart-v2';
      if (/^\s*sequenceDiagram\b/.test(text)) return 'sequence';
      throw new Error('No diagram type detected');
    },
    async render(/** @type {string} */ _id, /** @type {string} */ text) {
      rendered.push(text);
      return { svg: '' };
    },
  };
}

const PLAIN = 'flowchart TD\n  A --> B';
const DECLARED = 'flowchart TD\n  A --> B\n  %% @main A B';
const SEQUENCE = 'sequenceDiagram\n  A->>B: hi';
const OWN_LAYOUT = '---\nconfig:\n  layout: elk\n---\nflowchart TD\n  A --> B\n  %% @main A B';

/** @param {object} options @param {string[]} sources */
async function selected(options, sources) {
  const mermaid = fakeMermaid();
  install(mermaid, options);
  for (const [i, source] of sources.entries()) await mermaid.render(`d${i}`, source);
  return mermaid.rendered.map((text) => text.includes(SELECT));
}

test('without apply, every diagram reaches Mermaid unchanged', async () => {
  assert.deepEqual(await selected({}, [PLAIN, DECLARED, SEQUENCE]), [false, false, false]);
});

test('apply: "flowcharts" selects the semantic layout for every flowchart', async () => {
  assert.deepEqual(await selected({ apply: 'flowcharts' }, [PLAIN, DECLARED, SEQUENCE, OWN_LAYOUT, 'not a diagram']), [true, true, false, false, false]);
});

test('apply: "directives" selects it for flowcharts that declare directives', async () => {
  assert.deepEqual(await selected({ apply: 'directives' }, [PLAIN, DECLARED, SEQUENCE, OWN_LAYOUT]), [false, true, false, false]);
});

test('the selection is appended to the last line, so every line keeps its number', async () => {
  const mermaid = fakeMermaid();
  install(mermaid, { apply: 'directives' });
  await mermaid.render('d', `${DECLARED}\n\n`);
  assert.equal(mermaid.rendered[0], `${DECLARED}${SELECT}\n`);
});

test('a misspelt directive selects the diagram, so its report can say what is wrong', async () => {
  assert.deepEqual(await selected({ apply: 'directives' }, ['flowchart TD\n  A --> B\n  %% @mian A B']), [true]);
});

test('an unknown apply value is an error', () => {
  assert.throws(() => install(fakeMermaid(), { apply: /** @type {any} */ ('all') }), /apply must be "flowcharts" or "directives"/);
});
