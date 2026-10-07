// Copies Mermaid's ELK layout plugin into vendor/layout-elk and patches it in four places, so the
// semantic engine can lay out the ELK graph Mermaid builds before Mermaid draws it, quickly.
//
//   npm run vendor
//
// 1. The plugin's single `elk.layout(elkGraph)` call defers to
//    `globalThis.__semanticMermaidLayout(elkGraph, elk)` when that function is set.
// 2. Mermaid fits every group frame to its content after layout; a group the engine marks with
//    `semanticFrame: true` (a swimlane) keeps the frame the engine gave it.
// 3-4. Messages to and from ELK's in-page worker pass in microtasks instead of setTimeout(0), which
//    browsers delay by 4 ms once timers nest; a semantic render runs ELK several times.
// With the hook unset and no group marked, the vendored plugin lays out exactly like the published one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(ROOT, 'node_modules/@mermaid-js/layout-elk/dist');
const TARGET = path.join(ROOT, 'vendor/layout-elk');

const PATCHES = [
  {
    what: 'the layout call defers to globalThis.__semanticMermaidLayout when it is set',
    anchor: 'graph = await elk.layout(elkGraph);',
    replacement: [
      '// semantic-mermaid: let the semantic engine lay out the graph Mermaid built',
      'graph = globalThis.__semanticMermaidLayout ? await globalThis.__semanticMermaidLayout(elkGraph, elk) : await elk.layout(elkGraph);',
    ].join('\n      '),
  },
  {
    what: 'groups marked `semanticFrame` keep the frame the layout gave them',
    anchor: 'function evenGroupFrames(elkNodes, layoutState, nodeById, graph = {}) {\n  for (const elkNode of elkNodes) {\n    if (!elkNode?.isGroup) {',
    replacement: [
      'function evenGroupFrames(elkNodes, layoutState, nodeById, graph = {}) {',
      '  for (const elkNode of elkNodes) {',
      '    // semantic-mermaid: swimlanes keep the frames the semantic engine gave them',
      '    if (!elkNode?.isGroup || elkNode.semanticFrame) {',
    ].join('\n'),
  },
  // elkjs passes every message between its caller and its in-page worker through setTimeout(0); the
  // browser clamps nested timers to 4 ms, which left a third of each semantic render (several ELK runs)
  // idle. A microtask hands the message on at once; the layouts are unchanged.
  {
    what: 'the answer from ELK\'s in-page worker is handed on in a microtask instead of setTimeout(0)',
    anchor: 'setTimeout(function() {\n                _this2.receive(_this2, answer);\n              }, 0);',
    replacement: [
      '// semantic-mermaid: a microtask, which the browser does not delay as it does nested timers',
      'queueMicrotask(function() {',
      '  _this2.receive(_this2, answer);',
      '});',
    ].join('\n              '),
  },
  {
    what: 'a message to ELK\'s in-page worker is dispatched in a microtask instead of setTimeout(0)',
    anchor: 'setTimeout(function() {\n                    c10.dispatcher.saveDispatch({ data: a10 });\n                  }, 0);',
    replacement: [
      '// semantic-mermaid: a microtask, which the browser does not delay as it does nested timers',
      'queueMicrotask(function() {',
      '  c10.dispatcher.saveDispatch({ data: a10 });',
      '});',
    ].join('\n                  '),
  },
];

const version = JSON.parse(fs.readFileSync(path.join(SOURCE, '../package.json'), 'utf8')).version;
fs.rmSync(TARGET, { recursive: true, force: true });
// only the ESM entry and its chunks are used; the core and minified builds are left out
const keep = (f) => !f.endsWith('.map') && !/mermaid-layout-elk\.(core|esm\.min)\.mjs$/.test(f) && !f.includes(`${path.sep}chunks${path.sep}mermaid-layout-elk.core`) && !f.includes(`${path.sep}chunks${path.sep}mermaid-layout-elk.esm.min`);
fs.cpSync(SOURCE, TARGET, { recursive: true, filter: keep });
fs.copyFileSync(path.join(SOURCE, '../LICENSE'), path.join(TARGET, 'LICENSE'));

const chunks = fs.readdirSync(path.join(TARGET, 'chunks/mermaid-layout-elk.esm')).map((f) => path.join(TARGET, 'chunks/mermaid-layout-elk.esm', f));
// every patch must match exactly once across the chunks, so a changed plugin fails loudly here
const patched = PATCHES.map(({ what, anchor, replacement }) => {
  const hits = chunks.filter((file) => fs.readFileSync(file, 'utf8').includes(anchor));
  const count = hits.reduce((n, file) => n + fs.readFileSync(file, 'utf8').split(anchor).length - 1, 0);
  if (count !== 1) throw new Error(`patch "${what}": expected its anchor once, found it ${count} times`);
  fs.writeFileSync(hits[0], fs.readFileSync(hits[0], 'utf8').replace(anchor, replacement));
  return { what, file: hits[0] };
});
// a declaration beside the entry keeps type checking out of the bundled code
fs.writeFileSync(path.join(TARGET, 'mermaid-layout-elk.esm.d.mts'), [
  '/** Mermaid layout loaders: { name, loader, algorithm }; loader() resolves to a module with render(). */',
  'declare const layouts: { name: string, algorithm: string, loader: () => Promise<{ render: (data: any, svg: any, helpers: any, options: any) => Promise<void> }> }[];',
  'export default layouts;',
  '',
].join('\n'));
fs.writeFileSync(path.join(TARGET, 'VENDORED.md'), [
  `Copy of @mermaid-js/layout-elk ${version} (the ESM entry and its chunks, source maps removed), generated by scripts/vendor-layout-elk.js.`,
  'It is part of Mermaid (https://github.com/mermaid-js/mermaid) and keeps its MIT license, in LICENSE beside this file.',
  '',
  'Changes, each marked `semantic-mermaid:` in the code:',
  ...patched.map(({ what, file }) => `- ${path.relative(TARGET, file)}: ${what}`),
  '',
].join('\n'));
console.log(`vendored @mermaid-js/layout-elk ${version} with ${patched.length} patches`);
