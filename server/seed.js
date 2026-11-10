'use strict';

/**
 * Fills the database with fictional demo data. All companies and people are made up.
 * Usage: npm run seed            (adds demo data to data/jobhub.db if it is empty)
 *        npm run seed -- --reset (deletes the database first)
 * Every demo account's password is "password123".
 */
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, transaction } = require('./db');
const { hashPassword } = require('./auth');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'jobhub.db');
if (process.argv.includes('--reset')) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}
const db = openDatabase(file);

if (db.prepare('SELECT count(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data. Run `npm run seed -- --reset` to start fresh.');
  process.exit(0);
}

const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().replace('T', ' ').slice(0, 19);
const monthAgo = (m) => {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 7);
};

transaction(db, () => {
  const pw = hashPassword('password123');
  const users = [
    ['maya@example.com', 'Maya Okafor', 'Data analyst · SQL, Python, Tableau', 'Data Analyst', 'Chicago, IL'],
    ['dev@example.com', 'Dev Ramirez', 'Backend engineer, 5 yrs Go & Postgres', 'Senior Backend Engineer', 'Remote'],
    ['priya@example.com', 'Priya Nair', 'Product marketer returning after a career break', 'Product Marketing Manager', 'Austin, TX'],
    ['sam@example.com', 'Sam Whitfield', 'New grad, CS — looking for my first role', 'Junior Software Engineer', 'Boston, MA'],
    ['jordan@example.com', 'Jordan Lee', 'UX designer, accessibility nerd', 'Product Designer', 'Seattle, WA'],
    ['alex@example.com', 'Alex Chen', 'Ops & program management', 'Program Manager', 'Denver, CO'],
  ];
  const insUser = db.prepare(
    'INSERT INTO users (email, password_hash, display_name, headline, target_role, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const uid = users.map((u, i) => Number(insUser.run(u[0], pw, u[1], u[2], u[3], u[4], daysAgo(60 - i)).lastInsertRowid));

  const companies = [
    ['Northwind Analytics', 'Data & Analytics', 'Chicago, IL', 'Fictional BI consultancy.'],
    ['Bluepeak Software', 'SaaS', 'Remote', 'Fictional B2B software company.'],
    ['Corvid Health', 'Healthcare', 'Boston, MA', 'Fictional digital health startup.'],
    ['Lumen Retail Group', 'Retail', 'Austin, TX', 'Fictional retail chain with a growing e-commerce team.'],
    ['Harbor & Finch', 'Financial Services', 'New York, NY', 'Fictional investment firm.'],
    ['Tallgrass Robotics', 'Hardware', 'Denver, CO', 'Fictional warehouse robotics company.'],
  ];
  const insCo = db.prepare('INSERT INTO companies (name, industry, location, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const cid = companies.map((c, i) => Number(insCo.run(c[0], c[1], c[2], c[3], uid[i % uid.length], daysAgo(55 - i)).lastInsertRowid));

  const insContact = db.prepare('INSERT INTO contacts (company_id, name, title, role, created_by) VALUES (?, ?, ?, ?, ?)');
  const contacts = {
    rosa: Number(insContact.run(cid[0], 'Rosa Delgado', 'Talent Acquisition Partner', 'recruiter', uid[0]).lastInsertRowid),
    ken: Number(insContact.run(cid[0], 'Ken Abara', 'Analytics Manager', 'hiring_manager', uid[0]).lastInsertRowid),
    tess: Number(insContact.run(cid[1], 'Tess Morgan', 'Senior Technical Recruiter', 'recruiter', uid[1]).lastInsertRowid),
    brad: Number(insContact.run(cid[1], 'Brad Keller', 'Recruiter, StaffRight Agency', 'agency_recruiter', uid[3]).lastInsertRowid),
    lena: Number(insContact.run(cid[2], 'Lena Fischer', 'Engineering Manager', 'hiring_manager', uid[3]).lastInsertRowid),
    omar: Number(insContact.run(cid[4], 'Omar Haddad', 'HR Business Partner', 'hr', uid[2]).lastInsertRowid),
  };

  const insReview = db.prepare(`
    INSERT INTO reviews (user_id, company_id, contact_id, target_type, position, stage_reached, outcome, ghosted,
      interview_rounds, process_weeks, difficulty, rating_overall, rating_communication, rating_respect,
      rating_transparency, rating_timeliness, rating_fairness, title, body, anonymous, process_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const review = (u, c, contact, o) => {
    const created = daysAgo(o.ago);
    insReview.run(
      uid[u], cid[c], contact ?? null, contact ? 'contact' : 'company', o.position, o.stage, o.outcome,
      o.outcome === 'ghosted' || o.ghosted ? 1 : 0, o.rounds ?? null, o.weeks ?? null, o.difficulty ?? null,
      ...o.r, o.title, o.body, o.anon === false ? 0 : 1, monthAgo(o.monthsAgo ?? 1), created, created
    );
  };

  review(0, 0, null, { ago: 20, position: 'Data Analyst', stage: 'final_round', outcome: 'offer_accepted', rounds: 4, weeks: 3, difficulty: 3, r: [5, 5, 5, 5, 4, 5],
    title: 'Clear, fast and respectful from start to finish',
    body: 'Recruiter shared the salary band on the first call and laid out every step. The SQL exercise was directly relevant to the job and they gave feedback after each round. Offer came 2 days after the final.', anon: false });
  review(3, 0, null, { ago: 15, position: 'Junior Data Analyst', stage: 'technical', outcome: 'rejected', rounds: 2, weeks: 2, difficulty: 3, r: [4, 4, 4, 4, 4, 4],
    title: 'Rejected, but with real feedback',
    body: 'Didn’t pass the technical, but they sent a short note explaining which parts of my case study were weaker. Rare and appreciated. Whole process was quick.' });
  review(1, 1, null, { ago: 12, position: 'Senior Backend Engineer', stage: 'onsite', outcome: 'ghosted', rounds: 6, weeks: 7, difficulty: 4, r: [1, 1, 2, 2, 1, 3],
    title: 'Six rounds, a take-home, then nothing',
    body: 'Did a 6-hour take-home plus five interviews including a "culture" panel. Recruiter said I’d hear back within a week. Followed up three times over a month. Silence. The interviewers themselves were fine.' });
  review(3, 1, null, { ago: 9, position: 'Junior Software Engineer', stage: 'recruiter_screen', outcome: 'ghosted', rounds: 1, weeks: 5, difficulty: 2, r: [2, 1, 3, 2, 1, 2],
    title: 'Ghosted after a "great" screen',
    body: 'Recruiter said I was a strong fit and to expect a technical interview invite. Never got it, and no reply to follow-ups. Later saw the role reposted.' });
  review(4, 1, null, { ago: 4, position: 'Product Designer', stage: 'final_round', outcome: 'offer_declined', rounds: 5, weeks: 6, difficulty: 4, r: [3, 3, 3, 2, 2, 4],
    title: 'Good interviewers, slow and vague process',
    body: 'Design challenge was relevant and the panel was thoughtful. But the salary range was only disclosed at offer stage and was well below market, and there were 2-week gaps between rounds with no updates.' });
  review(2, 3, null, { ago: 30, position: 'Product Marketing Manager', stage: 'hiring_manager_screen', outcome: 'rejected', rounds: 2, weeks: 4, difficulty: 2, r: [2, 2, 1, 3, 3, 2],
    title: 'Interviewer grilled me about my career gap',
    body: 'The hiring manager spent most of the call questioning my 2-year caregiving break instead of my experience. Felt dismissive. Rejection email came quickly though, which I appreciated.' });
  review(5, 5, null, { ago: 7, position: 'Program Manager', stage: 'offer', outcome: 'offer_accepted', rounds: 3, weeks: 2, difficulty: 3, r: [5, 5, 4, 5, 5, 4],
    title: 'Efficient and transparent',
    body: 'Three interviews in under two weeks. They told me exactly who I’d meet and what each conversation covered. Comp range was in the job post. Would recommend applying.', anon: false });
  review(1, 4, null, { ago: 25, position: 'Platform Engineer', stage: 'take_home', outcome: 'withdrew', rounds: 2, weeks: 3, difficulty: 5, r: [2, 3, 2, 2, 3, 1],
    title: 'Take-home was basically unpaid work',
    body: 'The "take-home" was to design a migration plan for what was obviously their real system, estimated at 10+ hours. I asked to scope it down and was told that was a red flag. Withdrew.' });
  review(4, 2, null, { ago: 3, position: 'UX Designer', stage: 'onsite', outcome: 'pending', rounds: 3, weeks: 3, difficulty: 3, r: [4, 4, 5, 4, 3, 4],
    title: 'Kind and organized so far',
    body: 'Every interviewer had read my portfolio and asked good questions. Scheduling took a while but the coordinator kept me updated. Waiting on the final decision now.' });

  // People reviews
  review(0, 0, contacts.rosa, { ago: 19, position: 'Data Analyst', stage: 'final_round', outcome: 'offer_accepted', rounds: 4, weeks: 3, r: [5, 5, 5, 5, 5, null],
    title: 'Best recruiter I’ve dealt with', body: 'Rosa prepped me for each round, told me the pay range up front, and called me personally with the offer. Always answered within a day.' });
  review(1, 1, contacts.tess, { ago: 11, position: 'Senior Backend Engineer', stage: 'onsite', outcome: 'ghosted', rounds: 6, weeks: 7, r: [1, 1, 3, 2, 1, null],
    title: 'Promised updates that never came', body: 'Polite on calls, but repeatedly said "I’ll get back to you by Friday" and didn’t. Stopped responding entirely after the onsite.' });
  review(3, 1, contacts.brad, { ago: 8, position: 'Junior Software Engineer', stage: 'recruiter_screen', outcome: 'ghosted', rounds: 1, weeks: 4, r: [2, 2, 2, 1, 2, null],
    title: 'Agency recruiter oversold the role', body: 'Told me the role was fully remote with a higher salary than what the company’s own posting said. Submitted me without asking first, then went quiet.' });
  review(3, 2, contacts.lena, { ago: 6, position: 'Junior Software Engineer', stage: 'technical', outcome: 'rejected', rounds: 2, weeks: 2, r: [5, 4, 5, 5, 4, 5],
    title: 'Fair technical interview and kind feedback', body: 'Lena made the pairing session feel collaborative, let me look things up, and explained afterwards what they were looking for. Didn’t get it but learned a lot.' });

  const insVote = db.prepare('INSERT INTO review_votes (review_id, user_id) VALUES (?, ?)');
  [[3, 0], [3, 2], [3, 4], [1, 3], [5, 0], [5, 4], [8, 2]].forEach(([r, u]) => insVote.run(r, uid[u]));

  // Connections: Maya <-> Dev, Maya <-> Priya, Maya <-> Alex, Dev <-> Sam, Jordan -> Maya pending
  const insConn = db.prepare("INSERT INTO connections (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, ?, ?, ?)");
  [[0, 1], [0, 2], [5, 0], [1, 3], [4, 5]].forEach(([a, b], i) => insConn.run(uid[a], uid[b], 'accepted', daysAgo(40 - i), daysAgo(39 - i)));
  insConn.run(uid[4], uid[0], 'pending', daysAgo(1), null);

  // Two members are hired.
  db.prepare("UPDATE users SET status = 'employed', employed_company = ?, employed_title = ?, employed_at = ? WHERE id = ?")
    .run('Northwind Analytics', 'Data Analyst', daysAgo(18), uid[0]);
  db.prepare("UPDATE users SET status = 'employed', employed_company = ?, employed_title = ?, employed_at = ? WHERE id = ?")
    .run('Tallgrass Robotics', 'Program Manager', daysAgo(5), uid[5]);

  const insNotif = db.prepare('INSERT INTO notifications (user_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const friend of [1, 2, 5]) insNotif.run(uid[friend], uid[0], 'employed', 'Maya Okafor landed a job as Data Analyst at Northwind Analytics! 🎉 Send them a congrats.', `#/u/${uid[0]}`, daysAgo(18));
  for (const friend of [0, 4]) insNotif.run(uid[friend], uid[5], 'employed', 'Alex Chen landed a job as Program Manager at Tallgrass Robotics! 🎉 Send them a congrats.', `#/u/${uid[5]}`, daysAgo(5));
  insNotif.run(uid[0], uid[4], 'connection_request', 'Jordan Lee wants to connect with you.', '#/network', daysAgo(1));

  // Forum
  const insThread = db.prepare('INSERT INTO threads (user_id, category, title, body, company_id, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insPost = db.prepare('INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
  const thread = (u, cat, title, body, company, ago, replies = []) => {
    const t = Number(insThread.run(uid[u], cat, title, body, company ?? null, daysAgo(ago), daysAgo(replies.length ? replies[replies.length - 1][2] : ago)).lastInsertRowid);
    for (const [ru, rb, rago] of replies) insPost.run(t, uid[ru], rb, daysAgo(rago));
    return t;
  };
  const t1 = thread(1, 'grievances', 'Is it normal to be ghosted after an onsite now?', 'Third time this year I’ve done a full onsite and never heard back. Not even a rejection template. Is this just how it is now?', cid[1], 10, [
    [3, 'Same thing happened to me at the screen stage with the same company. Starting to think it’s a pattern.', 9],
    [4, 'I now ask at the end of every interview: "When can I expect to hear back either way?" and write it down. Doesn’t fix it but helps me move on faster.', 8],
  ]);
  thread(0, 'wins', 'I got hired: Data Analyst at Northwind Analytics!', 'Six months, 140 applications, 11 interviews. The thing that finally worked was a portfolio of three small dashboards using public data. Keep going, everyone!', null, 18, [
    [2, 'Congrats Maya!! 🎉', 17], [1, 'Huge! Well deserved.', 17],
  ]);
  thread(2, 'networking', 'Product marketers in Austin — let’s connect', 'Returning to work after a caregiving break and rebuilding my network. Happy to swap referrals or just compare notes on who’s hiring.', null, 6, [
    [5, 'Not PMM but in Denver ops — connected! Happy to intro you to a couple of marketing folks I know.', 5],
  ]);
  thread(3, 'interview-tips', 'How do you push back on huge take-home assignments?', 'Got another "should take 3–4 hours" take-home that is clearly 10+. How do you scope it down without looking difficult?', null, 4, [
    [1, 'I reply asking which parts they care most about and say I’ll timebox to X hours and document what I’d do next. Good companies are fine with it. The ones that aren’t told me what I needed to know.', 3],
  ]);
  thread(5, 'general', 'What do you track in your job search spreadsheet?', 'Company, role, date applied, contact, stage, next follow-up date, and salary range. Anything I’m missing?', null, 2);
  const insLike = db.prepare('INSERT INTO thread_likes (thread_id, user_id) VALUES (?, ?)');
  [0, 2, 3, 4].forEach((u) => insLike.run(t1, uid[u]));
});

console.log('Seeded demo data. Log in as maya@example.com / password123 (or dev@, priya@, sam@, jordan@, alex@).');
