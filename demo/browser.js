'use strict';

/**
 * Browser-only demo: runs the real JobHub API (server/app.js) inside the page on top of
 * sql.js, and routes the frontend's fetch('/api/...') calls to it. Data is saved to this
 * browser's localStorage, so nothing leaves the visitor's device.
 */
const { setSqlJs } = require('./shims/sqlite');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { seedDemo } = require('../server/demo-data');

const DB_KEY = 'jobhub-demo-db-v1';
const TOKEN_KEY = 'jobhub-demo-session-v1';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: demo still works in memory */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function toBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

let token = store.get(TOKEN_KEY);

const ready = (async () => {
  const SQL = await window.initSqlJs({ wasmBinary: fromBase64(window.__SQL_WASM_B64).buffer });
  let saved = null;
  const raw = store.get(DB_KEY);
  if (raw) {
    try { saved = fromBase64(raw); } catch { saved = null; }
  }
  setSqlJs(SQL, saved);
  let db = openDatabase(':memory:');
  let users = 0;
  try { users = db.prepare('SELECT count(*) AS n FROM users').get().n; } catch { users = 0; }
  if (!users) {
    setSqlJs(SQL, null);
    db = openDatabase(':memory:');
    seedDemo(db);
    token = null;
  }
  db.dirty = true;
  return { db, app: createApp(db) };
})();

function persist(db) {
  if (!db.dirty) return;
  store.set(DB_KEY, toBase64(db.export()));
  db.dirty = false;
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const { db, app } = await ready;
  const u = new URL(url, 'http://demo.local');
  const req = {
    method: (init.method || 'GET').toUpperCase(),
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    body: init.body ? JSON.parse(init.body) : {},
    headers: { cookie: token ? `jobhub_session=${token}` : '' },
  };
  const out = await app.handle(req);
  const cookie = out.headers['set-cookie'];
  if (cookie) {
    token = cookie.split(';')[0].split('=')[1] || null;
    if (token) store.set(TOKEN_KEY, token);
    else store.remove(TOKEN_KEY);
  }
  persist(db);
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { 'content-type': 'application/json' },
  });
};

window.resetJobHubDemo = () => {
  store.remove(DB_KEY);
  store.remove(TOKEN_KEY);
  location.hash = '#/';
  location.reload();
};
