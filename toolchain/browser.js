// A headless Chromium page with Mermaid and the semantic engine loaded, served from this package.
// Mermaid measures text with the browser, so every render goes through a real page.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
// npm may install Mermaid beside this package instead of inside it, so its files are served from
// wherever Node resolves them
const MERMAID_DIST = path.dirname(fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.esm.min.mjs')));
/** URL prefix -> directory it is served from; the first match wins */
const ROUTES = [['/mermaid/', MERMAID_DIST], ['/', PACKAGE_ROOT]];

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

/** Serve the routes on a random local port. */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
      const [prefix, dir] = ROUTES.find(([p]) => url.startsWith(p)) ?? ROUTES[ROUTES.length - 1];
      const file = path.join(dir, url.slice(prefix.length));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ port: typeof address === 'object' && address ? address.port : 0, close: () => server.close() });
    });
  });
}

/**
 * Start a renderer: one browser, `pages` tabs that each hold Mermaid and the engine.
 * @param {{ pages?: number }} [options]
 */
export async function openRenderer({ pages = 1 } = {}) {
  const server = await serve();
  /** @type {import('playwright').Browser | undefined} */
  let browser;
  try {
    browser = await chromium.launch();
    const open = browser;
    const tabs = await Promise.all(Array.from({ length: pages }, async () => {
      // PNGs at twice the CSS size, so they stay sharp on high-density screens
      const page = await open.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.port}/toolchain/page.html`);
      await page.waitForFunction(() => /** @type {any} */ (window).semanticMermaidReady === true, null, { timeout: 30000 })
        .catch(() => { throw new Error(`renderer page failed to load: ${errors.join('; ') || 'timeout'}`); });
      return page;
    }));
    return {
      pages: tabs,
      async close() {
        await open.close();
        server.close();
      },
    };
  } catch (error) {
    // nothing may outlive a failed start: an open server or browser would keep the process running
    await browser?.close();
    server.close();
    throw error;
  }
}
