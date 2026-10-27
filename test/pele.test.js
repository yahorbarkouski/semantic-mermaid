import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { render, check } from '../src/pele/index.js';
import { render as native } from 'pele';
import { register, render as coreRender } from 'pele/core';
import { prepare } from '../vendor/pele/runtime.js';
import { toElk, toPele } from '../src/pele/geometry.js';

const ORDER = fs.readFileSync(new URL('./fixtures/order.mmd', import.meta.url), 'utf8');
const fixture = (name) => fs.readFileSync(new URL(`../examples/${name}.mmd`, import.meta.url), 'utf8');
const center = (svg, id) => {
  const node = [...svg.matchAll(/<g class="pele-node [^"]*" data-id="([^"]*)" transform="translate\(([-\d.]+),([-\d.]+)\)"/g)].find((m) => m[1] === id);
  assert.ok(node, `${id} has a rendered node`);
  return { x: Number(node[2]), y: Number(node[3]) };
};
const group = (svg, id) => {
  const frame = [...svg.matchAll(/<g class="pele-cluster[^"]*" data-id="([^"]*)"><rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)].find((m) => m[1] === id);
  assert.ok(frame, `${id} has a rendered group`);
  return { x: Number(frame[2]), y: Number(frame[3]), w: Number(frame[4]), h: Number(frame[5]) };
};

test('Pele SVG runs in Node without DOM and applies main, exit, retry and side semantics', async () => {
  assert.equal(typeof document, 'undefined');
  const out = await render(ORDER);
  assert.equal(out.type, 'flowchart');
  assert.equal(out.report.directives, 4);
  assert.deepEqual(out.report.diagnostics, []);
  assert.equal(out.report.layout.chosen, 'semantic');
  assert.equal(center(out.svg, 'B').y, center(out.svg, 'X').y);
  assert.equal(center(out.svg, 'B').y, center(out.svg, 'R').y);
  const spine = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => center(out.svg, id));
  assert.ok(spine.every((p) => p.x === spine[0].x));
  assert.ok(spine.slice(1).every((p, i) => p.y > spine[i].y));
  assert.match(out.svg, /var\(--semantic-retry/);
  assert.match(out.svg, /var\(--semantic-exit/);
  assert.match(out.svg, /stroke-dasharray:4 3/);
  assert.notEqual(out.svg, native(ORDER).svg);
});

test('Pele draws actual equal-length lanes, peer order, and side groups', async () => {
  const lanes = await render(fixture('sign-in'));
  assert.match(lanes.report.layout.chosen, /^lanes/);
  const frames = ['UA', 'SP', 'IdP'].map((id) => group(lanes.svg, id));
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].x > frames[i - 1].x + frames[i - 1].w);
    assert.equal(frames[i].y, frames[0].y);
    assert.equal(frames[i].h, frames[0].h);
  }
  const peers = await render('flowchart TD\n Root --> P\n Root --> Q\n Root --> R\n %% @main none\n %% @peers R Q P');
  assert.ok(center(peers.svg, 'R').x < center(peers.svg, 'Q').x);
  assert.ok(center(peers.svg, 'Q').x < center(peers.svg, 'P').x);
  const side = await render(fixture('incident'));
  const references = group(side.svg, 'Playbooks');
  const step = center(side.svg, 'Mitigate');
  assert.ok(step.y >= references.y && step.y <= references.y + references.h);
});

test('all annotated examples render with complete reports and finite SVG geometry', async () => {
  const names = fs.readdirSync(new URL('../examples/', import.meta.url)).filter((f) => f.endsWith('.mmd'));
  for (const name of names) {
    const out = await render(fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'), { maxWidth: 800 });
    assert.ok(out.width > 0 && out.height > 0, name);
    assert.doesNotMatch(out.svg, /NaN|Infinity|undefined/, name);
    assert.deepEqual(out.report.diagnostics.filter((d) => d.severity === 'error'), [], name);
    assert.ok(out.report.layout.tried.length >= 3, name);
  }
});

test('native pass-through is byte-identical for non-flowcharts, explicit layouts and unselected flowcharts', async () => {
  const cases = [
    ['sequenceDiagram\n A->>B: hi', {}],
    ['classDiagram\n Animal <|-- Dog', {}],
    ['pie\n "A" : 3\n "B" : 2', {}],
    ['flowchart LR\n A --> B', { apply: 'directives', maxWidth: 200 }],
    [`---\nconfig:\n  layout: elk\n---\n${ORDER}`, {}],
  ];
  for (const [source, options] of cases) {
    const out = await render(source, options);
    assert.equal(out.svg, native(source, options).svg);
    assert.equal(out.report, null);
  }
});

test('author styles and default classes win; role CSS follows Pele theme tokens', async () => {
  const out = await render(`${ORDER}\n style C fill:#ffcc00\n linkStyle 0 stroke:#00ff00\n classDef default fill:#abc123`);
  assert.match(out.svg, /fill:#ffcc00/);
  assert.match(out.svg, /fill:#abc123/);
  assert.match(out.svg, /stroke:#00ff00/);
  assert.match(out.svg, /--pele-fg/);
  const off = await render(`${ORDER}\n %% @colors off`);
  assert.equal(off.report.colored, false);
  assert.doesNotMatch(off.svg, /--semantic-/);
  const disabled = await render(ORDER, { colors: false });
  assert.equal(disabled.report.colored, false);
  assert.doesNotMatch(disabled.svg, /--semantic-/);
});

test('Pele parsing, configuration, accessibility, links and escaped labels survive the bridge', async () => {
  const source = `---\ntitle: Shopping\nconfig:\n  flowchart:\n    wrappingWidth: 130\n---\nflowchart TD\n accTitle: Order flow\n accDescr: Accessible description\n A["A & B <script>alert(1)</script>"] --> B[Done]\n click A "https://example.com/order" "Order"\n %% @main A B`;
  const out = await render(source, { idPrefix: 'order-test' });
  assert.match(out.svg, /Shopping/);
  assert.match(out.svg, /id="order-test-title"/);
  assert.match(out.svg, /Accessible description/);
  assert.doesNotMatch(out.svg, /<script/);
  assert.deepEqual(out.links, [{ id: 'A', href: 'https://example.com/order', internal: false }]);
  assert.match(out.svg, /href="https:\/\/example.com\/order"/);
  const noLinks = await render(source, { links: false });
  assert.doesNotMatch(noLinks.svg, /href=/);
  assert.deepEqual(noLinks.links, []);
  const init = await render('%%{init: {"flowchart":{"nodeSpacing":100}}}%%\nflowchart TD\n A --> B & C');
  assert.ok(Math.abs(center(init.svg, 'B').x - center(init.svg, 'C').x) >= 100);
});

test('Pele safety limits, malformed input and semantic diagnostics survive intact', async () => {
  await assert.rejects(render('flowchart TD\n A --> B((\n'), (e) => e.code === 'syntax');
  await assert.rejects(render(ORDER, { limit: 10 }), (e) => e.code === 'limit');
  await assert.rejects(render(ORDER, { maxEdges: 1 }), (e) => e.code === 'limit');
  await assert.rejects(render(ORDER, { outputLimit: 20 }), (e) => e.code === 'limit');
  await assert.rejects(render('nonsense'), (e) => e.code === 'unsupported-diagram');
  await assert.rejects(render(ORDER, { maxWidth: Infinity }), /positive finite/);
  await assert.rejects(render(ORDER, { apply: 'wrong' }), /apply must/);
  const unsafe = await render('flowchart TD\n A[Safe] --> B\n click A "javascript:alert(1)"');
  assert.doesNotMatch(unsafe.svg, /href="javascript:/i);
  const report = await check(ORDER.replace('%% @exit B -> X', '%% @exit B -> Missing'));
  assert.equal(report.layout, null);
  assert.equal(report.colored, false);
  assert.ok(report.diagnostics.some((d) => d.severity === 'error' && d.line === 11 && d.message.includes('Missing')));
});

test('concurrent jobs keep source, font sizes, style and reports isolated and deterministic', async () => {
  const sources = Array.from({ length: 16 }, (_, i) => `flowchart TD\n A${i}[Start ${i}] --> B${i}{Ready?}\n B${i} --> C${i}[Done]\n B${i} --> X${i}[Stop]\n %% @main A${i} B${i} C${i}\n %% @exit B${i} -> X${i}`);
  const first = await Promise.all(sources.map((s, i) => render(s, { fontSize: 12 + i, colors: i % 2 === 0 })));
  const second = await Promise.all(sources.map((s, i) => render(s, { fontSize: 12 + i, colors: i % 2 === 0 })));
  first.forEach((out, i) => {
    assert.equal(out.svg, second[i].svg);
    assert.equal(out.report.colored, i % 2 === 0);
    assert.ok(out.report.understood.includes(`main path (declared): A${i} -> B${i} -> C${i}`));
    assert.equal(center(out.svg, `B${i}`).y, center(out.svg, `X${i}`).y);
  });
});

test('the private bridge never replaces the host pele/core registry', async () => {
  const marker = { svg: '<svg>host-custom</svg>', width: 1, height: 1, links: [] };
  register({ type: 'flowchart', parse: () => ({}), render: () => marker });
  await render(ORDER);
  assert.equal(coreRender('flowchart TD\n A --> B').svg, marker.svg);
});

test('parallel, opposite, invisible and repeated-ID edges and labeled self-loops remain distinct', async () => {
  const source = 'flowchart TD\n A e@-->|first| B\n A e@-->|second| B\n B -->|return| A\n A -->|again| A\n A ~~~ C\n C -.-> B\n %% @main A B';
  const out = await render(source);
  assert.equal((out.svg.match(/class="pele-edge(?: |")/g) ?? []).length, 5);
  assert.match(out.svg, />first</);
  assert.match(out.svg, />second</);
  assert.match(out.svg, />again</);
  assert.doesNotMatch(out.svg, /NaN|Infinity/);
});

test('direction and page fitting use the shared semantic engine', async () => {
  for (const dir of ['TD', 'TB', 'BT', 'LR', 'RL']) {
    const out = await render(`flowchart ${dir}\n A[Start] --> B{Question?}\n B --> C[Done]\n %% @main A B C`);
    assert.ok(out.report.layout);
    assert.doesNotMatch(out.svg, /NaN|Infinity/);
  }
  const fitted = await render(fixture('gateway'), { maxWidth: 800 });
  const free = await render(fixture('gateway'));
  assert.match(fitted.report.layout.chosen, /@down$/);
  assert.doesNotMatch(free.report.layout.chosen, /@down$/);
  const fixed = await render(fixture('gateway'), { maxWidth: 100, autoDirection: false });
  assert.ok(fixed.report.layout.tried.every((c) => !c.name.includes('@')));
});

test('the bridge fails clearly if a callback changes dimensions between passes', () => {
  let calls = 0;
  const job = prepare('flowchart TD\n A[hello] --> B', { measurer: { width: (text) => text.length * ++calls } }, () => {});
  assert.throws(() => job.finish(() => ({ width: 100, height: 100 })), /measurements changed/);
});

test('geometry transfer rejects missing and nonfinite frames and routes', () => {
  const job = prepare('flowchart TD\n A --> B', {}, () => {});
  const input = toElk(job.graph, job.measured);
  assert.ok(input.children.every((n) => n.width > 0 && n.height > 0));
  assert.throws(() => toPele({ children: [] }, job.graph), /finite frame/);
  const children = job.graph.nodes.map((n) => ({ id: n.id, x: 0, y: 0, width: 80, height: 40 }));
  assert.throws(() => toPele({ children, edges: [] }, job.graph), /finite route/);
});

test('merged Pele configuration honors inline YAML and options layout opt-outs', async () => {
  for (const [source, options] of [
    [`---\nconfig: {layout: elk}\n---\n${ORDER}`, {}],
    [ORDER, { config: { layout: 'elk' } }],
  ]) {
    const out = await render(source, options);
    assert.equal(out.svg, native(source, options).svg);
    assert.equal(out.report, null);
    assert.ok((await check(source, options)).diagnostics.some((d) => d.severity === 'warning' && /sets layout: elk/.test(d.message)));
  }
});

test('long arrows preserve rank spacing in both directions and turned candidates', async () => {
  for (const dir of ['TD', 'LR']) {
    const draws = [];
    for (const arrow of ['-->', '---->', '-------->']) {
      const out = await render(`flowchart ${dir}\n A ${arrow} B\n %% @main A B`, { autoDirection: false });
      const a = center(out.svg, 'A'), b = center(out.svg, 'B');
      draws.push(Math.hypot(b.x - a.x, b.y - a.y));
      assert.doesNotMatch(out.svg, /__semantic_rank_/);
    }
    assert.ok(draws[1] > draws[0] && draws[2] > draws[1], `${dir}: ${draws}`);
  }
});

test('clickable is a Pele behavior class and does not suppress semantic role styles', async () => {
  const out = await render('flowchart TD\n A[Start] --> B{Ready?}\n B --> C[Done]\n click B "https://example.com"\n %% @main A B C');
  const node = out.svg.match(/<g class="pele-node [^"]*" data-id="B"[\s\S]*?<\/g>/)[0];
  assert.match(node, /stroke:var\(--semantic-main/);
  assert.match(node, /href="https:\/\/example.com\/"/);
});

test('Pele check reports ignored directives for other diagram types', async () => {
  const report = await check('sequenceDiagram\n A->>B: hi\n %% @main A B');
  assert.equal(report.layout, null);
  assert.ok(report.diagnostics.some((d) => d.severity === 'warning' && /flowcharts only/.test(d.message)));
});

test('init configuration overrides frontmatter without stale layout warnings', async () => {
  const source = `---\nconfig:\n  layout: elk\n---\n%%{init: {"layout":"semantic"}}%%\n${ORDER}`;
  const out = await render(source);
  assert.ok(out.report.layout);
  assert.deepEqual(out.report.diagnostics, []);
});

test('collapsed groups resolve facts against visible nodes and reconnect crossing arrows', async () => {
  const out = await render('flowchart TD\n subgraph G[Collapsed]\n A --> B\n end\n G@{view: collapsed}\n X --> A\n B --> Y\n %% @main X G Y');
  assert.deepEqual(out.report.diagnostics, []);
  assert.match(out.svg, /pele-shape-collapsedGroup/);
  assert.doesNotMatch(out.svg, /data-id="A"|data-id="B"/);
  assert.ok(out.report.understood.includes('main path (declared): X -> G -> Y'));
});

test('math and icon resolvers work in both measured and drawn passes, and unsafe images are filtered', async () => {
  const out = await render('flowchart TD\n A["$$x+1$$"] --> B["fa:fa-car"]\n %% @main A B', {
    icons: () => '<path d="M0 0 L24 24"/>',
    math: () => ({ svg: '<text>x+1</text>', width: 40, height: 20 }),
  });
  assert.match(out.svg, /data-icon="fa:fa-car"/);
  assert.match(out.svg, /x\+1/);
  assert.doesNotMatch(out.svg, /NaN|Infinity/);
  const unsafe = await render('flowchart TD\n A@{img:"javascript:alert(1)",label:"Image"} --> B\n %% @main A B');
  assert.doesNotMatch(unsafe.svg, /javascript:/);
  const images = 'flowchart TD\n A@{img:"https://example.com/a.png",label:"Image"} --> B';
  assert.doesNotMatch((await render(images, { images: false })).svg, /<image/);
});

test('author node IDs cannot collide with internal graph, edge or rank IDs', async () => {
  const out = await render('flowchart TD\n __semantic_root --> __semantic_edge_0\n __semantic_edge_0 ------> __semantic_rank_0\n %% @main __semantic_root __semantic_edge_0 __semantic_rank_0');
  for (const id of ['__semantic_root', '__semantic_edge_0', '__semantic_rank_0']) center(out.svg, id);
  assert.equal((out.svg.match(/class="pele-node /g) ?? []).length, 3);
  assert.deepEqual(out.report.diagnostics, []);
});

test('bounded default rounding preserves explicit global, source and edge curve choices', async () => {
  const source = fs.readFileSync(new URL('./fixtures/publishing.mmd', import.meta.url), 'utf8');
  const paths = (svg) => [...svg.matchAll(/<g class="pele-edge" data-id="([^"]*)"[^>]*><path d="([^"]*)"/g)].map((m) => [m[1], m[2]]);
  const ordinary = paths((await render(source)).svg);
  assert.ok(ordinary.length > 0);
  assert.deepEqual(ordinary, paths((await render(source, { config: { flowchart: { curve: 'step' } } })).svg));
  const linear = paths((await render(source, { config: { flowchart: { curve: 'linear' } } })).svg);
  assert.ok(linear.every(([, d]) => !/[QC]/.test(d)));
  assert.notDeepEqual(ordinary, linear);
  const smooth = paths((await render(`%%{init: {"flowchart":{"curve":"basis"}}}%%\n${source}`)).svg);
  assert.notDeepEqual(ordinary, smooth, 'source curve overrides bounded default');
  const edgeSource = source.replace('B -->|no| E', 'B revise@-->|no| E') + '\n revise@{ curve: basis }';
  const perEdge = paths((await render(edgeSource, { config: { flowchart: { curve: 'linear' } } })).svg);
  assert.ok(/[QC]/.test(perEdge.find(([id]) => id === 'revise')[1]), 'edge curve overrides global curve');
  assert.ok(perEdge.filter(([id]) => id !== 'revise').every(([, d]) => !/[QC]/.test(d)));
});

test('a candidate that attempts a straight main path still reports a remaining bend', async () => {
  const source = fs.readFileSync(new URL('./fixtures/publishing.mmd', import.meta.url), 'utf8');
  const out = await render(source, { candidate: 'semantic-no-ports', autoDirection: false });
  assert.ok(out.report.layout.measurements.spine < 1);
  assert.ok(out.report.layout.unapplied.includes('the chosen layout leaves a bend in the declared main path'));
});

test('long exit and reference arrows retain their requested span beside a reserved decision', async () => {
  for (const direction of ['TD', 'LR', 'BT', 'RL']) for (const reference of [false, true]) {
    const distances = [];
    for (const long of [false, true]) {
      const exit = `B ${!reference && long ? '------>' : '-->'}|reject| X`;
      const side = `R ${reference && long ? '-....->' : '-.->'} B`;
      const source = `flowchart ${direction}\n A-->B{Question?}\n B-->|yes|C\n C-->D\n ${exit}\n ${side}\n %% @main A B C D\n %% @exit B -> X\n %% @side R`;
      const out = await render(source, { candidate: 'semantic', autoDirection: false });
      const a = center(out.svg, 'B'), b = center(out.svg, reference ? 'R' : 'X');
      distances.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
    assert.ok(distances[1] > distances[0] + 20, `${direction}, reference=${reference}: ${distances}`);
  }
});
