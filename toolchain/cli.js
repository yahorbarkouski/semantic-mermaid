#!/usr/bin/env node
// semantic-mermaid: check and render Semantic Mermaid diagrams.
//
//   semantic-mermaid check diagram.mmd [--verbose] [--json]
//   semantic-mermaid render diagram.mmd [-o diagram.svg] [-o diagram.png] [--elk] [--no-colors] [--verbose] [--json]
//   semantic-mermaid setup   download the headless browser render uses, once
//
// A file argument of "-" reads the diagram from standard input. `render` writes each -o file in the
// format its name ends in (.svg or .png), and <file>.svg beside the source when no -o is given; a
// diagram from standard input needs -o. Both commands print "ok" or the problems to fix; --verbose
// adds what the engine understood (and, for render, the layout it chose). They exit with status 1
// when the diagram has errors (a parse error, or a directive that names a missing node or arrow).
// `render --candidate name` forces one of the engine's layout candidates (the names
// `render --json` lists under `tried`), for debugging.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { formatStatus } from './report.js';
import { checkDiagram } from './check.js';

const USAGE = `usage:
  semantic-mermaid check <file.mmd|-> [--verbose] [--json]
  semantic-mermaid render <file.mmd|-> [-o out.svg|out.png ...] [--elk] [--no-colors] [--verbose] [--json]
  semantic-mermaid setup    download the headless browser that render uses (once, about 95 MB)`;

/** The browser `render` uses: Playwright's headless Chromium, the build this package's Playwright expects. */
function setup() {
  const playwright = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright')), 'cli.js');
  return spawnSync(process.execPath, [playwright, 'install', '--only-shell', 'chromium'], { stdio: 'inherit' }).status ?? 1;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o', multiple: true },
      elk: { type: 'boolean', default: false },
      'no-colors': { type: 'boolean', default: false },
      candidate: { type: 'string' },
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, file] = positionals;
  if (command === 'setup' && !values.help) return setup();
  if (values.help || !command || !file || !['render', 'check'].includes(command)) {
    console.log(USAGE);
    return command && !values.help ? 2 : 0;
  }
  const source = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  const name = file === '-' ? 'stdin' : path.basename(file);
  const failed = (/** @type {unknown} */ error) => {
    const message = /** @type {Error} */ (error).message;
    if (values.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(`${name}: Mermaid could not parse the diagram:\n  ${message}`);
    return 1;
  };
  /** @param {import('./report.js').Report | null} report @param {object} [extra] */
  const finish = (report, extra = {}) => {
    const errors = report?.diagnostics.filter((d) => d.severity === 'error') ?? [];
    if (values.json) console.log(JSON.stringify({ ok: errors.length === 0, ...extra, report: serializable(report) }, null, 2));
    else console.log(formatStatus(report, { verbose: values.verbose, name }));
    return errors.length ? 1 : 0;
  };

  // a check parses in Node; only drawing starts a browser
  if (command === 'check') {
    let report;
    try {
      report = await checkDiagram(source);
    } catch (error) {
      return failed(error);
    }
    return finish(report);
  }
  if (file === '-' && !values.out?.length) {
    console.error('stdin: name the image to write, with -o name.svg or -o name.png');
    return 2;
  }
  const outs = values.out?.length ? values.out : [file.replace(/\.(mmd|mermaid|md|txt)$/i, '') + '.svg'];
  const unknown = outs.find((o) => !/\.(svg|png)$/i.test(o));
  if (unknown) {
    console.error(`${name}: -o ${unknown}: the file name must end in .svg or .png`);
    return 2;
  }
  const { createRenderer } = await import('./render.js');
  let renderer;
  try {
    renderer = await createRenderer();
  } catch (error) {
    if (!/Executable doesn't exist/.test(String(/** @type {Error} */ (error).message))) throw error;
    console.error('render needs a headless browser, which is not installed yet: run `semantic-mermaid setup` once');
    return 1;
  }
  try {
    let rendered;
    try {
      rendered = await renderer.render(source, { layout: values.elk ? 'elk' : 'semantic', colors: !values['no-colors'], png: outs.some((o) => /\.png$/i.test(o)), candidate: values.candidate });
    } catch (error) {
      return failed(error);
    }
    for (const out of outs) fs.writeFileSync(out, /\.png$/i.test(out) ? /** @type {Buffer} */ (rendered.png) : rendered.svg);
    if (!values.json) console.log(`wrote ${outs.join(' and ')} (${Math.round(rendered.width)}x${Math.round(rendered.height)})`);
    return finish(rendered.report ?? null, { width: rendered.width, height: rendered.height });
  } finally {
    await renderer.close();
  }
}

/** Maps inside the report (title sides) as plain objects. */
function serializable(report) {
  return JSON.parse(JSON.stringify(report, (_, v) => (v instanceof Map ? Object.fromEntries(v) : v)));
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.stack ?? error); process.exitCode = 1; });
