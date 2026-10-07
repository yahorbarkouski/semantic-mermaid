// Integration: Mermaid, the vendored ELK plugin and the engine in a real browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRenderer } from '../toolchain/render.js';

/** @type {Awaited<ReturnType<typeof createRenderer>>} */
let renderer;
before(async () => { renderer = await createRenderer(); });
after(async () => { await renderer.close(); });

const ORDER = fs.readFileSync(new URL('./fixtures/order.mmd', import.meta.url), 'utf8');

test('Semantic Mermaid renders and reports what it understood', async () => {
  const { svg, report } = await renderer.render(ORDER);
  assert.match(svg, /<svg/);
  assert.ok(report);
  assert.equal(report.directives, 4);
  assert.deepEqual(report.diagnostics.filter((d) => d.severity === 'error'), []);
  assert.ok(report.understood.includes('main path (declared): A -> B -> C -> D -> E -> F'));
  assert.ok(report.layout && report.layout.tried.some((t) => t.name === 'elk'));
  // the declared exit is beside its decision: same row, not below it
  const box = (id) => {
    const m = svg.match(new RegExp(`id="diagram-\\d+-flowchart-${id}-\\d+"[^>]*transform="translate\\(([-\\d.]+), ?([-\\d.]+)\\)"`));
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const decision = box('B'), exit = box('X');
  assert.ok(decision && exit);
  assert.ok(Math.abs(decision.y - exit.y) < 30, `exit at y=${exit.y}, decision at y=${decision.y}`);
});

test('plain Mermaid renders unchanged in meaning, and directives are invisible to Mermaid itself', async () => {
  const plain = ORDER.split('\n').filter((l) => !l.includes('%% @')).join('\n');
  const semantic = await renderer.render(plain);
  assert.equal(semantic.report?.directives, 0);
  assert.ok(semantic.report?.understood[0].startsWith('main path (inferred)'));
  // Mermaid's own ELK layout accepts the annotated source as is
  const elk = await renderer.render(ORDER, { layout: 'elk' });
  assert.match(elk.svg, /<svg/);
});

test('the SVG is well-formed XML, line breaks in labels included, so it shows as an image', async () => {
  const { svg } = await renderer.render('flowchart TD\n  A[first<br/>second] --> B');
  assert.doesNotMatch(svg, /<br>/);
  assert.match(svg, /<br [^>]*\/>|<br\/>/);
});

test('the same source always renders to the same SVG', async () => {
  const first = await renderer.render(ORDER);
  const second = await renderer.render(ORDER);
  // diagram ids count renders; everything else must match byte for byte
  const plain = (/** @type {string} */ svg) => svg.replace(/diagram-\d+/g, 'diagram');
  assert.equal(plain(second.svg), plain(first.svg));
});

test('a parse error surfaces as Mermaid reports it', async () => {
  await assert.rejects(renderer.render('flowchart TD\n  A --> B((\n'), /Parse error/);
});

test('automatic colours follow roles and leave author styles alone', async () => {
  const { svg } = await renderer.render(`${ORDER}\n  style C fill:#ffcc00`);
  assert.match(svg, /fill:#FDF2F2/); // the declared exit
  assert.match(svg, /fill:#ffcc00/); // the author's own style survives
  const off = await renderer.render(ORDER, { colors: false });
  assert.doesNotMatch(off.svg, /fill:#FDF2F2/);
});

test('the ELK baseline is drawn by ELK, and other diagram types keep Mermaid\'s own layout', async () => {
  const elk = await renderer.render(ORDER, { layout: 'elk' });
  const semantic = await renderer.render(ORDER);
  assert.notEqual(elk.svg, semantic.svg);
  assert.equal(elk.report, null);
  const mindmap = await renderer.render('mindmap\n  root((Root))\n    A\n    B');
  assert.match(mindmap.svg, /<svg/);
});

test('state and class diagrams render, and the engine leaves them alone', async () => {
  for (const source of ['stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: job\n  Busy --> [*]', 'classDiagram\n  Animal <|-- Dog\n  Dog : +bark()']) {
    const { svg, report } = await renderer.render(source);
    assert.match(svg, /<svg/);
    assert.equal(report ?? null, null); // the engine did not run
  }
});

test('a declared side group sits beside the step it feeds', async () => {
  const { svg, report } = await renderer.render(fs.readFileSync(new URL('./fixtures/documents.mmd', import.meta.url), 'utf8'));
  assert.ok(report?.understood.includes('side group: Reference feeds Extract (declared)'));
  const group = svg.match(/class="cluster[^"]*" id="diagram-\d+-Reference"[^>]*><rect[^>]*x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  const step = svg.match(/id="diagram-\d+-flowchart-Extract-\d+"[^>]*transform="translate\(([-\d.]+), ?([-\d.]+)\)"/);
  assert.ok(group && step);
  const [gy, gh] = [Number(group[2]), Number(group[4])], sy = Number(step[2]);
  assert.ok(sy > gy && sy < gy + gh, `step centre ${sy} within the group's rows ${gy}..${gy + gh}`);
});

test('declared lanes are drawn as lanes of one length, which plain ELK cannot do', async () => {
  const source = fs.readFileSync(new URL('./fixtures/signin.mmd', import.meta.url), 'utf8');
  const { svg, report } = await renderer.render(source);
  assert.match(report?.layout?.chosen ?? '', /^lanes/);
  const frames = ['UA', 'SP', 'IdP'].map((id) => {
    const m = svg.match(new RegExp(`class="cluster[^"]*" id="diagram-\\d+-${id}"[^>]*><rect[^>]*x="([-\\d.]+)" y="([-\\d.]+)" width="([-\\d.]+)" height="([-\\d.]+)"`));
    assert.ok(m, `lane ${id} drawn`);
    return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
  });
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].x >= frames[i - 1].x + frames[i - 1].w, 'side by side, in declared order');
  assert.ok(frames.every((f) => Math.abs(f.y - frames[0].y) < 0.5 && Math.abs(f.h - frames[0].h) < 0.5), 'one length');
});
