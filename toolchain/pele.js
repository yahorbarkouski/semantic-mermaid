import { render } from '../src/pele/index.js';
import { PAGE_WIDTH } from './render.js';

/** SVG uses no browser. PNG starts Chromium only for rasterization, with networking disabled. */
export function createPeleRenderer() {
  /** @type {Promise<import('playwright').Browser> | undefined} */
  let browser;
  return {
    /** @param {string} source @param {import('./render.js').RenderOptions} [options] */
    async render(source, options = {}) {
      if (options.layout === 'elk') throw new Error('the --elk baseline uses Mermaid; omit --renderer pele');
      const fit = options.fit ?? PAGE_WIDTH;
      const started = performance.now();
      const out = await render(source, { colors: options.colors, candidate: options.candidate, maxWidth: fit || undefined });
      let { svg, width } = out;
      if (fit && width < fit) {
        // Only the trusted root's viewport changes. Nodes, routes and labels stay Pele's SVG.
        svg = svg.replace(`viewBox="0 0 ${width} ${out.height}"`, `viewBox="${-(fit - width) / 2} 0 ${fit} ${out.height}"`).replace(`width="${width}"`, `width="${fit}"`);
        width = fit;
      }
      const ms = performance.now() - started;
      /** @type {Buffer | undefined} */
      let png;
      if (options.png) {
        browser ??= import('playwright').then(({ chromium }) => chromium.launch());
        const page = await (await browser).newPage({ viewport: { width: Math.ceil(width), height: Math.ceil(out.height) }, deviceScaleFactor: 2 });
        try {
          await page.route('**/*', (route) => route.abort());
          await page.setContent('<!doctype html><style>html,body{margin:0;background:white}svg{display:block}</style>');
          // A file image must carry its CSS defaults; no host page or external resources are needed.
          await page.locator('body').evaluate((body, image) => { body.innerHTML = image; }, svg);
          png = await page.locator('svg').screenshot();
        } finally { await page.close(); }
      }
      return { ...out, svg, width, png, ms };
    },
    // A failed launch created no browser to close; preserve the original render error.
    async close() { if (browser) await browser.then((open) => open.close(), () => {}); },
  };
}
