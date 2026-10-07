// The diagram's text inside the SVG that render writes, so a delivered diagram can be changed later
// without a separate source file. It sits in an SVG <metadata> element, which browsers and image
// viewers do not draw.

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
