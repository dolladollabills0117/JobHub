'use strict';

/**
 * Builds a self-contained, backend-free demo of JobHub into dist/demo/index.html.
 * The real API code runs in the browser on SQLite-in-WebAssembly (sql.js), so the page can be
 * hosted anywhere static, e.g. GitHub Pages. Usage: npm run build:demo
 */
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const shims = path.join(__dirname, 'shims');
const outDir = path.join(root, 'dist', 'demo');

const bundle = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'browser.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  alias: {
    express: path.join(shims, 'express.js'),
    'node:sqlite': path.join(shims, 'sqlite.js'),
    'node:crypto': path.join(shims, 'crypto.js'),
    'node:path': path.join(shims, 'path.js'),
    'node:fs': path.join(shims, 'fs.js'),
  },
  inject: [path.join(shims, 'buffer-inject.js')],
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.DB_PATH': 'undefined',
    __dirname: '"/"',
  },
  logLevel: 'warning',
}).outputFiles[0].text;

const sqlDist = path.join(path.dirname(require.resolve('sql.js')), '..', 'dist');
const sqlJs = fs.readFileSync(path.join(sqlDist, 'sql-wasm.js'), 'utf8');
const wasmB64 = fs.readFileSync(path.join(sqlDist, 'sql-wasm.wasm')).toString('base64');

const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const inline = (code) => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;

const banner = `
  <div class="demo-banner">
    <div class="container row between">
      <span><b>Live demo</b> — everything runs in your browser and is saved only on this device.
        Log in as <code>sam@example.com</code> / <code>password123</code> (or dev@, maya@, priya@, jordan@, alex@).</span>
      <button class="btn sm secondary" type="button" onclick="resetJobHubDemo()">Reset demo data</button>
    </div>
  </div>`;
const bannerCss = `
.demo-banner { background: var(--warn-soft); color: var(--text); font-size: 0.875rem; padding: 8px 0; border-bottom: 1px solid var(--border); }
.demo-banner code { background: var(--surface); padding: 1px 5px; border-radius: 4px; }`;

let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error(`build: could not find ${from}`);
  html = html.replace(from, () => to);
};
replaceOnce('<title>JobHub — Rate the hiring process</title>', '<title>JobHub Demo</title>');
replaceOnce('<link rel="stylesheet" href="/styles.css" />', `<style>${css}${bannerCss}</style>`);
replaceOnce('<header class="topbar">', `${banner}\n  <header class="topbar">`);
replaceOnce(
  '<script src="/app.js"></script>',
  [inline(sqlJs), `<script>window.__SQL_WASM_B64=${JSON.stringify(wasmB64)};</script>`, inline(bundle), inline(appJs)].join('\n')
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
console.log(`Built ${path.relative(root, path.join(outDir, 'index.html'))} (${(html.length / 1024).toFixed(0)} KB)`);
