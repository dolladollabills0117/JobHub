'use strict';

const path = require('node:path');
const express = require('express');
const { transaction } = require('./transaction');
const auth = require('./auth');
const C = require('./constants');
const { HttpError, bad, str, int, oneOf, bool, id } = require('./validate');

const VISIBLE = `(SELECT count(*) FROM review_flags f WHERE f.review_id = r.id) < ${C.FLAG_HIDE_THRESHOLD}`;
const values = (list) => list.map((x) => x.value);

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    display_name: u.display_name,
    headline: u.headline,
    bio: u.bio,
    location: u.location,
    target_role: u.target_role,
    status: u.status,
    employed_company: u.employed_company,
    employed_title: u.employed_title,
    employed_at: u.employed_at,
    created_at: u.created_at,
  };
}

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(auth.loadUser(db));
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';

  // Small wrapper so thrown HttpErrors become JSON responses.
  const h = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  // ---------- notifications helper ----------
  const insertNotification = db.prepare(
    'INSERT INTO notifications (user_id, actor_id, type, message, link) VALUES (?, ?, ?, ?, ?)'
  );
  const notify = (userId, actorId, type, message, link = '') =>
    insertNotification.run(userId, actorId, type, message, link);

  const connectedUserIds = (userId) =>
    db
      .prepare(
        `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
         FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
      )
      .all(userId, userId, userId)
      .map((r) => r.id);

  // ---------- reviews helpers ----------
  const REVIEW_SELECT = `
    SELECT r.*, u.display_name AS author_name, u.status AS author_status,
           co.name AS company_name, ct.name AS contact_name, ct.role AS contact_role, ct.title AS contact_title,
           (SELECT count(*) FROM review_votes v WHERE v.review_id = r.id) AS helpful_count,
           EXISTS (SELECT 1 FROM review_votes v WHERE v.review_id = r.id AND v.user_id = :viewer) AS voted,
           EXISTS (SELECT 1 FROM review_flags f WHERE f.review_id = r.id AND f.user_id = :viewer) AS flagged
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN companies co ON co.id = r.company_id
    LEFT JOIN contacts ct ON ct.id = r.contact_id`;

  function shapeReview(r, viewerId) {
    return {
      id: r.id,
      target_type: r.target_type,
      company: { id: r.company_id, name: r.company_name },
      contact: r.contact_id ? { id: r.contact_id, name: r.contact_name, role: r.contact_role, title: r.contact_title } : null,
      position: r.position,
      stage_reached: r.stage_reached,
      outcome: r.outcome,
      ghosted: !!r.ghosted,
      interview_rounds: r.interview_rounds,
      process_weeks: r.process_weeks,
      difficulty: r.difficulty,
      ratings: {
        overall: r.rating_overall,
        communication: r.rating_communication,
        respect: r.rating_respect,
        transparency: r.rating_transparency,
        timeliness: r.rating_timeliness,
        fairness: r.rating_fairness,
      },
      title: r.title,
      body: r.body,
      process_date: r.process_date,
      created_at: r.created_at,
      updated_at: r.updated_at,
      helpful_count: r.helpful_count,
      voted_helpful: !!r.voted,
      flagged_by_me: !!r.flagged,
      is_mine: viewerId === r.user_id,
      anonymous: !!r.anonymous,
      // Never reveal who wrote an anonymous review.
      author: r.anonymous ? null : { id: r.user_id, display_name: r.author_name, status: r.author_status },
    };
  }

  function listReviews(where, params, viewerId, { order = 'r.created_at DESC, r.id DESC', limit = 100 } = {}) {
    const rows = db
      .prepare(`${REVIEW_SELECT} WHERE ${where} AND ${VISIBLE} ORDER BY ${order} LIMIT ${Number(limit)}`)
      .all({ ...params, viewer: viewerId || 0 });
    return rows.map((r) => shapeReview(r, viewerId));
  }

  function aggregate(where, params) {
    const row = db
      .prepare(
        `SELECT count(*) AS count,
                avg(rating_overall) AS overall, avg(rating_communication) AS communication,
                avg(rating_respect) AS respect, avg(rating_transparency) AS transparency,
                avg(rating_timeliness) AS timeliness, avg(rating_fairness) AS fairness,
                avg(ghosted) AS ghost_rate,
                avg(outcome IN ('offer_accepted', 'offer_declined')) AS offer_rate,
                avg(interview_rounds) AS avg_rounds, avg(process_weeks) AS avg_weeks,
                avg(difficulty) AS avg_difficulty
         FROM reviews r WHERE ${where} AND ${VISIBLE}`
      )
      .get(params);
    const outcomes = db
      .prepare(`SELECT outcome, count(*) AS n FROM reviews r WHERE ${where} AND ${VISIBLE} GROUP BY outcome`)
      .all(params);
    const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
    return {
      count: row.count,
      ratings: {
        overall: round(row.overall),
        communication: round(row.communication),
        respect: round(row.respect),
        transparency: round(row.transparency),
        timeliness: round(row.timeliness),
        fairness: round(row.fairness),
      },
      ghost_rate: round(row.ghost_rate, 3),
      offer_rate: round(row.offer_rate, 3),
      avg_rounds: round(row.avg_rounds, 1),
      avg_weeks: round(row.avg_weeks, 1),
      avg_difficulty: round(row.avg_difficulty, 1),
      outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])),
    };
  }

  function parseReviewInput(body, targetType) {
    if (!bool(body.attest_hiring_process_only)) {
      throw bad(
        'Please confirm your review is only about the hiring/interview process — not about working there.'
      );
    }
    const dims = targetType === 'company' ? C.COMPANY_DIMENSIONS : C.CONTACT_DIMENSIONS;
    const ratings = body.ratings || {};
    const r = {};
    for (const d of dims) {
      r[d.key] = int(ratings[d.key], `${d.label} rating`, { required: d.required, min: 1, max: 5 });
    }
    const outcome = oneOf(body.outcome, 'Outcome', values(C.OUTCOMES));
    const processDate = str(body.process_date, 'Process date', { max: 7 });
    if (processDate && !/^\d{4}-(0[1-9]|1[0-2])$/.test(processDate)) throw bad('Process date must look like YYYY-MM.');
    return {
      position: str(body.position, 'Position', { max: 120 }),
      stage_reached: oneOf(body.stage_reached, 'Stage reached', values(C.STAGES)),
      outcome,
      ghosted: outcome === 'ghosted' || bool(body.ghosted) ? 1 : 0,
      interview_rounds: int(body.interview_rounds, 'Interview rounds', { min: 0, max: 30 }),
      process_weeks: int(body.process_weeks, 'Process length (weeks)', { min: 0, max: 104 }),
      difficulty: int(body.difficulty, 'Difficulty', { min: 1, max: 5 }),
      ratings: r,
      title: str(body.title, 'Headline', { required: true, max: 120 }),
      body: str(body.body, 'Review', { required: true, min: 30, max: 5000 }),
      anonymous: body.anonymous === undefined ? 1 : bool(body.anonymous) ? 1 : 0,
      process_date: processDate || null,
    };
  }

  // =====================================================================
  // Meta
  // =====================================================================
  app.get(
    '/api/meta',
    h(() => ({
      stages: C.STAGES,
      outcomes: C.OUTCOMES,
      contact_roles: C.CONTACT_ROLES,
      company_dimensions: C.COMPANY_DIMENSIONS,
      contact_dimensions: C.CONTACT_DIMENSIONS,
      forum_categories: C.FORUM_CATEGORIES,
      flag_reasons: C.FLAG_REASONS,
    }))
  );

  // =====================================================================
  // Auth
  // =====================================================================
  app.post(
    '/api/auth/register',
    h((req, res) => {
      const email = str(req.body.email, 'Email', { required: true, max: 200 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Please enter a valid email.');
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      if (password.length < 8) throw bad('Password must be at least 8 characters.');
      const displayName = str(req.body.display_name, 'Display name', { required: true, max: 60 });
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw new HttpError(409, 'An account with that email already exists.');
      }
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO users (email, password_hash, display_name, headline, target_role, location) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(
          email,
          auth.hashPassword(password),
          displayName,
          str(req.body.headline, 'Headline', { max: 120 }),
          str(req.body.target_role, 'Target role', { max: 120 }),
          str(req.body.location, 'Location', { max: 120 })
        );
      const token = auth.createSession(db, lastInsertRowid);
      res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: secureCookies }));
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
      res.status(201);
      return { user: { ...publicUser(user), email: user.email } };
    })
  );

  app.post(
    '/api/auth/login',
    h((req, res) => {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !auth.verifyPassword(password, user.password_hash)) {
        throw new HttpError(401, 'Incorrect email or password.');
      }
      const token = auth.createSession(db, user.id);
      res.setHeader('Set-Cookie', auth.sessionCookie(token, { secure: secureCookies }));
      return { user: { ...publicUser(user), email: user.email } };
    })
  );

  app.post(
    '/api/auth/logout',
    h((req, res) => {
      if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
      res.setHeader('Set-Cookie', auth.clearCookie());
      return { ok: true };
    })
  );

  app.get(
    '/api/auth/me',
    h((req) => ({ user: req.user ? { ...publicUser(req.user), email: req.user.email } : null }))
  );

  // =====================================================================
  // Profile & employment
  // =====================================================================
  app.patch(
    '/api/me',
    auth.requireAuth,
    h((req) => {
      const b = req.body;
      const u = req.user;
      const next = {
        display_name: b.display_name !== undefined ? str(b.display_name, 'Display name', { required: true, max: 60 }) : u.display_name,
        headline: b.headline !== undefined ? str(b.headline, 'Headline', { max: 120 }) : u.headline,
        bio: b.bio !== undefined ? str(b.bio, 'Bio', { max: 2000 }) : u.bio,
        location: b.location !== undefined ? str(b.location, 'Location', { max: 120 }) : u.location,
        target_role: b.target_role !== undefined ? str(b.target_role, 'Target role', { max: 120 }) : u.target_role,
      };
      db.prepare(
        'UPDATE users SET display_name = ?, headline = ?, bio = ?, location = ?, target_role = ? WHERE id = ?'
      ).run(next.display_name, next.headline, next.bio, next.location, next.target_role, u.id);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
      return { user: { ...publicUser(user), email: user.email } };
    })
  );

  /**
   * Mark yourself employed (or back to job seeking). Going from seeking -> employed notifies
   * every accepted connection, and can optionally post to the Wins forum.
   */
  app.post(
    '/api/me/employment',
    auth.requireAuth,
    h((req) => {
      const u = req.user;
      const status = oneOf(req.body.status, 'Status', ['seeking', 'employed']);
      let notified = 0;
      let threadId = null;

      transaction(db, () => {
        if (status === 'seeking') {
          db.prepare(
            "UPDATE users SET status = 'seeking', employed_company = NULL, employed_title = NULL, employed_at = NULL WHERE id = ?"
          ).run(u.id);
          return;
        }
        const company = str(req.body.company, 'Company', { max: 120 });
        const title = str(req.body.title, 'Job title', { max: 120 });
        const wasEmployed = u.status === 'employed';
        db.prepare(
          "UPDATE users SET status = 'employed', employed_company = ?, employed_title = ?, employed_at = COALESCE(?, datetime('now')) WHERE id = ?"
        ).run(company || null, title || null, wasEmployed ? u.employed_at : null, u.id);

        if (wasEmployed) return; // only announce the transition once

        const where = [title, company].filter(Boolean).join(' at ');
        const message = `${u.display_name} landed a job${where ? ` as ${where}` : ''}! 🎉 Send them a congrats.`;
        for (const friendId of connectedUserIds(u.id)) {
          notify(friendId, u.id, 'employed', message, `#/u/${u.id}`);
          notified++;
        }

        if (bool(req.body.share_in_forum)) {
          const note = str(req.body.message, 'Message', { max: 2000 });
          const threadTitle = `I got hired${where ? `: ${where}` : ''}!`;
          const threadBody = note || `After the grind, I finally landed a role${where ? ` as ${where}` : ''}. Thanks for all the support here — keep going, everyone!`;
          threadId = Number(
            db
              .prepare("INSERT INTO threads (user_id, category, title, body) VALUES (?, 'wins', ?, ?)")
              .run(u.id, threadTitle.slice(0, 150), threadBody).lastInsertRowid
          );
        }
      });

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
      return { user: { ...publicUser(user), email: user.email }, notified, thread_id: threadId };
    })
  );

  // =====================================================================
  // Members & connections
  // =====================================================================
  function connectionBetween(a, b) {
    return db
      .prepare(
        `SELECT * FROM connections
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      )
      .get(a, b, b, a);
  }

  function connectionState(viewer, otherId) {
    if (!viewer) return { state: 'anonymous' };
    if (viewer.id === otherId) return { state: 'self' };
    const c = connectionBetween(viewer.id, otherId);
    if (!c) return { state: 'none' };
    if (c.status === 'accepted') return { state: 'connected', connection_id: c.id };
    return { state: c.requester_id === viewer.id ? 'pending_outgoing' : 'pending_incoming', connection_id: c.id };
  }

  app.get(
    '/api/users',
    h((req) => {
      const q = String(req.query.q || '').trim();
      const status = ['seeking', 'employed'].includes(req.query.status) ? req.query.status : null;
      const rows = db
        .prepare(
          `SELECT * FROM users
           WHERE (:q = '' OR display_name LIKE :like OR headline LIKE :like OR target_role LIKE :like OR location LIKE :like)
             AND (:status IS NULL OR status = :status)
           ORDER BY created_at DESC, id DESC LIMIT 100`
        )
        .all({ q, like: `%${q}%`, status });
      return {
        users: rows.map((u) => ({ ...publicUser(u), connection: connectionState(req.user, u.id) })),
      };
    })
  );

  app.get(
    '/api/users/:id',
    h((req) => {
      const userId = id(req.params.id);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!u) throw new HttpError(404, 'Member not found.');
      const stats = db
        .prepare(
          `SELECT
             (SELECT count(*) FROM reviews WHERE user_id = :id) AS reviews,
             (SELECT count(*) FROM threads WHERE user_id = :id) AS threads,
             (SELECT count(*) FROM posts WHERE user_id = :id) AS replies,
             (SELECT count(*) FROM connections WHERE status = 'accepted' AND (requester_id = :id OR addressee_id = :id)) AS connections`
        )
        .get({ id: userId });
      // Only the member's non-anonymous reviews are listed publicly (all of them when viewing yourself).
      const isSelf = req.user && req.user.id === userId;
      const reviews = listReviews(
        isSelf ? 'r.user_id = :uid' : 'r.user_id = :uid AND r.anonymous = 0',
        { uid: userId },
        req.user && req.user.id,
        { limit: 50 }
      );
      const threads = db
        .prepare(
          `SELECT t.id, t.title, t.category, t.created_at,
                  (SELECT count(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count
           FROM threads t WHERE t.user_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 20`
        )
        .all(userId);
      return { user: publicUser(u), stats, connection: connectionState(req.user, userId), reviews, threads };
    })
  );

  app.get(
    '/api/connections',
    auth.requireAuth,
    h((req) => {
      const me = req.user.id;
      const rows = db
        .prepare(
          `SELECT c.*, u.id AS other_id FROM connections c
           JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
           WHERE c.requester_id = ? OR c.addressee_id = ?
           ORDER BY COALESCE(c.responded_at, c.created_at) DESC`
        )
        .all(me, me, me);
      const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
      const out = { connections: [], incoming: [], outgoing: [] };
      for (const c of rows) {
        const entry = { id: c.id, created_at: c.created_at, user: publicUser(getUser.get(c.other_id)) };
        if (c.status === 'accepted') out.connections.push(entry);
        else if (c.addressee_id === me) out.incoming.push(entry);
        else out.outgoing.push(entry);
      }
      return out;
    })
  );

  app.post(
    '/api/connections',
    auth.requireAuth,
    h((req, res) => {
      const otherId = id(req.body.user_id);
      if (otherId === req.user.id) throw bad("You can't connect with yourself.");
      const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
      if (!other) throw new HttpError(404, 'Member not found.');
      const existing = connectionBetween(req.user.id, otherId);
      if (existing) {
        // If they already asked us, sending a request back just accepts theirs.
        if (existing.status === 'pending' && existing.addressee_id === req.user.id) {
          return acceptConnection(existing, req.user);
        }
        throw new HttpError(409, existing.status === 'accepted' ? 'You are already connected.' : 'Request already sent.');
      }
      const { lastInsertRowid } = db
        .prepare('INSERT INTO connections (requester_id, addressee_id) VALUES (?, ?)')
        .run(req.user.id, otherId);
      notify(otherId, req.user.id, 'connection_request', `${req.user.display_name} wants to connect with you.`, '#/network');
      res.status(201);
      return { connection: { id: Number(lastInsertRowid), status: 'pending' } };
    })
  );

  function acceptConnection(c, user) {
    db.prepare("UPDATE connections SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(c.id);
    notify(c.requester_id, user.id, 'connection_accepted', `${user.display_name} accepted your connection request.`, `#/u/${user.id}`);
    return { connection: { id: c.id, status: 'accepted' } };
  }

  app.post(
    '/api/connections/:id/accept',
    auth.requireAuth,
    h((req) => {
      const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(id(req.params.id));
      if (!c || c.addressee_id !== req.user.id) throw new HttpError(404, 'Request not found.');
      if (c.status === 'accepted') return { connection: { id: c.id, status: 'accepted' } };
      return acceptConnection(c, req.user);
    })
  );

  // Decline an incoming request, cancel an outgoing one, or remove a connection.
  app.delete(
    '/api/connections/:id',
    auth.requireAuth,
    h((req) => {
      const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(id(req.params.id));
      if (!c || (c.requester_id !== req.user.id && c.addressee_id !== req.user.id)) {
        throw new HttpError(404, 'Connection not found.');
      }
      db.prepare('DELETE FROM connections WHERE id = ?').run(c.id);
      return { ok: true };
    })
  );

  // =====================================================================
  // Notifications
  // =====================================================================
  app.get(
    '/api/notifications',
    auth.requireAuth,
    h((req) => {
      const rows = db
        .prepare(
          `SELECT n.*, u.display_name AS actor_name FROM notifications n
           LEFT JOIN users u ON u.id = n.actor_id
           WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`
        )
        .all(req.user.id);
      const unread = db
        .prepare('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
        .get(req.user.id).n;
      return {
        unread,
        notifications: rows.map((n) => ({
          id: n.id,
          type: n.type,
          message: n.message,
          link: n.link,
          read: !!n.read_at,
          created_at: n.created_at,
          actor: n.actor_id ? { id: n.actor_id, display_name: n.actor_name } : null,
        })),
      };
    })
  );

  app.get(
    '/api/notifications/unread-count',
    h((req) => {
      if (!req.user) return { unread: 0 };
      return {
        unread: db
          .prepare('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
          .get(req.user.id).n,
      };
    })
  );

  app.post(
    '/api/notifications/read-all',
    auth.requireAuth,
    h((req) => {
      db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
      return { ok: true };
    })
  );

  app.post(
    '/api/notifications/:id/read',
    auth.requireAuth,
    h((req) => {
      db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?").run(
        id(req.params.id),
        req.user.id
      );
      return { ok: true };
    })
  );

  // =====================================================================
  // Companies & contacts (recruiters / hiring managers)
  // =====================================================================
  const COMPANY_SORTS = {
    reviews: 'review_count DESC, overall DESC, c.name',
    top: '(review_count > 0) DESC, overall DESC, review_count DESC, c.name',
    worst: '(review_count > 0) DESC, overall ASC, review_count DESC, c.name',
    ghosting: '(review_count > 0) DESC, ghost_rate DESC, review_count DESC, c.name',
    name: 'c.name COLLATE NOCASE',
    recent: 'c.created_at DESC, c.id DESC',
  };

  app.get(
    '/api/companies',
    h((req) => {
      const q = String(req.query.q || '').trim();
      const sort = COMPANY_SORTS[req.query.sort] || COMPANY_SORTS.reviews;
      const rows = db
        .prepare(
          `SELECT c.*, coalesce(a.review_count, 0) AS review_count, a.overall, a.ghost_rate,
                  (SELECT count(*) FROM contacts ct WHERE ct.company_id = c.id) AS contact_count
           FROM companies c
           LEFT JOIN (
             SELECT company_id, count(*) AS review_count, avg(rating_overall) AS overall, avg(ghosted) AS ghost_rate
             FROM reviews r WHERE target_type = 'company' AND ${VISIBLE} GROUP BY company_id
           ) a ON a.company_id = c.id
           WHERE (:q = '' OR c.name LIKE :like OR c.industry LIKE :like OR c.location LIKE :like)
           ORDER BY ${sort} LIMIT 200`
        )
        .all({ q, like: `%${q}%` });
      return {
        companies: rows.map((c) => ({
          id: c.id,
          name: c.name,
          industry: c.industry,
          location: c.location,
          website: c.website,
          review_count: c.review_count,
          overall: c.overall == null ? null : Math.round(c.overall * 100) / 100,
          ghost_rate: c.ghost_rate == null ? null : Math.round(c.ghost_rate * 1000) / 1000,
          contact_count: c.contact_count,
        })),
      };
    })
  );

  app.post(
    '/api/companies',
    auth.requireAuth,
    h((req, res) => {
      const name = str(req.body.name, 'Company name', { required: true, max: 120 });
      const existing = db.prepare('SELECT id FROM companies WHERE name = ?').get(name);
      if (existing) {
        res.status(409);
        return { error: 'That company is already listed.', company_id: existing.id };
      }
      let website = str(req.body.website, 'Website', { max: 200 });
      if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
      const { lastInsertRowid } = db
        .prepare('INSERT INTO companies (name, industry, website, location, description, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          name,
          str(req.body.industry, 'Industry', { max: 80 }),
          website,
          str(req.body.location, 'Location', { max: 120 }),
          str(req.body.description, 'Description', { max: 1000 }),
          req.user.id
        );
      res.status(201);
      return { company: db.prepare('SELECT * FROM companies WHERE id = ?').get(lastInsertRowid) };
    })
  );

  function contactSummaries(companyId) {
    return db
      .prepare(
        `SELECT ct.*, count(r.id) AS review_count, avg(r.rating_overall) AS overall
         FROM contacts ct
         LEFT JOIN reviews r ON r.contact_id = ct.id AND ${VISIBLE}
         WHERE ct.company_id = ?
         GROUP BY ct.id ORDER BY review_count DESC, ct.name`
      )
      .all(companyId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        role: c.role,
        review_count: c.review_count,
        overall: c.overall == null ? null : Math.round(c.overall * 100) / 100,
      }));
  }

  app.get(
    '/api/companies/:id',
    h((req) => {
      const companyId = id(req.params.id);
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
      if (!company) throw new HttpError(404, 'Company not found.');
      const viewer = req.user && req.user.id;
      const sort = req.query.sort === 'helpful' ? 'helpful_count DESC, r.created_at DESC' : undefined;
      return {
        company,
        summary: aggregate("r.company_id = :cid AND r.target_type = 'company'", { cid: companyId }),
        people_summary: aggregate("r.company_id = :cid AND r.target_type = 'contact'", { cid: companyId }),
        contacts: contactSummaries(companyId),
        reviews: listReviews("r.company_id = :cid AND r.target_type = 'company'", { cid: companyId }, viewer, sort ? { order: sort } : {}),
        my_review_id: viewer
          ? db
              .prepare("SELECT id FROM reviews WHERE user_id = ? AND company_id = ? AND target_type = 'company'")
              .get(viewer, companyId)?.id ?? null
          : null,
        threads: db
          .prepare(
            `SELECT t.id, t.title, t.category, t.created_at FROM threads t
             WHERE t.company_id = ? ORDER BY t.last_activity_at DESC LIMIT 10`
          )
          .all(companyId),
      };
    })
  );

  app.post(
    '/api/companies/:id/contacts',
    auth.requireAuth,
    h((req, res) => {
      const companyId = id(req.params.id);
      if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) throw new HttpError(404, 'Company not found.');
      const name = str(req.body.name, 'Name', { required: true, max: 80 });
      const existing = db.prepare('SELECT id FROM contacts WHERE company_id = ? AND name = ?').get(companyId, name);
      if (existing) {
        res.status(409);
        return { error: 'That person is already listed for this company.', contact_id: existing.id };
      }
      const { lastInsertRowid } = db
        .prepare('INSERT INTO contacts (company_id, name, title, role, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(
          companyId,
          name,
          str(req.body.title, 'Title', { max: 120 }),
          oneOf(req.body.role, 'Role', values(C.CONTACT_ROLES)),
          req.user.id
        );
      res.status(201);
      return { contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(lastInsertRowid) };
    })
  );

  app.get(
    '/api/contacts/:id',
    h((req) => {
      const contactId = id(req.params.id);
      const contact = db
        .prepare('SELECT ct.*, c.name AS company_name FROM contacts ct JOIN companies c ON c.id = ct.company_id WHERE ct.id = ?')
        .get(contactId);
      if (!contact) throw new HttpError(404, 'Person not found.');
      const viewer = req.user && req.user.id;
      return {
        contact,
        summary: aggregate('r.contact_id = :id', { id: contactId }),
        reviews: listReviews('r.contact_id = :id', { id: contactId }, viewer),
        my_review_id: viewer
          ? db.prepare('SELECT id FROM reviews WHERE user_id = ? AND contact_id = ?').get(viewer, contactId)?.id ?? null
          : null,
      };
    })
  );

  // =====================================================================
  // Reviews
  // =====================================================================
  app.get(
    '/api/reviews/:id',
    h((req) => {
      const [review] = listReviews('r.id = :id', { id: id(req.params.id) }, req.user && req.user.id);
      if (!review) throw new HttpError(404, 'Review not found.');
      return { review };
    })
  );

  app.post(
    '/api/reviews',
    auth.requireAuth,
    h((req, res) => {
      const companyId = id(req.body.company_id);
      if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) throw new HttpError(404, 'Company not found.');
      let contactId = null;
      if (req.body.contact_id) {
        contactId = id(req.body.contact_id);
        const ct = db.prepare('SELECT company_id FROM contacts WHERE id = ?').get(contactId);
        if (!ct || ct.company_id !== companyId) throw bad('That person is not listed under this company.');
      }
      const targetType = contactId ? 'contact' : 'company';
      const dup = contactId
        ? db.prepare('SELECT id FROM reviews WHERE user_id = ? AND contact_id = ?').get(req.user.id, contactId)
        : db.prepare("SELECT id FROM reviews WHERE user_id = ? AND company_id = ? AND target_type = 'company'").get(req.user.id, companyId);
      if (dup) {
        res.status(409);
        return { error: 'You already reviewed this. You can edit your existing review instead.', review_id: dup.id };
      }
      const v = parseReviewInput(req.body, targetType);
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO reviews (user_id, company_id, contact_id, target_type, position, stage_reached, outcome, ghosted,
             interview_rounds, process_weeks, difficulty, rating_overall, rating_communication, rating_respect,
             rating_transparency, rating_timeliness, rating_fairness, title, body, anonymous, process_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user.id, companyId, contactId, targetType, v.position, v.stage_reached, v.outcome, v.ghosted,
          v.interview_rounds, v.process_weeks, v.difficulty, v.ratings.overall, v.ratings.communication, v.ratings.respect,
          v.ratings.transparency, v.ratings.timeliness, v.ratings.fairness, v.title, v.body, v.anonymous, v.process_date
        );
      const [review] = listReviews('r.id = :id', { id: lastInsertRowid }, req.user.id);
      res.status(201);
      return { review };
    })
  );

  function ownReview(req) {
    const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id(req.params.id));
    if (!r || r.user_id !== req.user.id) throw new HttpError(404, 'Review not found.');
    return r;
  }

  app.put(
    '/api/reviews/:id',
    auth.requireAuth,
    h((req) => {
      const existing = ownReview(req);
      const v = parseReviewInput(req.body, existing.target_type);
      db.prepare(
        `UPDATE reviews SET position = ?, stage_reached = ?, outcome = ?, ghosted = ?, interview_rounds = ?, process_weeks = ?,
           difficulty = ?, rating_overall = ?, rating_communication = ?, rating_respect = ?, rating_transparency = ?,
           rating_timeliness = ?, rating_fairness = ?, title = ?, body = ?, anonymous = ?, process_date = ?,
           updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        v.position, v.stage_reached, v.outcome, v.ghosted, v.interview_rounds, v.process_weeks, v.difficulty,
        v.ratings.overall, v.ratings.communication, v.ratings.respect, v.ratings.transparency, v.ratings.timeliness,
        v.ratings.fairness, v.title, v.body, v.anonymous, v.process_date, existing.id
      );
      // Show the author their review even if it has been flagged.
      const row = db.prepare(`${REVIEW_SELECT} WHERE r.id = :id`).get({ id: existing.id, viewer: req.user.id });
      return { review: shapeReview(row, req.user.id) };
    })
  );

  app.delete(
    '/api/reviews/:id',
    auth.requireAuth,
    h((req) => {
      const r = ownReview(req);
      db.prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
      return { ok: true };
    })
  );

  app.post(
    '/api/reviews/:id/helpful',
    auth.requireAuth,
    h((req) => {
      const reviewId = id(req.params.id);
      const r = db.prepare('SELECT user_id FROM reviews WHERE id = ?').get(reviewId);
      if (!r) throw new HttpError(404, 'Review not found.');
      if (r.user_id === req.user.id) throw bad("You can't mark your own review as helpful.");
      const had = db.prepare('SELECT 1 FROM review_votes WHERE review_id = ? AND user_id = ?').get(reviewId, req.user.id);
      if (had) db.prepare('DELETE FROM review_votes WHERE review_id = ? AND user_id = ?').run(reviewId, req.user.id);
      else db.prepare('INSERT INTO review_votes (review_id, user_id) VALUES (?, ?)').run(reviewId, req.user.id);
      const count = db.prepare('SELECT count(*) AS n FROM review_votes WHERE review_id = ?').get(reviewId).n;
      return { voted_helpful: !had, helpful_count: count };
    })
  );

  app.post(
    '/api/reviews/:id/flag',
    auth.requireAuth,
    h((req) => {
      const reviewId = id(req.params.id);
      const r = db.prepare('SELECT user_id FROM reviews WHERE id = ?').get(reviewId);
      if (!r) throw new HttpError(404, 'Review not found.');
      if (r.user_id === req.user.id) throw bad("You can't flag your own review.");
      const reason = oneOf(req.body.reason, 'Reason', values(C.FLAG_REASONS));
      db.prepare('INSERT OR REPLACE INTO review_flags (review_id, user_id, reason) VALUES (?, ?, ?)').run(reviewId, req.user.id, reason);
      return { ok: true };
    })
  );

  // =====================================================================
  // Forum
  // =====================================================================
  const categorySlugs = C.FORUM_CATEGORIES.map((c) => c.slug);

  app.get(
    '/api/forum/categories',
    h(() => {
      const counts = Object.fromEntries(
        db
          .prepare(
            `SELECT category, count(*) AS threads, max(last_activity_at) AS last_activity,
                    (SELECT count(*) FROM posts p JOIN threads t2 ON t2.id = p.thread_id WHERE t2.category = t.category) AS replies
             FROM threads t GROUP BY category`
          )
          .all()
          .map((r) => [r.category, r])
      );
      return {
        categories: C.FORUM_CATEGORIES.map((c) => ({
          ...c,
          thread_count: counts[c.slug]?.threads ?? 0,
          reply_count: counts[c.slug]?.replies ?? 0,
          last_activity: counts[c.slug]?.last_activity ?? null,
        })),
      };
    })
  );

  const THREAD_SELECT = `
    SELECT t.*, u.display_name AS author_name, u.status AS author_status, co.name AS company_name,
           (SELECT count(*) FROM posts p WHERE p.thread_id = t.id) AS reply_count,
           (SELECT count(*) FROM thread_likes l WHERE l.thread_id = t.id) AS like_count,
           EXISTS (SELECT 1 FROM thread_likes l WHERE l.thread_id = t.id AND l.user_id = :viewer) AS liked
    FROM threads t JOIN users u ON u.id = t.user_id LEFT JOIN companies co ON co.id = t.company_id`;

  const shapeThread = (t, viewerId) => ({
    id: t.id,
    category: t.category,
    title: t.title,
    body: t.body,
    created_at: t.created_at,
    last_activity_at: t.last_activity_at,
    reply_count: t.reply_count,
    like_count: t.like_count,
    liked: !!t.liked,
    is_mine: viewerId === t.user_id,
    author: { id: t.user_id, display_name: t.author_name, status: t.author_status },
    company: t.company_id ? { id: t.company_id, name: t.company_name } : null,
  });

  app.get(
    '/api/forum/threads',
    h((req) => {
      const category = categorySlugs.includes(req.query.category) ? req.query.category : null;
      const q = String(req.query.q || '').trim();
      const viewer = req.user ? req.user.id : 0;
      const order = req.query.sort === 'top' ? 'like_count DESC, reply_count DESC, t.last_activity_at DESC' : 't.last_activity_at DESC, t.id DESC';
      const rows = db
        .prepare(
          `${THREAD_SELECT}
           WHERE (:category IS NULL OR t.category = :category)
             AND (:q = '' OR t.title LIKE :like OR t.body LIKE :like)
           ORDER BY ${order} LIMIT 100`
        )
        .all({ category, q, like: `%${q}%`, viewer });
      return { threads: rows.map((t) => shapeThread(t, viewer)) };
    })
  );

  app.post(
    '/api/forum/threads',
    auth.requireAuth,
    h((req, res) => {
      const category = oneOf(req.body.category, 'Category', categorySlugs);
      const title = str(req.body.title, 'Title', { required: true, max: 150 });
      const body = str(req.body.body, 'Post', { required: true, max: 10000 });
      let companyId = null;
      if (req.body.company_id) {
        companyId = id(req.body.company_id);
        if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) throw bad('Unknown company.');
      }
      const { lastInsertRowid } = db
        .prepare('INSERT INTO threads (user_id, category, title, body, company_id) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, category, title, body, companyId);
      res.status(201);
      return { thread: { id: Number(lastInsertRowid) } };
    })
  );

  app.get(
    '/api/forum/threads/:id',
    h((req) => {
      const viewer = req.user ? req.user.id : 0;
      const t = db.prepare(`${THREAD_SELECT} WHERE t.id = :id`).get({ id: id(req.params.id), viewer });
      if (!t) throw new HttpError(404, 'Thread not found.');
      const posts = db
        .prepare(
          `SELECT p.*, u.display_name AS author_name, u.status AS author_status
           FROM posts p JOIN users u ON u.id = p.user_id WHERE p.thread_id = ? ORDER BY p.id`
        )
        .all(t.id)
        .map((p) => ({
          id: p.id,
          body: p.body,
          created_at: p.created_at,
          is_mine: viewer === p.user_id,
          author: { id: p.user_id, display_name: p.author_name, status: p.author_status },
        }));
      return { thread: shapeThread(t, viewer), posts };
    })
  );

  app.post(
    '/api/forum/threads/:id/posts',
    auth.requireAuth,
    h((req, res) => {
      const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(id(req.params.id));
      if (!t) throw new HttpError(404, 'Thread not found.');
      const body = str(req.body.body, 'Reply', { required: true, max: 10000 });
      const { lastInsertRowid } = db
        .prepare('INSERT INTO posts (thread_id, user_id, body) VALUES (?, ?, ?)')
        .run(t.id, req.user.id, body);
      db.prepare("UPDATE threads SET last_activity_at = datetime('now') WHERE id = ?").run(t.id);
      if (t.user_id !== req.user.id) {
        notify(t.user_id, req.user.id, 'reply', `${req.user.display_name} replied to “${t.title}”.`, `#/forum/t/${t.id}`);
      }
      res.status(201);
      return { post: { id: Number(lastInsertRowid) } };
    })
  );

  app.post(
    '/api/forum/threads/:id/like',
    auth.requireAuth,
    h((req) => {
      const threadId = id(req.params.id);
      if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) throw new HttpError(404, 'Thread not found.');
      const had = db.prepare('SELECT 1 FROM thread_likes WHERE thread_id = ? AND user_id = ?').get(threadId, req.user.id);
      if (had) db.prepare('DELETE FROM thread_likes WHERE thread_id = ? AND user_id = ?').run(threadId, req.user.id);
      else db.prepare('INSERT INTO thread_likes (thread_id, user_id) VALUES (?, ?)').run(threadId, req.user.id);
      return {
        liked: !had,
        like_count: db.prepare('SELECT count(*) AS n FROM thread_likes WHERE thread_id = ?').get(threadId).n,
      };
    })
  );

  app.delete(
    '/api/forum/threads/:id',
    auth.requireAuth,
    h((req) => {
      const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(id(req.params.id));
      if (!t || t.user_id !== req.user.id) throw new HttpError(404, 'Thread not found.');
      db.prepare('DELETE FROM threads WHERE id = ?').run(t.id);
      return { ok: true };
    })
  );

  app.delete(
    '/api/forum/posts/:id',
    auth.requireAuth,
    h((req) => {
      const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id(req.params.id));
      if (!p || p.user_id !== req.user.id) throw new HttpError(404, 'Reply not found.');
      db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
      return { ok: true };
    })
  );

  // =====================================================================
  // Home page stats
  // =====================================================================
  app.get(
    '/api/home',
    h((req) => {
      const viewer = req.user && req.user.id;
      const counts = db
        .prepare(
          `SELECT (SELECT count(*) FROM reviews) AS reviews, (SELECT count(*) FROM companies) AS companies,
                  (SELECT count(*) FROM users) AS members, (SELECT count(*) FROM users WHERE status = 'employed') AS hired,
                  (SELECT count(*) FROM contacts) AS people`
        )
        .get();
      const ranked = (order, having = '1') =>
        db
          .prepare(
            `SELECT c.id, c.name, c.industry, count(r.id) AS review_count, avg(r.rating_overall) AS overall, avg(r.ghosted) AS ghost_rate
             FROM companies c JOIN reviews r ON r.company_id = c.id AND r.target_type = 'company' AND ${VISIBLE}
             GROUP BY c.id HAVING ${having} ORDER BY ${order} LIMIT 5`
          )
          .all()
          .map((c) => ({ ...c, overall: Math.round(c.overall * 100) / 100, ghost_rate: Math.round(c.ghost_rate * 1000) / 1000 }));
      const recentlyHired = db
        .prepare("SELECT * FROM users WHERE status = 'employed' ORDER BY employed_at DESC LIMIT 6")
        .all()
        .map(publicUser);
      return {
        counts,
        top_companies: ranked('overall DESC, review_count DESC', 'overall >= 3.5'),
        worst_companies: ranked('overall ASC, review_count DESC', 'overall < 3'),
        most_ghosting: ranked('ghost_rate DESC, review_count DESC', 'ghost_rate > 0'),
        recent_reviews: listReviews('1 = 1', {}, viewer, { limit: 6 }),
        recently_hired: recentlyHired,
        hot_threads: db
          .prepare(`${THREAD_SELECT} ORDER BY t.last_activity_at DESC LIMIT 5`)
          .all({ viewer: viewer || 0 })
          .map((t) => shapeThread(t, viewer)),
      };
    })
  );

  // ---------- static frontend & errors ----------
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp };
