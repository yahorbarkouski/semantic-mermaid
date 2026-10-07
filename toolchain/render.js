// Node API: render Semantic Mermaid (or plain Mermaid) to SVG and PNG, with the engine's report.
//
//   const renderer = await createRenderer();
//   const { svg, png, report } = await renderer.render(source, { png: true });
//   await renderer.close();
import { openRenderer } from './browser.js';

/** @typedef {import('../src/mermaid/loader.js').Report} Report */

/**
 * @typedef {object} RenderOptions
 * @property {'semantic' | 'elk'} [layout]  'elk' draws Mermaid's ELK layout, for comparison
 * @property {boolean} [colors]             automatic colours (default on)
 * @property {boolean} [png]                also return a PNG screenshot
 * @property {number | false} [fit]         width of the page the image will sit on: a narrower diagram
 *                                          is centred in a frame that wide, as GitHub centres its own
 *                                          Mermaid diagrams (default PAGE_WIDTH; false keeps the diagram's width)
 * @property {string} [candidate]           force one layout candidate (see the report's `tried` list)
 */

/** A page an image is typically read on: a GitHub README column (about 830 px) or a chat column (about 770 px). */
export const PAGE_WIDTH = 800;

/**
 * @typedef {object} Rendered
 * @property {string} svg
 * @property {Buffer} [png]
 * @property {Report | null} report  null for the 'elk' layout
 * @property {number} width
 * @property {number} height
 * @property {number} ms     time Mermaid took to parse, lay out and draw, in the page
 */

/**
 * A reusable renderer. Renders run one at a time per page; `pages` sets the parallelism.
 * @param {{ pages?: number }} [options]
 */
export async function createRenderer({ pages = 1 } = {}) {
  const renderer = await openRenderer({ pages });
  const idle = [...renderer.pages];
  /** @type {((page: any) => void)[]} */
  const waiting = [];
  const acquire = () => new Promise((resolve) => { const p = idle.pop(); if (p) resolve(p); else waiting.push(resolve); });
  const release = (page) => { const next = waiting.shift(); if (next) next(page); else idle.push(page); };

  return {
    /**
     * @param {string} source
     * @param {RenderOptions} [options]
     * @returns {Promise<Rendered>}
     */
    async render(source, options = {}) {
      const page = await acquire();
      try {
        const out = await page.evaluate(([s, o]) => /** @type {any} */ (window).renderDiagram(s, o), [source, { layout: options.layout ?? 'semantic', colors: options.colors !== false, candidate: options.candidate, fit: options.fit ?? PAGE_WIDTH }])
          .catch((/** @type {Error} */ error) => { throw new Error(cleanMermaidError(error.message)); });
        const png = options.png ? await page.locator('#stage').screenshot() : undefined;
        return { ...out, png };
      } finally {
        release(page);
      }
    },
    close: () => renderer.close(),
  };
}

/** Playwright wraps page errors; keep Mermaid's own message. */
function cleanMermaidError(message) {
  return message.replace(/^page\.evaluate:\s*(Error:\s*)?/, '').split('\n    at ')[0].trim();
}
