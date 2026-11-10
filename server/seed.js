'use strict';

/**
 * Fills the database with fictional demo data. All companies and people are made up.
 * Usage: npm run seed            (adds demo data to data/jobhub.db if it is empty)
 *        npm run seed -- --reset (deletes the database first)
 * Every demo account's password is "password123".
 */
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./db');
const { seedDemo } = require('./demo-data');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'jobhub.db');
if (process.argv.includes('--reset')) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}
const db = openDatabase(file);

if (db.prepare('SELECT count(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data. Run `npm run seed -- --reset` to start fresh.');
  process.exit(0);
}

seedDemo(db);

console.log('Seeded demo data. Log in as maya@example.com / password123 (or dev@, priya@, sam@, jordan@, alex@).');
