import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRenderer } from '../toolchain/render.js';

const exec = promisify(execFile);
let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-pele-cli-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const cli = (args, env = {}) => exec(process.execPath, ['toolchain/cli.js', ...args], { env: { ...process.env, ...env } });

test('CLI checks and renders Pele SVG with no installed browser and recovers exact source', async () => {
  const output = path.join(dir, 'order.svg');
  const env = { PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'no-browser') };
  const checked = JSON.parse((await cli(['check', 'examples/order.mmd', '--renderer', 'pele', '--json'], env)).stdout);
  assert.equal(checked.ok, true);
  assert.equal(checked.report.layout, null);
  const out = JSON.parse((await cli(['render', 'examples/order.mmd', '--renderer', 'pele', '-o', output, '--json'], env)).stdout);
  assert.equal(out.ok, true);
  assert.equal(out.width, 800);
  assert.match(await fs.readFile(output, 'utf8'), /class="pele pele-flowchart"/);
  assert.equal((await cli(['source', output])).stdout, await fs.readFile('examples/order.mmd', 'utf8'));
});

test('CLI semantic errors preserve an existing output and return failure', async () => {
  const source = path.join(dir, 'bad.mmd'), output = path.join(dir, 'existing.svg');
  await fs.writeFile(source, 'flowchart TD\n A --> B\n %% @main A Missing');
  await fs.writeFile(output, 'existing good output');
  await assert.rejects(cli(['render', source, '--renderer', 'pele', '-o', output, '--json']), (error) => {
    assert.equal(error.code, 1);
    const out = JSON.parse(error.stdout);
    assert.equal(out.ok, false);
    assert.deepEqual(out.written, []);
    assert.ok(out.report.diagnostics.some((d) => d.message.includes('Missing')));
    return true;
  });
  assert.equal(await fs.readFile(output, 'utf8'), 'existing good output');
});

test('Pele toolchain exports actual PNG and CLI supports colors, native diagrams and no-fit', async () => {
  const renderer = await createRenderer({ renderer: 'pele' });
  try {
    const source = await fs.readFile('examples/order.mmd', 'utf8');
    const out = await renderer.render(source, { png: true, fit: false, colors: false });
    assert.deepEqual([...out.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(out.width < 800);
    assert.equal(out.report.colored, false);
    assert.doesNotMatch(out.svg, /--semantic-/);
  } finally { await renderer.close(); }
  const source = path.join(dir, 'sequence.mmd'), output = path.join(dir, 'sequence.svg');
  await fs.writeFile(source, 'sequenceDiagram\n A->>B: hi');
  const out = JSON.parse((await cli(['render', source, '--renderer', 'pele', '-o', output, '--no-fit', '--json'])).stdout);
  assert.equal(out.report, null);
  assert.match(await fs.readFile(output, 'utf8'), /pele-sequence/);
});

test('CLI rejects conflicting renderer options and gives setup instructions for PNG without Chromium', async () => {
  await assert.rejects(cli(['render', 'examples/order.mmd', '--renderer', 'pele', '--elk', '-o', path.join(dir, 'bad.svg')]), (e) => e.code === 2 && /--elk uses Mermaid/.test(e.stderr));
  await assert.rejects(cli(['render', 'examples/order.mmd', '--renderer', 'wrong']), (e) => e.code === 2 && /--renderer must/.test(e.stderr));
  await assert.rejects(cli(['render', 'examples/order.mmd', '--renderer', 'pele', '-o', path.join(dir, 'missing.png')], { PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'no-browser') }), (e) => e.code === 1 && /semantic-mermaid setup/.test(e.stderr));
});

test('CLI native layout opt-out reports the layout warning rather than a non-flowchart warning', async () => {
  const source = path.join(dir, 'native.mmd'), output = path.join(dir, 'native.svg');
  await fs.writeFile(source, '---\nconfig: {layout: elk}\n---\nflowchart TD\n A --> B\n %% @main A B');
  const out = JSON.parse((await cli(['render', source, '--renderer', 'pele', '-o', output, '--json'])).stdout);
  assert.equal(out.ok, true);
  assert.ok(out.report.diagnostics.some((d) => /sets layout: elk/.test(d.message)));
  assert.ok(out.report.diagnostics.every((d) => !/flowcharts only/.test(d.message)));
});
