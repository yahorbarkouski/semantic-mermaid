// Semantic Mermaid directives: comment lines that state what a diagram means.
//
//   %% @main A B C D        the main path, in order (`@main none`: the diagram has no main path)
//   %% @exit B -> E         an outcome that ends or abandons the flow (error, rejection, early exit)
//   %% @retry F -> B        an arrow that goes back to an earlier step (retry, loop, recovery)
//   %% @side Config Logs    boxes that serve a single step (configuration, store, log, notification)
//   %% @peers P0 P1 P2      boxes that belong side by side, in this order
//   %% @lanes Ops Dev QA    groups that are parties passing work back and forth: one lane each, in order
//   %% @colors off          keep Mermaid's default colours
//
// Mermaid treats every `%%` line as a comment, so a diagram with directives still renders
// unchanged in any Mermaid host. This module only reads them; binding to the diagram's real ids
// happens in facts/resolve.js, once the graph is known.

/** @typedef {{ severity: 'error' | 'warning' | 'info', line?: number, message: string }} Diagnostic */
/** @typedef {{ from: string, to: string, line: number }} ArrowRef  an arrow named by its two node ids */
/** @typedef {{ ids: string[], line: number }} NodeList  ids is empty for `@main none` */

/**
 * @typedef {object} Annotations
 * @property {NodeList | null} main  the main path, or null when not declared
 * @property {ArrowRef[]} exits
 * @property {ArrowRef[]} retries
 * @property {NodeList[]} sides
 * @property {NodeList[]} peers
 * @property {NodeList | null} lanes  groups drawn as swimlanes, in order
 * @property {boolean} colors
 */

/** Directive names and how their arguments are read. */
export const DIRECTIVES = {
  main: 'nodes',
  exit: 'arrows',
  retry: 'arrows',
  side: 'nodes',
  peers: 'nodes',
  lanes: 'nodes',
  colors: 'switch',
};

const LINE = /^\s*%%\s*@([A-Za-z]+)\b(.*)$/;
const ARROW = /\s*-{1,2}>\s*/;

/** @returns {Annotations} */
function emptyAnnotations() {
  return { main: null, exits: [], retries: [], sides: [], peers: [], lanes: null, colors: true };
}

/**
 * Read the directives of a diagram source. Unknown or malformed directives become diagnostics;
 * the rest of the source is ignored.
 * @param {string | undefined} source
 * @returns {{ annotations: Annotations, diagnostics: Diagnostic[], count: number }}
 */
export function parseDirectives(source) {
  const annotations = emptyAnnotations();
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  let count = 0;
  (source ?? '').split(/\r?\n/).forEach((text, index) => {
    const match = text.match(LINE);
    if (!match) return;
    const line = index + 1;
    const name = match[1].toLowerCase();
    const body = match[2].trim();
    const kind = DIRECTIVES[/** @type {keyof typeof DIRECTIVES} */ (name)];
    if (!kind) {
      // a misspelt directive would silently drop what it declares, so it is an error
      const near = Object.keys(DIRECTIVES).find((d) => editDistance(d, name) <= 2);
      diagnostics.push({ severity: 'error', line, message: `unknown directive @${name}; ${near ? `did you mean @${near}?` : `the directives are ${Object.keys(DIRECTIVES).map((d) => '@' + d).join(', ')}`}` });
      return;
    }
    count++;
    if (kind === 'switch') {
      if (body !== 'on' && body !== 'off') diagnostics.push({ severity: 'error', line, message: `@${name} takes "on" or "off"` });
      else annotations.colors = body === 'on';
      return;
    }
    if (kind === 'nodes') {
      const ids = splitIds(body);
      if (!ids.length) { diagnostics.push({ severity: 'error', line, message: `@${name} needs at least one node id` }); return; }
      if (name === 'main') {
        if (ids.length === 1 && ids[0] === 'none' && !annotations.main) annotations.main = { ids: [], line };
        else if (ids.length < 2) diagnostics.push({ severity: 'error', line, message: '@main needs at least two node ids, or "none"' });
        else if (annotations.main) diagnostics.push({ severity: 'error', line, message: '@main is declared twice; a diagram has one main path' });
        else annotations.main = { ids, line };
      } else if (name === 'side') annotations.sides.push({ ids, line });
      else if (name === 'peers') {
        if (ids.length < 2) diagnostics.push({ severity: 'error', line, message: '@peers needs at least two node ids' });
        else annotations.peers.push({ ids, line });
      } else if (name === 'lanes') {
        if (ids.length < 2) diagnostics.push({ severity: 'error', line, message: '@lanes needs at least two group ids' });
        else if (annotations.lanes) diagnostics.push({ severity: 'error', line, message: '@lanes is declared twice' });
        else annotations.lanes = { ids, line };
      }
      return;
    }
    // arrows: "A -> B", several separated by commas
    for (const part of body.split(',').map((p) => p.trim()).filter(Boolean)) {
      const ends = part.split(ARROW).map((p) => p.trim());
      if (ends.length !== 2 || !ends[0] || !ends[1] || /\s/.test(ends[0] + ends[1])) {
        diagnostics.push({ severity: 'error', line, message: `@${name} expects arrows written "From -> To", got "${part}"` });
        continue;
      }
      (name === 'exit' ? annotations.exits : annotations.retries).push({ from: ends[0], to: ends[1], line });
    }
  });
  // a layout chosen in the diagram's own configuration replaces the semantic one
  const chosen = count ? layoutSettings(source ?? '').find((s) => s.layout !== 'semantic') : undefined;
  if (chosen) diagnostics.push({ severity: 'warning', line: chosen.line, message: `the diagram's configuration sets layout: ${chosen.layout}, so the semantic layout does not run and the directives have no effect; remove that setting` });
  return { annotations, diagnostics, count };
}

/**
 * The layouts the diagram selects itself, in its frontmatter (`config: layout: elk`) or in an init
 * directive (`%%{init: {"layout": "elk"}}%%`), each with its line.
 * @param {string} source
 * @returns {{ layout: string, line: number }[]}
 */
export function layoutSettings(source) {
  const lines = source.split(/\r?\n/);
  const front = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  /** @type {{ layout: string, line: number }[]} */
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const inFront = i > 0 && i < front;
    const match = inFront ? lines[i].match(/^\s*layout:\s*["']?([\w-]+)/) : lines[i].match(/^\s*%%\{.*["']?layout["']?\s*:\s*["']([\w-]+)/);
    if (match) found.push({ layout: match[1], line: i + 1 });
  }
  return found;
}

/** Levenshtein distance, for suggesting the directive a misspelt name meant. @param {string} a @param {string} b */
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** Node ids separated by spaces, commas or arrows: "A B C", "A, B, C" and "A -> B -> C" all work. */
function splitIds(body) {
  return body.split(/\s*(?:,|-{1,2}>|\s)\s*/).map((s) => s.trim()).filter(Boolean);
}
