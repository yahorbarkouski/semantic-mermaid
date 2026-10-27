// Run the browser consumer's actual bundled API, then inspect the SVG Pele painted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser, server, dir, page;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-pele-browser-'));
  await build({ entryPoints: ['src/pele/index.js'], outdir: dir, bundle: true, format: 'esm', splitting: true, platform: 'browser', target: 'es2022', logLevel: 'silent' });
  server = http.createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><style>body{margin:0}</style><div id="stage"></div><script type="module">import * as api from "/index.js";window.api=api;</script>'); return; }
    try { res.setHeader('content-type', 'text/javascript'); res.end(await fs.readFile(path.join(dir, path.basename(req.url)))); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.api);
});
after(async () => { await browser?.close(); server?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

async function draw(source, options = {}) {
  return page.evaluate(async ({ source, options }) => {
    const out = await window.api.render(source, options);
    const stage = document.getElementById('stage');
    stage.innerHTML = out.svg;
    const svg = stage.querySelector('svg');
    const frame = svg.viewBox.baseVal;
    const errors = [];
    if (new DOMParser().parseFromString(out.svg, 'image/svg+xml').querySelector('parsererror')) errors.push('invalid XML');
    const leaves = [...svg.querySelectorAll(out.type === 'flowchart' ? 'g.pele-node' : ':not(*)')].map((el) => {
      const b = el.getBBox();
      const t = el.transform.baseVal.consolidate().matrix;
      return { id: el.dataset.id, x: b.x + t.e, y: b.y + t.f, w: b.width, h: b.height };
    });
    for (const b of leaves) {
      if (b.x < -1 || b.y < -1 || b.x + b.w > frame.width + 1 || b.y + b.h > frame.height + 1) errors.push(`node ${b.id} outside viewBox`);
    }
    for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1) errors.push(`nodes ${a.id} and ${b.id} overlap`);
    }
    for (const edge of svg.querySelectorAll('g.pele-edge')) {
      const path = edge.querySelector('path');
      if (!path || !Number.isFinite(path.getTotalLength()) || path.getTotalLength() <= 0) errors.push(`edge ${edge.dataset.id} has no route`);
    }
    return { errors, nodes: leaves.length, width: out.width, height: out.height, chosen: out.report?.layout?.chosen, measurements: out.report?.layout?.measurements, tried: out.report?.layout?.tried, svg: out.svg };
  }, { source, options });
}

test('browser bundle renders every example as valid, bounded SVG without overlapping nodes', async () => {
  const names = (await fs.readdir('examples')).filter((n) => n.endsWith('.mmd'));
  for (const name of names) {
    const out = await draw(await fs.readFile(`examples/${name}`, 'utf8'), { maxWidth: 800 });
    assert.deepEqual(out.errors, [], name);
    assert.ok(out.nodes > 0, name);
    assert.ok(out.chosen, name);
  }
});

test('nested groups, group endpoints and all arrowhead kinds survive geometry transfer', async () => {
  const source = `flowchart TD
 subgraph Outer[Outer party]
   subgraph Inner[Inner party]
     A{Choice} -->|yes| B[Step]
   end
   B --> C[(Store)]
 end
 D([Entry]) --> A
 Inner --> E((End))
 C o--o E
 D x--x E
 %% @main D A B C
 %% @exit A -> B`;
  const out = await draw(source);
  assert.deepEqual(out.errors, []);
  assert.match(out.svg, /data-id="Inner"/);
  assert.match(out.svg, /data-id="Outer"/);
});

test('modern decision shapes are recognized, and rendered arrow ends touch the shape outlines', async () => {
  const source = 'flowchart TD\n A@{shape: diam, label: "Decide"} --> B((Circle))\n B --> C[(Store)]\n C --> D([End])\n %% @main A B C D';
  const out = await draw(source);
  assert.deepEqual(out.errors, []);
  const endpoints = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    const nodes = new Map([...svg.querySelectorAll('g.pele-node')].map((el) => {
      const b = el.getBBox(), m = el.transform.baseVal.consolidate().matrix;
      return [el.dataset.id, { x: m.e, y: m.f, w: b.width, h: b.height }];
    }));
    const pairs = [['A', 'B'], ['B', 'C'], ['C', 'D']];
    return [...svg.querySelectorAll('g.pele-edge')].map((edge, i) => {
      const p = edge.querySelector('path');
      const start = p.getPointAtLength(0), end = p.getPointAtLength(p.getTotalLength());
      const a = nodes.get(pairs[i][0]), b = nodes.get(pairs[i][1]);
      return { startGap: Math.abs(start.y - (a.y + a.h / 2)), endGap: Math.abs(end.y - (b.y - b.h / 2)), startX: Math.abs(start.x - a.x), endX: Math.abs(end.x - b.x) };
    });
  });
  for (const p of endpoints) {
    assert.ok(p.startGap <= 1 && p.endGap <= 12 && p.startX <= 1 && p.endX <= 1, JSON.stringify(p));
  }
});

test('role colors follow CSS variables when the host changes to a dark theme', async () => {
  await draw('flowchart TD\n A([Start]) --> B{Ready?}\n B --> C[Done]\n %% @main A B C');
  const colors = await page.evaluate(() => {
    const stage = document.getElementById('stage');
    stage.style.cssText = '--pele-surface:#101820;--pele-fg:#eeeeee;--pele-accent:#77aaff';
    const shape = stage.querySelector('g.pele-node > rect');
    const text = stage.querySelector('g.pele-node text');
    return { fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke, text: getComputedStyle(text).fill };
  });
  assert.deepEqual(colors, { fill: 'rgb(16, 24, 32)', stroke: 'rgb(119, 170, 255)', text: 'rgb(238, 238, 238)' });
  await page.locator('#stage').evaluate((stage) => stage.removeAttribute('style'));
});

test('native non-flowchart dynamic import works in the browser bundle', async () => {
  const out = await draw('sequenceDiagram\n A->>B: Hello');
  assert.equal(out.chosen, undefined);
  assert.match(out.svg, /pele-sequence/);
});

test('long group titles stay inside their frames in every direction', async () => {
  for (const dir of ['TD', 'LR', 'BT', 'RL']) {
    await draw(`flowchart ${dir}\n subgraph G[This is a very very very long group title that should fit inside its frame]\n A\n end`, { autoDirection: false });
    const bounds = await page.evaluate(() => {
      const group = document.querySelector('g.pele-cluster');
      const frame = group.querySelector('rect').getBBox();
      const text = group.querySelector('text').getBBox();
      return { left: text.x - frame.x, right: frame.x + frame.width - text.x - text.width, width: frame.width, height: frame.height };
    });
    assert.ok(bounds.left >= 0 && bounds.right >= 0, `${dir}: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.height < bounds.width, `${dir}: group grew in wrong axis`);
  }
});

test('publishing keeps its declared spine and routes each decision outcome separately', async () => {
  const source = await fs.readFile('test/fixtures/publishing.mmd', 'utf8');
  for (const direction of ['TD', 'LR', 'BT', 'RL']) {
    const out = await draw(source.replace('flowchart TD', `flowchart ${direction}`), { autoDirection: false });
    assert.deepEqual(out.errors, [], direction);
    const placed = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('g.pele-node')].map((node) => {
      const m = node.transform.baseVal.consolidate().matrix;
      return [node.dataset.id, { x: m.e, y: m.f }];
    })));
    const across = direction === 'TD' || direction === 'BT' ? 'x' : 'y';
    const along = across === 'x' ? 'y' : 'x';
    for (const id of ['B', 'C', 'D']) assert.ok(Math.abs(placed[id][across] - placed.A[across]) < 1, `${direction}: ${id} left the declared spine`);
    assert.ok(Math.abs(placed.X[along] - placed.B[along]) < 1, `${direction}: rejection must stay beside its decision`);
    assert.ok(Math.abs(placed.R[along] - placed.B[along]) < 1, `${direction}: reference must stay beside its decision`);
  }
});

test('the default Pele curve keeps an adjacent outcome label clear of its own arrow', async () => {
  // Force the old compact route: bounded rounding must protect labels even when port
  // reservations are disabled by a candidate or the selected layout has tight corners.
  await draw(await fs.readFile('test/fixtures/publishing.mmd', 'utf8'), { candidate: 'semantic-no-ports' });
  const intrusion = await page.evaluate(() => {
    const label = [...document.querySelectorAll('g.pele-edge-label')].find((node) => node.textContent === 'no');
    const rect = label.querySelector('rect').getBBox();
    const edge = [...document.querySelectorAll('g.pele-edge')].find((node) => node.dataset.id === label.dataset.id).querySelector('path');
    for (let d = 0, length = edge.getTotalLength(); d < length; d += 0.5) {
      const p = edge.getPointAtLength(d);
      if (p.x > rect.x + 0.5 && p.x < rect.x + rect.width - 0.5 && p.y > rect.y + 0.5 && p.y < rect.y + rect.height - 0.5) return true;
    }
    return false;
  });
  assert.equal(intrusion, false, 'curving the arrow must not sweep it into an adjacent label background');
});

test('decision routes remain bounded with long text, larger fonts and nested groups', async () => {
  const publishing = await fs.readFile('test/fixtures/publishing.mmd', 'utf8');
  const cases = [
    ['long decision', publishing.replace('Review passed?', 'Did the editorial and legal reviews both pass?'), {}],
    ['wide retry box', publishing.replace('[Revise]', '[Rewrite and request another review]'), {}],
    ['large text', publishing, { fontSize: 24 }],
    ['two references', publishing.replace('%% @side R', 'S[(Editorial policy)] -.-> B\n %% @side R S'), {}],
    ['nested boundary', `flowchart TD
 A([Write draft]) --> B
 subgraph Outer[Publishing]
   subgraph Inner[Review]
     B{Review passed?} -->|reject| X[Archive]
     R[(Style guide)] -.-> B
   end
   B -->|yes| C[Publish]
   B -->|no| E[Revise]
   E --> B
 end
 C --> D([Live])
 %% @main A B C D
 %% @exit B -> X
 %% @retry E -> B
 %% @side R`, {}],
  ];
  for (const [name, source, options] of cases) for (const direction of ['TD', 'LR', 'BT', 'RL']) {
    const out = await draw(source.replace('flowchart TD', `flowchart ${direction}`), { ...options, autoDirection: false });
    assert.deepEqual(out.errors, [], `${name}, ${direction}`);
    assert.equal(out.measurements.throughBoxes, 0, `${name}, ${direction}: arrow passes through a node`);
    assert.ok(out.tried.every((t) => !t.error), `${name}, ${direction}: candidate failed`);
  }
});

test('parallel retries preserve straight main paths across adjacent decisions', async () => {
  const examples = [
    ['bug-triage', ['Report', 'Repro', 'Severity', 'Hotfix', 'Verify', 'Close']],
    ['file-upload', ['Pick', 'Size', 'Scan', 'Upload', 'Done']],
    ['order', ['A', 'B', 'C', 'D', 'E', 'F']],
  ];
  for (const [name, main] of examples) {
    const out = await draw(await fs.readFile(`examples/${name}.mmd`, 'utf8'), { maxWidth: 800 });
    assert.deepEqual(out.errors, [], name);
    assert.equal(out.measurements.spine, 1, name);
    for (const key of ['crossings', 'crowdedEnds', 'throughBoxes']) assert.equal(out.measurements[key], 0, `${name}: ${key}`);
    const xs = await page.evaluate((ids) => ids.map((id) => document.querySelector(`g.pele-node[data-id="${id}"]`).transform.baseVal.consolidate().matrix.e), main);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1, `${name}: visible main path shifts sideways`);
  }
});
