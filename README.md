# JobHub

**Rate the hiring process, not the job.** It's like RateMyProfessor, but for job seekers: rate how companies, recruiters and hiring managers treat candidates during the job search. There's also a community forum for networking, swapping interview tips and venting.

## Features

### Ratings (candidate experience only)
- **Companies.** Rate the overall hiring process on six dimensions: communication, respect for candidates, process transparency, speed & responsiveness, interview relevance & fairness, and overall.
- **Recruiters & hiring managers.** Add the people you dealt with (in-house recruiter, agency recruiter, hiring manager, interviewer, HR) and rate them on communication, professionalism, honesty, responsiveness and interview fairness. People reviews are counted separately from the company score.
- **Process details on each review:** position, furthest stage reached, outcome (offer accepted or declined, rejected, ghosted, withdrew, pending), number of rounds, weeks from start to finish, difficulty, and when it happened.
- **Company stats:** ghosting rate, offer rate, average rounds and length of the process, and a breakdown of outcomes.
- **Keeping reviews on topic:** every review needs a checkbox confirming it's *only* about the hiring/interview process. The form also warns you if your text sounds like it's about working there. Members can report reviews (off-topic or about employment, harassment, private info, spam), and a review reported by 3 people is hidden.
- **Privacy:** reviews are anonymous by default, and the API never sends the author of an anonymous review to other members. Each member gets one review per company and one per person, and can edit or delete it.
- Members can mark reviews as helpful, and sort by newest or most helpful.

### Community
- **Forum** with categories: General, Networking & Referrals, Grievances & Venting, Interview Prep & Tips, Wins & Celebrations. Members can post threads (optionally tagged to a company), reply and like. The thread author is notified of replies.
- **Members & connections:** search members, send, accept, decline or cancel connection requests, and remove connections.
- **"I got hired" status:** mark your profile as employed (with an optional title and company). **Every accepted connection gets a notification**, and you can also post the news to *Wins & Celebrations*. Hired members get a ✓ Hired badge everywhere. You can switch back to job seeking at any time.
- **Notifications** (bell with an unread count) for new jobs in your network, connection requests and acceptances, and forum replies.

## Running it

Requires **Node.js 22.13+**. The database is Node's built-in SQLite, so there's no native build and nothing else to install. Express is the only dependency.

```bash
npm install
npm run seed      # optional: fictional demo data (log in as maya@example.com / password123)
npm start         # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm start` | Start the server (`PORT`, default 3000) |
| `npm run dev` | Start with auto-reload |
| `npm run seed` | Add demo data to an empty database (`-- --reset` to wipe first) |
| `npm test` | Run the API test suite (in-memory database) |

Environment variables: `PORT`; `DB_PATH` (default `data/jobhub.db`); `NODE_ENV=production` (makes the session cookie `Secure`).

## Project layout

```
server/
  index.js       entry point
  app.js         Express app + all /api routes
  db.js          SQLite schema
  auth.js        password hashing (scrypt) + cookie sessions
  constants.js   stages, outcomes, rating dimensions, forum categories (served via /api/meta)
  validate.js    input validation helpers
  seed.js        demo data
public/          single-page frontend (vanilla JS, hash routing, no build step)
test/            node:test API tests
```

## Before going to production

This is a working MVP. Before a public launch, consider:
- Email verification and password reset
- Rate limiting on login, registration and posting
- An admin moderation queue for reported reviews and posts, and a policy for right-of-reply from companies
- Legal review of your policy on reviews that name individuals (recruiters and hiring managers)
- Real-time notifications (WebSockets or email) instead of 30-second polling
