#!/usr/bin/env node
// semantic-mermaid: check and render Semantic Mermaid diagrams.
//
//   semantic-mermaid check diagram.mmd [--verbose] [--json]
//   semantic-mermaid render diagram.mmd [-o diagram.svg] [-o diagram.png] [--elk] [--no-colors] [--verbose] [--json]
//   semantic-mermaid setup   download the headless browser render uses, once
//   semantic-mermaid source diagram.svg   print the diagram an SVG from render was drawn from
//
// A file argument of "-" reads the diagram from standard input. `render` writes each -o file in the
// format its name ends in (.svg or .png), and <file>.svg beside the source when no -o is given; a
// diagram from standard input needs -o. Each SVG carries the diagram's text, which `source` prints, so
// a delivered diagram can be changed without keeping a separate source file. Render writes nothing
// when the diagram has errors. Both commands print "ok" or the problems to fix; --verbose
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
import { checkDiagram, directivesIgnored } from './check.js';
import { withSource, sourceOf, compactPaths } from './source.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const USAGE = `usage:
  semantic-mermaid check <file.mmd|-> [--verbose] [--json]
  semantic-mermaid render <file.mmd|-> [-o out.svg|out.png ...] [--elk] [--no-colors] [--verbose] [--json]
  semantic-mermaid setup    download the headless browser that render uses (once, about 95 MB)
  semantic-mermaid source <file.svg>   print the diagram an SVG from render was drawn from
  semantic-mermaid --version`;

/** The browser `render` uses: Playwright's headless Chromium, the build this package's Playwright expects. */
function setup() {
  const playwright = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright')), 'cli.js');
  const status = spawnSync(process.execPath, [playwright, 'install', '--only-shell', 'chromium'], { stdio: 'inherit' }).status ?? 1;
  if (status === 0) console.log('the headless browser is installed; render is ready');
  return status;
}

/** @param {string} file */
function printSource(file) {
  if (!fs.existsSync(file)) {
    console.error(`${file}: no such file`);
    return 2;
  }
  const text = sourceOf(fs.readFileSync(file, 'utf8'));
  if (text === null) {
    console.error(`${file}: no diagram text inside; only SVGs written by semantic-mermaid render carry it`);
    return 1;
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}

/** Why the browser did not start, in one line, with what fixes it. @param {unknown} error */
function browserProblem(error) {
  const message = String(/** @type {Error} */ (error)?.message ?? error);
  if (/Executable doesn't exist/.test(message)) return 'render needs a headless browser, which is not installed yet: run `semantic-mermaid setup` once';
  const version = createRequire(import.meta.url)('playwright/package.json').version;
  return `render could not start its headless browser (${message.split('\n')[0]}); on Linux, install its system libraries with \`npx playwright@${version} install-deps chromium\``;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o', multiple: true },
        elk: { type: 'boolean', default: false },
        'no-colors': { type: 'boolean', default: false },
        candidate: { type: 'string' },
        json: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    console.error(`${/** @type {Error} */ (error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [command, file] = positionals;
  if (command === 'setup' && !values.help) return setup();
  if (command === 'source' && file && !values.help) return printSource(file);
  if (values.help || !command || !file || !['render', 'check'].includes(command)) {
    console.log(USAGE);
    return command && !values.help ? 2 : 0;
  }
  if (file !== '-' && !fs.existsSync(file)) {
    console.error(`${file}: no such file`);
    return 2;
  }
  const source = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  const name = file === '-' ? 'stdin' : path.basename(file);
  /** @param {string} message @param {number} [status] */
  const fail = (message, status = 1) => {
    if (values.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(`${name}: ${message}`);
    return status;
  };
  const failed = (/** @type {unknown} */ error) => {
    const message = String(/** @type {Error} */ (error)?.message ?? error);
    // Mermaid's syntax errors read the same from check and render
    const parse = command === 'check' || /^(Parse|Lexical) error|No diagram type detected/.test(message);
    return fail(`Mermaid could not ${parse ? 'parse' : 'render'} the diagram:\n  ${message}`);
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
    return finish(report ?? directivesIgnored(source));
  }
  if (file === '-' && !values.out?.length) return fail('name the image to write, with -o name.svg or -o name.png', 2);
  const outs = values.out?.length ? values.out : [file.replace(/\.(mmd|mermaid|md|txt)$/i, '') + '.svg'];
  const unknown = outs.find((o) => !/\.(svg|png)$/i.test(o));
  if (unknown) return fail(`-o ${unknown}: the file name must end in .svg or .png`, 2);
  const { createRenderer } = await import('./render.js');
  let renderer;
  try {
    renderer = await createRenderer();
  } catch (error) {
    return fail(browserProblem(error));
  }
  try {
    let rendered;
    try {
      rendered = await renderer.render(source, { layout: values.elk ? 'elk' : 'semantic', colors: !values['no-colors'], png: outs.some((o) => /\.png$/i.test(o)), candidate: values.candidate });
    } catch (error) {
      return failed(error);
    }
    const report = rendered.report ?? (values.elk ? null : directivesIgnored(source));
    // an image drawn while directives had errors would replace a good one with a wrong one
    const errors = report?.diagnostics.some((d) => d.severity === 'error');
    if (!errors) {
      for (const out of outs) {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.writeFileSync(out, /\.png$/i.test(out) ? /** @type {Buffer} */ (rendered.png) : withSource(compactPaths(rendered.svg), source));
      }
      if (!values.json) console.log(`wrote ${outs.join(' and ')} (${Math.round(rendered.width)}x${Math.round(rendered.height)})`);
    }
    const status = finish(report, { width: rendered.width, height: rendered.height, written: errors ? [] : outs });
    if (errors && !values.json) console.error('nothing written: fix the errors above and render again');
    return status;
  } finally {
    await renderer.close();
  }
}

/** Maps inside the report (title sides) as plain objects. */
function serializable(report) {
  return JSON.parse(JSON.stringify(report, (_, v) => (v instanceof Map ? Object.fromEntries(v) : v)));
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.stack ?? error); process.exitCode = 1; });
