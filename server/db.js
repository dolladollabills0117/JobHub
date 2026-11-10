'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { SCHEMA } = require('./schema');
const { transaction } = require('./transaction');

function openDatabase(file) {
  const target = file || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'jobhub.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDatabase, transaction };
