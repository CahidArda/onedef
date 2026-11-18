// Renders diagrams.mjs to SVG (light and dark) with Excalidraw's own exporter,
// in a headless browser, and writes an editable .excalidraw file for each.
//
//   node diagrams/render.mjs <dir with @excalidraw/excalidraw, esbuild, playwright>
//
// The tools aren't dependencies of the site: the SVGs are committed, so a docs
// build never runs this. See README.md.

import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { diagrams } from './diagrams.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.resolve(process.argv[2] ?? '.');
const require = createRequire(path.join(tools, 'package.json'));
const { chromium } = require('playwright');
const { build } = require('esbuild');
const excalidraw = path.join(tools, 'node_modules/@excalidraw/excalidraw');
const fonts = path.join(excalidraw, 'dist/prod/fonts');

const entry = path.join(tools, 'excalidraw-entry.js');
await writeFile(
  entry,
  "import { exportToSvg, convertToExcalidrawElements } from '@excalidraw/excalidraw'\nwindow.ex = { exportToSvg, convertToExcalidrawElements }\n",
);
const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  write: false,
  absWorkingDir: tools,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'empty', '.ttf': 'empty' },
  logLevel: 'error',
});

// Excalidraw measures text with the font it will draw: load it first, or
// labels are sized for a fallback font and come out clipped.
const faces = (await readdir(path.join(fonts, 'Excalifont')))
  .map((file) => `@font-face{font-family:Excalifont;src:url(/fonts/Excalifont/${file}) format('woff2')}`)
  .join('');
const page = `<!doctype html><meta charset="utf-8"><style>${faces}</style>
<script>window.EXCALIDRAW_ASSET_PATH = location.origin + '/';</script><script src="/bundle.js"></script>`;

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') return res.end(page);
  if (url === '/bundle.js') return res.end(bundle.outputFiles[0].contents);
  try {
    res.end(await readFile(path.join(excalidraw, 'dist/prod', url)));
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.goto(origin);
await tab.evaluate(() => document.fonts.load('20px Excalifont'));

const out = path.join(here, '../public/diagrams');
await mkdir(out, { recursive: true });
for (const [name, skeleton] of Object.entries(diagrams)) {
  const result = await tab.evaluate(async (skeleton) => {
    const elements = window.ex.convertToExcalidrawElements(skeleton, { regenerateIds: false });
    const svg = async (dark) =>
      (
        await window.ex.exportToSvg({
          elements,
          appState: { exportBackground: false, exportWithDarkMode: dark, exportPadding: 16 },
          files: null,
        })
      ).outerHTML;
    return { elements, light: await svg(false), dark: await svg(true) };
  }, skeleton);
  await writeFile(path.join(out, `${name}.svg`), result.light);
  await writeFile(path.join(out, `${name}-dark.svg`), result.dark);
  await writeFile(
    path.join(here, `${name}.excalidraw`),
    JSON.stringify({ type: 'excalidraw', version: 2, source: 'onedef docs', elements: result.elements, appState: {}, files: {} }, null, 1),
  );
  console.log('rendered', name);
}
await browser.close();
server.close();
