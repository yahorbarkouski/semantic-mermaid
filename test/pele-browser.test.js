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
    return { errors, nodes: leaves.length, width: out.width, height: out.height, chosen: out.report?.layout?.chosen, svg: out.svg };
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
