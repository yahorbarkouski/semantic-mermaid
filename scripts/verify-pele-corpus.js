// Verify external JSONL manifests ({id,path}) against native Pele and the semantic adapter.
// node scripts/verify-pele-corpus.js <source-root> <run-dir> <manifest.jsonl>... [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { render } from '../src/pele/index.js';
import { render as native } from 'pele';

const args = process.argv.slice(2);
const at = args.indexOf('--limit');
const limit = at < 0 ? Infinity : Number(args.splice(at, 2)[1]);
const [root, run, ...manifests] = args;
if (!root || !run || !manifests.length || !(limit > 0)) throw new Error('usage: verify-pele-corpus <source-root> <run-dir> <manifest.jsonl>... [--limit N]');
fs.mkdirSync(run, { recursive: true });
const hash = createHash('sha256');
const sources = fs.readdirSync('src', { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => path.join('src', String(f))).sort();
for (const file of [...sources, 'vendor/pele/runtime.js', 'package-lock.json', 'scripts/verify-pele-corpus.js', ...manifests]) hash.update(fs.readFileSync(file));
const config = JSON.stringify({ root: path.resolve(root), manifests: manifests.map((m) => path.resolve(m)), adapterHash: hash.digest('hex'), maxWidth: 800 });
const configPath = path.join(run, 'config.json');
if (fs.existsSync(configPath) && fs.readFileSync(configPath, 'utf8') !== config) throw new Error('adapter or inputs changed; use a new run directory');
fs.writeFileSync(configPath, config);
const resultPath = path.join(run, 'results.jsonl');
const previous = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Map(previous.map((r) => [r.id, r.sourceHash]));
const rows = manifests.flatMap((m) => fs.readFileSync(m, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const unique = new Map();
for (const row of rows) {
  const existing = unique.get(row.id);
  if (existing && existing.path !== row.path) throw new Error(`manifest ID ${row.id} names two different files`);
  unique.set(row.id, row);
}
const entries = [...unique.values()];
if (rows.length !== entries.length) console.log(`${entries.length} unique inputs; ${rows.length - entries.length} repeated manifest rows ignored`);
let count = 0;
let failures = previous.filter((r) => r.status === 'adapter-error').length;
for (const entry of entries) {
  const source = fs.readFileSync(path.resolve(root, entry.path), 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (done.has(entry.id)) {
    if (done.get(entry.id) !== sourceHash) throw new Error(`${entry.id} source changed; use a new run directory`);
    continue;
  }
  if (count >= limit) break;
  const record = { id: entry.id, path: entry.path, sourceHash, status: 'ok', ms: 0, message: '', chosen: '' };
  const started = performance.now();
  try { native(source); }
  catch (error) { record.status = 'native-rejected'; record.message = String(error); }
  if (record.status === 'ok') {
    try {
      const out = await render(source, { maxWidth: 800 });
      if (!(out.width > 0 && out.height > 0) || /(?:NaN|Infinity)/.test(out.svg)) throw new Error('nonfinite SVG geometry');
      if (out.report?.diagnostics.some((d) => d.severity === 'error')) throw new Error(JSON.stringify(out.report.diagnostics));
      record.chosen = out.report?.layout?.chosen ?? 'native';
    } catch (error) { record.status = 'adapter-error'; record.message = String(error); failures++; }
  }
  record.ms = Math.round(performance.now() - started);
  fs.appendFileSync(resultPath, JSON.stringify(record) + '\n');
  count++;
  console.log(`${previous.length + count}/${entries.length} ${entry.id}: ${record.status} ${record.ms}ms${record.message ? ` ${record.message.slice(0, 240)}` : ''}`);
  if (failures >= 5) { console.error('stopped after five adapter failures; inspect saved results'); break; }
}
console.log(`${previous.length + count}/${entries.length} saved; ${failures} adapter failures`);
if (failures) process.exitCode = 1;
