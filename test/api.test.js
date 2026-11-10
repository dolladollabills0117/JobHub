'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

let server;
let base;

before(async () => {
  const app = createApp(openDatabase(':memory:'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** A tiny cookie-keeping client. */
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
  };
}

let n = 0;
async function newUser(name) {
  const c = client();
  const r = await c.post('/api/auth/register', {
    email: `user${++n}@example.com`,
    password: 'correct horse',
    display_name: name,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}

const goodReview = (companyId, extra = {}) => ({
  company_id: companyId,
  position: 'Data Analyst',
  stage_reached: 'onsite',
  outcome: 'ghosted',
  interview_rounds: 4,
  process_weeks: 6,
  difficulty: 3,
  ratings: { overall: 2, communication: 1, respect: 3, transparency: 2, timeliness: 1, fairness: 4 },
  title: 'Four rounds then silence',
  body: 'Went through four rounds including a take-home, then never heard back despite following up twice.',
  attest_hiring_process_only: true,
  ...extra,
});

test('register, login, me, logout', async () => {
  const c = await newUser('Alex');
  assert.equal((await c.get('/api/auth/me')).data.user.display_name, 'Alex');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  const bad = await c.post('/api/auth/login', { email: c.user.email, password: 'wrong password' });
  assert.equal(bad.status, 401);
  const ok = await c.post('/api/auth/login', { email: c.user.email, password: 'correct horse' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.id, c.user.id);
});

test('duplicate email and weak password are rejected', async () => {
  const c = await newUser('Dup');
  const again = await client().post('/api/auth/register', { email: c.user.email, password: '12345678', display_name: 'x' });
  assert.equal(again.status, 409);
  const weak = await client().post('/api/auth/register', { email: 'new@example.com', password: 'short', display_name: 'x' });
  assert.equal(weak.status, 400);
});

test('company reviews: scope attestation, aggregates, duplicates, anonymity', async () => {
  const a = await newUser('Reviewer A');
  const b = await newUser('Reviewer B');
  const co = await a.post('/api/companies', { name: 'Acme Corp', industry: 'Tech', website: 'acme.example' });
  assert.equal(co.status, 201);
  assert.equal(co.data.company.website, 'https://acme.example');
  const cid = co.data.company.id;

  assert.equal((await a.post('/api/companies', { name: 'acme corp' })).status, 409, 'names are case-insensitive unique');

  // Must attest that the review is about the hiring process only.
  const noAttest = await a.post('/api/reviews', goodReview(cid, { attest_hiring_process_only: false }));
  assert.equal(noAttest.status, 400);
  assert.match(noAttest.data.error, /hiring\/interview process/);

  const r1 = await a.post('/api/reviews', goodReview(cid));
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  assert.equal(r1.data.review.ghosted, true);
  assert.equal(r1.data.review.author, null, 'anonymous by default');

  assert.equal((await a.post('/api/reviews', goodReview(cid))).status, 409, 'one review per company per user');

  const r2 = await b.post(
    '/api/reviews',
    goodReview(cid, {
      outcome: 'offer_accepted',
      anonymous: false,
      ratings: { overall: 4, communication: 5, respect: 5, transparency: 4, timeliness: 3, fairness: 4 },
    })
  );
  assert.equal(r2.status, 201);
  assert.equal(r2.data.review.author.display_name, 'Reviewer B');

  const page = await client().get(`/api/companies/${cid}`);
  assert.equal(page.data.summary.count, 2);
  assert.equal(page.data.summary.ratings.overall, 3);
  assert.equal(page.data.summary.ghost_rate, 0.5);
  assert.equal(page.data.summary.offer_rate, 0.5);
  const anon = page.data.reviews.find((r) => r.id === r1.data.review.id);
  assert.equal(anon.author, null);
  assert.ok(!JSON.stringify(anon).includes('Reviewer A'), 'anonymous author name never leaks');

  // Missing ratings / too-short body.
  const c = await newUser('Reviewer C');
  const missing = await c.post('/api/reviews', goodReview(cid, { ratings: { overall: 3 } }));
  assert.equal(missing.status, 400);
  const short = await c.post('/api/reviews', goodReview(cid, { body: 'too short' }));
  assert.equal(short.status, 400);
});

test('recruiters and hiring managers can be added and rated', async () => {
  const a = await newUser('Rater');
  const cid = (await a.post('/api/companies', { name: 'Globex' })).data.company.id;
  const ct = await a.post(`/api/companies/${cid}/contacts`, { name: 'Jamie Recruiter', title: 'Talent Partner', role: 'recruiter' });
  assert.equal(ct.status, 201);
  const contactId = ct.data.contact.id;
  assert.equal((await a.post(`/api/companies/${cid}/contacts`, { name: 'x', role: 'ceo' })).status, 400);

  const r = await a.post('/api/reviews', {
    ...goodReview(cid),
    contact_id: contactId,
    outcome: 'rejected',
    ratings: { overall: 5, communication: 5, respect: 5, transparency: 4, timeliness: 5 }, // fairness optional for people
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.review.target_type, 'contact');

  const person = await client().get(`/api/contacts/${contactId}`);
  assert.equal(person.data.summary.count, 1);
  assert.equal(person.data.summary.ratings.overall, 5);

  const company = await client().get(`/api/companies/${cid}`);
  assert.equal(company.data.summary.count, 0, 'people reviews do not count toward company score');
  assert.equal(company.data.contacts[0].review_count, 1);

  // A contact from another company can't be attached.
  const other = (await a.post('/api/companies', { name: 'Initech' })).data.company.id;
  const mismatch = await a.post('/api/reviews', { ...goodReview(other), contact_id: contactId });
  assert.equal(mismatch.status, 400);
});

test('helpful votes, flags hide reviews, edit and delete own review', async () => {
  const author = await newUser('Author');
  const cid = (await author.post('/api/companies', { name: 'Hooli' })).data.company.id;
  const rid = (await author.post('/api/reviews', goodReview(cid))).data.review.id;

  assert.equal((await author.post(`/api/reviews/${rid}/helpful`)).status, 400, 'no self-votes');
  const voter = await newUser('Voter');
  assert.deepEqual((await voter.post(`/api/reviews/${rid}/helpful`)).data, { voted_helpful: true, helpful_count: 1 });
  assert.deepEqual((await voter.post(`/api/reviews/${rid}/helpful`)).data, { voted_helpful: false, helpful_count: 0 });

  const edit = await author.put(`/api/reviews/${rid}`, goodReview(cid, { title: 'Updated headline' }));
  assert.equal(edit.data.review.title, 'Updated headline');
  const intruder = await newUser('Intruder');
  assert.equal((await intruder.put(`/api/reviews/${rid}`, goodReview(cid))).status, 404);

  for (let i = 0; i < 3; i++) {
    const f = await newUser(`Flagger ${i}`);
    assert.equal((await f.post(`/api/reviews/${rid}/flag`, { reason: 'about_employment' })).status, 200);
  }
  assert.equal((await client().get(`/api/companies/${cid}`)).data.reviews.length, 0, 'hidden after 3 flags');

  assert.equal((await author.del(`/api/reviews/${rid}`)).status, 200);
  assert.equal((await client().get(`/api/reviews/${rid}`)).status, 404);
});

test('connections and employed notification fan-out', async () => {
  const sam = await newUser('Sam');
  const pat = await newUser('Pat');
  const lee = await newUser('Lee');
  const stranger = await newUser('Stranger');

  // Sam -> Pat request, Pat accepts.
  const req1 = await sam.post('/api/connections', { user_id: pat.user.id });
  assert.equal(req1.status, 201);
  assert.equal((await sam.post('/api/connections', { user_id: pat.user.id })).status, 409);
  const patInbox = await pat.get('/api/connections');
  assert.equal(patInbox.data.incoming.length, 1);
  assert.equal((await pat.post(`/api/connections/${req1.data.connection.id}/accept`)).data.connection.status, 'accepted');

  // Lee -> Sam, and Sam "requests back" which auto-accepts.
  await lee.post('/api/connections', { user_id: sam.user.id });
  assert.equal((await sam.post('/api/connections', { user_id: lee.user.id })).data.connection.status, 'accepted');

  // Stranger has a pending (not accepted) request: should NOT be notified.
  await stranger.post('/api/connections', { user_id: sam.user.id });

  const profile = await pat.get(`/api/users/${sam.user.id}`);
  assert.equal(profile.data.connection.state, 'connected');
  assert.equal(profile.data.stats.connections, 2);

  const res = await sam.post('/api/me/employment', {
    status: 'employed',
    company: 'Initrode',
    title: 'Product Designer',
    share_in_forum: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.notified, 2);
  assert.equal(res.data.user.status, 'employed');
  assert.ok(res.data.thread_id);

  for (const friend of [pat, lee]) {
    const notes = (await friend.get('/api/notifications')).data;
    const hired = notes.notifications.find((x) => x.type === 'employed');
    assert.ok(hired, 'connection got notified');
    assert.match(hired.message, /Sam landed a job as Product Designer at Initrode/);
    assert.equal(hired.link, `#/u/${sam.user.id}`);
  }
  const strangerNotes = (await stranger.get('/api/notifications')).data.notifications;
  assert.ok(!strangerNotes.some((x) => x.type === 'employed'), 'non-connections are not notified');

  // Updating details while already employed does not re-notify.
  const again = await sam.post('/api/me/employment', { status: 'employed', company: 'Initrode', title: 'Senior Product Designer' });
  assert.equal(again.data.notified, 0);

  const wins = (await client().get('/api/forum/threads?category=wins')).data.threads;
  assert.ok(wins.some((t) => t.id === res.data.thread_id));

  // Unread count + mark all read.
  assert.ok((await pat.get('/api/notifications/unread-count')).data.unread >= 1);
  await pat.post('/api/notifications/read-all');
  assert.equal((await pat.get('/api/notifications/unread-count')).data.unread, 0);

  // Back to seeking clears job info.
  const back = await sam.post('/api/me/employment', { status: 'seeking' });
  assert.equal(back.data.user.employed_company, null);
});

test('forum threads, replies, likes and reply notifications', async () => {
  const op = await newUser('Original Poster');
  const replier = await newUser('Replier');
  assert.equal((await op.post('/api/forum/threads', { category: 'nope', title: 't', body: 'b' })).status, 400);
  const t = await op.post('/api/forum/threads', { category: 'grievances', title: 'Ghosted after final round', body: 'Again.' });
  assert.equal(t.status, 201);
  const tid = t.data.thread.id;

  assert.equal((await replier.post(`/api/forum/threads/${tid}/posts`, { body: 'Same thing happened to me.' })).status, 201);
  assert.equal((await replier.post(`/api/forum/threads/${tid}/like`)).data.like_count, 1);

  const detail = await client().get(`/api/forum/threads/${tid}`);
  assert.equal(detail.data.posts.length, 1);
  assert.equal(detail.data.thread.like_count, 1);

  const notes = (await op.get('/api/notifications')).data.notifications;
  assert.ok(notes.some((x) => x.type === 'reply' && x.link === `#/forum/t/${tid}`));

  const cats = (await client().get('/api/forum/categories')).data.categories;
  const g = cats.find((c) => c.slug === 'grievances');
  assert.ok(g.thread_count >= 1 && g.reply_count >= 1);

  assert.equal((await replier.del(`/api/forum/threads/${tid}`)).status, 404, "can't delete others' threads");
  assert.equal((await op.del(`/api/forum/threads/${tid}`)).status, 200);
});

test('auth is required for writes; home endpoint works', async () => {
  const anon = client();
  assert.equal((await anon.post('/api/companies', { name: 'X' })).status, 401);
  assert.equal((await anon.post('/api/forum/threads', {})).status, 401);
  assert.equal((await anon.post('/api/me/employment', { status: 'employed' })).status, 401);
  const home = await anon.get('/api/home');
  assert.equal(home.status, 200);
  assert.ok(home.data.counts.members > 0);
  assert.equal((await anon.get('/api/nope')).status, 404);
});
