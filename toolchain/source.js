// What render writes into an SVG file: the diagram's text, so a delivered diagram can be changed
// later without a separate source file (in a <metadata> element, which browsers and image viewers
// do not draw), and path data rounded to hundredths of a pixel. Mermaid draws some shapes through
// rough.js, which writes every coordinate with 15 or more decimals: three rounded boxes took 90 KB.

const OPEN = '<metadata id="semantic-mermaid-source">';
const CLOSE = '</metadata>';

/** @param {string} text */
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** @param {string} text */
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The SVG with the diagram's text inside, right after the opening <svg> tag.
 * @param {string} svg
 * @param {string} source
 */
export function withSource(svg, source) {
  const end = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  return `${svg.slice(0, end)}${OPEN}${escape(source)}${CLOSE}${svg.slice(end)}`;
}

/**
 * The diagram's text inside an SVG written by withSource, or null.
 * @param {string} svg
 */
export function sourceOf(svg) {
  const start = svg.indexOf(OPEN);
  if (start < 0) return null;
  const end = svg.indexOf(CLOSE, start);
  return end < 0 ? null : unescape(svg.slice(start + OPEN.length, end));
}

/**
 * The SVG with the numbers in its path data rounded to two decimals; nothing else changes.
 * @param {string} svg
 */
export function compactPaths(svg) {
  return svg.replace(/ d="([^"]*)"/g, (_, d) => ` d="${d.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100))}"`);
}
