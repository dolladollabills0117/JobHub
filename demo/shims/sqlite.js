'use strict';

/**
 * Implements the subset of node:sqlite's DatabaseSync API used by the server on top of sql.js
 * (SQLite compiled to WebAssembly). Call setSqlJs() with the initialised sql.js module first.
 */
let SQL = null;
let initialData = null;

function setSqlJs(module, data) {
  SQL = module;
  initialData = data || null;
}

function bindArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const out = {};
    for (const [k, v] of Object.entries(args[0])) out[`:${k}`] = v === undefined ? null : v;
    return out;
  }
  return args.map((v) => (v === undefined ? null : typeof v === 'bigint' ? Number(v) : v));
}

class StatementSync {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }
  _each(args, limit) {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      stmt.bind(bindArgs(args));
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
        if (rows.length === limit) break;
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
  get(...args) { return this._each(args, 1)[0]; }
  all(...args) { return this._each(args, Infinity); }
  run(...args) {
    this._each(args, Infinity);
    const changes = this.db.raw.getRowsModified();
    const id = this.db.raw.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    this.db.dirty = true;
    return { changes, lastInsertRowid: id };
  }
}

class DatabaseSync {
  constructor() {
    if (!SQL) throw new Error('sql.js not initialised');
    this.raw = initialData ? new SQL.Database(initialData) : new SQL.Database();
    this.dirty = false;
  }
  exec(sql) {
    this.raw.exec(sql);
    this.dirty = true;
  }
  prepare(sql) { return new StatementSync(this, sql); }
  export() {
    const data = this.raw.export();
    // sql.js re-opens the database on export, which resets pragmas.
    this.raw.exec('PRAGMA foreign_keys = ON;');
    return data;
  }
}

module.exports = { DatabaseSync, setSqlJs };
