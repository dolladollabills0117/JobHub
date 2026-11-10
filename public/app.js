/* JobHub single-page frontend. No build step: plain ES2020 + hash routing. */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const state = { me: null, meta: null, unread: 0 };

  // ------------------------------------------------------------------ utils
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  const GET = (p) => api('GET', p);
  const POST = (p, b = {}) => api('POST', p, b);

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    const units = [[60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
    let v = s / 60;
    for (const [n, name] of units) {
      if (v < n) { const r = Math.floor(v); return `${r} ${name}${r === 1 ? '' : 's'} ago`; }
      v /= n;
    }
    return d.toLocaleDateString();
  }

  const fmtMonth = (ym) => {
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const fixed = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));
  const label = (list, value) => (list.find((x) => x.value === value) || {}).label || value;
  const initials = (name) => esc(String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());

  function scoreClass(x) {
    if (x == null) return 'none';
    return x >= 3.75 ? 'good' : x >= 2.75 ? 'mid' : 'bad';
  }
  const score = (x, size = '') => `<span class="score ${size} ${scoreClass(x)}">${x == null ? '—' : Number(x).toFixed(1)}</span>`;
  function stars(x) {
    const n = Math.round(x || 0);
    return `<span class="stars" aria-label="${x ?? 0} out of 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  }

  const statusBadge = (u) =>
    u && u.status === 'employed'
      ? '<span class="badge hired">✓ Hired</span>'
      : u && u.status === 'seeking' ? '<span class="badge seeking">Job seeking</span>' : '';

  function outcomeBadge(o) {
    const cls = o === 'ghosted' ? 'ghost' : o.startsWith('offer') ? 'offer' : o === 'rejected' ? 'warn' : '';
    return `<span class="badge ${cls}">${esc(label(state.meta.outcomes, o))}</span>`;
  }

  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }

  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  function needLogin() {
    if (state.me) return false;
    go(`#/login?next=${encodeURIComponent(location.hash || '#/')}`);
    return true;
  }

  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    }
    return out;
  }

  function showError(form, err) {
    const box = form.querySelector('.form-error');
    if (box) {
      box.textContent = err.message;
      box.classList.add('show');
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else toast(err.message);
  }

  /** Wire a form's submit to an async handler with error display + disabled button. */
  function onSubmit(form, handler) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const box = form.querySelector('.form-error');
      if (box) box.classList.remove('show');
      if (btn) btn.disabled = true;
      try {
        await handler(formData(form));
      } catch (err) {
        showError(form, err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ nav
  function renderNav() {
    const el = document.getElementById('nav-user');
    if (!state.me) {
      el.innerHTML = `<a href="#/login" data-nav="login">Log in</a><a class="btn sm" href="#/register" style="color:var(--primary-ink)">Join free</a>`;
    } else {
      el.innerHTML = `
        <a class="btn sm" href="#/review/new" style="color:var(--primary-ink)">✍️ Write a review</a>
        <a href="#/network" data-nav="network">Network</a>
        <a href="#/notifications" data-nav="notifications" class="bell" aria-label="Notifications">🔔${state.unread ? `<span class="count">${state.unread}</span>` : ''}</a>
        <a href="#/me" data-nav="me" title="Your profile"><span class="avatar sm">${initials(state.me.display_name)}</span></a>`;
    }
    const section = parseHash().path.split('/')[1] || '';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === section));
  }

  async function refreshUnread() {
    if (!state.me) return;
    try {
      const { unread } = await GET('/api/notifications/unread-count');
      if (unread !== state.unread) { state.unread = unread; renderNav(); }
    } catch { /* ignore */ }
  }

  document.querySelector('.menu-toggle').addEventListener('click', (e) => {
    const nav = document.getElementById('nav');
    nav.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', nav.classList.contains('open'));
  });

  // ------------------------------------------------------------------ shared components
  function reviewCard(r, { showTarget = false } = {}) {
    const dims = r.target_type === 'company' ? state.meta.company_dimensions : state.meta.contact_dimensions;
    const target = r.contact
      ? `<a href="#/people/${r.contact.id}">${esc(r.contact.name)}</a> <span class="muted">· ${esc(label(state.meta.contact_roles, r.contact.role))} at</span> <a href="#/companies/${r.company.id}">${esc(r.company.name)}</a>`
      : `<a href="#/companies/${r.company.id}">${esc(r.company.name)}</a>`;
    const author = r.author
      ? `<a href="#/u/${r.author.id}">${esc(r.author.display_name)}</a> ${statusBadge(r.author)}`
      : '<span>Anonymous job seeker</span>';
    return `
      <article class="review" data-review="${r.id}">
        <div class="row between">
          <div class="row">${score(r.ratings.overall, 'sm')} ${stars(r.ratings.overall)}</div>
          <div class="chips">${outcomeBadge(r.outcome)}${r.ghosted && r.outcome !== 'ghosted' ? '<span class="badge ghost">Ghosted at some point</span>' : ''}</div>
        </div>
        ${showTarget ? `<div class="small" style="margin-top:6px">${target}</div>` : ''}
        <h3>${esc(r.title)}</h3>
        <div class="review-meta">
          ${r.position ? `<span>💼 ${esc(r.position)}</span>` : ''}
          <span>📍 Reached: ${esc(label(state.meta.stages, r.stage_reached))}</span>
          ${r.interview_rounds != null ? `<span>🔁 ${r.interview_rounds} round${r.interview_rounds === 1 ? '' : 's'}</span>` : ''}
          ${r.process_weeks != null ? `<span>⏱ ${r.process_weeks} week${r.process_weeks === 1 ? '' : 's'}</span>` : ''}
          ${r.difficulty ? `<span>🧗 Difficulty ${r.difficulty}/5</span>` : ''}
          ${r.process_date ? `<span>📅 ${esc(fmtMonth(r.process_date))}</span>` : ''}
        </div>
        <div class="review-dims">
          ${dims.filter((d) => d.key !== 'overall' && r.ratings[d.key] != null).map((d) => `<span>${esc(d.label)}: <b>${r.ratings[d.key]}</b>/5</span>`).join('')}
        </div>
        <p class="pre">${esc(r.body)}</p>
        <div class="review-actions small muted">
          <span>${author} · ${timeAgo(r.created_at)}</span>
          <span class="nav-spacer"></span>
          ${r.is_mine
            ? `<a class="btn sm secondary" href="#/review/edit/${r.id}">Edit</a><button class="btn sm ghost" data-action="delete-review" data-id="${r.id}">Delete</button>`
            : `<button class="btn sm ${r.voted_helpful ? '' : 'secondary'}" data-action="helpful" data-id="${r.id}">👍 Helpful <span>${r.helpful_count || ''}</span></button>
               <button class="btn sm ghost" data-action="flag" data-id="${r.id}" ${r.flagged_by_me ? 'disabled' : ''}>${r.flagged_by_me ? 'Reported' : '⚑ Report'}</button>`}
        </div>
      </article>`;
  }

  function bindReviewActions(root, onChange) {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const reviewId = btn.dataset.id;
      try {
        if (btn.dataset.action === 'helpful') {
          if (needLogin()) return;
          const r = await POST(`/api/reviews/${reviewId}/helpful`);
          btn.classList.toggle('secondary', !r.voted_helpful);
          btn.querySelector('span').textContent = r.helpful_count || '';
        } else if (btn.dataset.action === 'flag') {
          if (needLogin()) return;
          const reason = await pickFlagReason();
          if (!reason) return;
          await POST(`/api/reviews/${reviewId}/flag`, { reason });
          btn.textContent = 'Reported';
          btn.disabled = true;
          toast('Thanks — our community moderation will take a look.');
        } else if (btn.dataset.action === 'delete-review') {
          if (!(await askConfirm('Delete your review? This cannot be undone.'))) return;
          await api('DELETE', `/api/reviews/${reviewId}`);
          toast('Review deleted.');
          onChange && onChange();
        }
      } catch (err) { toast(err.message); }
    });
  }

  /** In-page confirmation dialog (window.confirm is unavailable in some embedded frames). */
  function askConfirm(message, okLabel = 'Confirm') {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.innerHTML = `
        <form method="dialog">
          <p class="pre" style="margin-top:0">${esc(message)}</p>
          <div class="row" style="margin-top:16px"><button class="btn" value="ok">${esc(okLabel)}</button><button class="btn secondary" value="cancel">Cancel</button></div>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => { const ok = dlg.returnValue === 'ok'; dlg.remove(); resolve(ok); });
      dlg.showModal();
    });
  }

  function pickFlagReason() {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.innerHTML = `
        <form method="dialog">
          <h2>Report this review</h2>
          <p class="muted small">Reviews must stay about the hiring process. Reviews reported by several members are hidden.</p>
          ${state.meta.flag_reasons.map((r, i) => `<label class="check"><input type="radio" name="reason" value="${r.value}" ${i === 0 ? 'checked' : ''}/> ${esc(r.label)}</label>`).join('')}
          <div class="row" style="margin-top:16px"><button class="btn danger" value="ok">Report</button><button class="btn secondary" value="cancel">Cancel</button></div>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => {
        const v = dlg.returnValue === 'ok' ? dlg.querySelector('input[name=reason]:checked').value : null;
        dlg.remove();
        resolve(v);
      });
      dlg.showModal();
    });
  }

  function summaryBars(summary, dims) {
    return `<div class="bars">${dims.filter((d) => d.key !== 'overall').map((d) => {
      const v = summary.ratings[d.key];
      return `<div class="bar-row"><span>${esc(d.label)}</span><div class="bar"><i style="width:${v ? (v / 5) * 100 : 0}%"></i></div><b>${fixed(v)}</b></div>`;
    }).join('')}</div>`;
  }

  function outcomeBreakdown(summary) {
    if (!summary.count) return '';
    return `<div class="chips">${state.meta.outcomes.filter((o) => summary.outcomes[o.value]).map((o) =>
      `<span class="badge ${o.value === 'ghosted' ? 'ghost' : o.value.startsWith('offer') ? 'offer' : ''}">${esc(o.label)}: ${summary.outcomes[o.value]}</span>`).join('')}</div>`;
  }

  function companyRow(c) {
    return `<li class="company-row">
      ${score(c.overall)}
      <div class="grow">
        <h3><a href="#/companies/${c.id}">${esc(c.name)}</a></h3>
        <div class="small muted">${[c.industry, c.location].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      </div>
      <div class="small muted" style="text-align:right">
        ${c.review_count} review${c.review_count === 1 ? '' : 's'}<br/>
        ${c.ghost_rate != null ? `<span class="${c.ghost_rate >= 0.4 ? 'badge ghost' : ''}">👻 ${pct(c.ghost_rate)} ghosted</span>` : ''}
      </div>
    </li>`;
  }

  function threadRow(t, { showCategory = true } = {}) {
    const cat = state.meta.forum_categories.find((c) => c.slug === t.category);
    return `<li class="person">
      <span class="avatar">${initials(t.author.display_name)}</span>
      <div class="grow">
        <a href="#/forum/t/${t.id}"><b>${esc(t.title)}</b></a>
        <div class="small muted">
          ${showCategory && cat ? `<span class="badge">${esc(cat.name)}</span> ` : ''}
          by <a href="#/u/${t.author.id}">${esc(t.author.display_name)}</a> ${t.author.status === 'employed' ? '<span class="badge hired">✓ Hired</span>' : ''}
          · ${timeAgo(t.last_activity_at)}
          ${t.company ? ` · about <a href="#/companies/${t.company.id}">${esc(t.company.name)}</a>` : ''}
        </div>
      </div>
      <div class="small muted" style="text-align:right;white-space:nowrap">💬 ${t.reply_count}<br/>❤️ ${t.like_count}</div>
    </li>`;
  }

  function connectButton(user, conn) {
    if (!conn || conn.state === 'self') return '';
    switch (conn.state) {
      case 'anonymous': return `<a class="btn sm" href="#/login">Log in to connect</a>`;
      case 'none': return `<button class="btn sm" data-connect="${user.id}">＋ Connect</button>`;
      case 'pending_outgoing': return `<button class="btn sm secondary" data-cancel="${conn.connection_id}">Requested · Cancel</button>`;
      case 'pending_incoming': return `<button class="btn sm good" data-accept="${conn.connection_id}">Accept request</button>`;
      case 'connected': return `<span class="badge hired">✓ Connected</span>`;
      default: return '';
    }
  }

  function bindConnectButtons(root, onChange) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-connect],[data-cancel],[data-accept],[data-remove]');
      if (!b) return;
      try {
        if (b.dataset.connect) { await POST('/api/connections', { user_id: Number(b.dataset.connect) }); toast('Connection request sent.'); }
        else if (b.dataset.accept) { await POST(`/api/connections/${b.dataset.accept}/accept`); toast('Connected!'); }
        else if (b.dataset.cancel) { await api('DELETE', `/api/connections/${b.dataset.cancel}`); toast('Request withdrawn.'); }
        else if (b.dataset.remove) {
          if (!(await askConfirm('Remove this connection?'))) return;
          await api('DELETE', `/api/connections/${b.dataset.remove}`);
          toast('Removed.');
        }
        onChange();
      } catch (err) { toast(err.message); }
    });
  }

  // ------------------------------------------------------------------ views
  const views = {};

  views.home = async () => {
    const d = await GET('/api/home');
    const scopeBox = `
      <div class="card">
        <h2>What gets rated here</h2>
        <p class="muted">Only the <b>candidate experience</b> — how a company and its recruiters & hiring managers treat you while you're job hunting.</p>
        <div class="scope stacked">
          <div class="notice"><b>✅ In scope</b><ul><li>Communication & follow-up</li><li>Ghosting & time to decision</li><li>Interview relevance & fairness</li><li>Salary & process transparency</li><li>Respect for your time</li></ul></div>
          <div class="notice warn"><b>🚫 Out of scope</b><ul><li>What it's like to work there</li><li>Culture, pay or managers as an employee</li><li>Personal attacks or private info</li></ul></div>
        </div>
      </div>`;
    const rankList = (list, empty, extra) => list.length
      ? `<ul class="list">${list.map((c) => `<li class="company-row">${score(c.overall, 'sm')}<div class="grow"><a href="#/companies/${c.id}"><b>${esc(c.name)}</b></a><div class="small muted">${c.review_count} review${c.review_count === 1 ? '' : 's'}</div></div>${extra(c)}</li>`).join('')}</ul>`
      : `<p class="empty">${empty}</p>`;

    $app.innerHTML = `
      <section class="hero">
        <h1>Rate the hiring process, not the job.</h1>
        <p>Ghosted after five rounds? Recruiter who actually had your back? Share how employers, recruiters and hiring managers treat candidates — and connect with people who get it.</p>
        <div class="row">
          <a class="btn" href="${state.me ? '#/review/new' : '#/register'}">${state.me ? '✍️ Rate an interview experience' : 'Join JobHub — it’s free'}</a>
          <a class="btn ghost" href="#/companies">Browse companies</a>
        </div>
      </section>
      <div class="stats">
        <div class="stat"><b>${d.counts.reviews}</b><span>process reviews</span></div>
        <div class="stat"><b>${d.counts.companies}</b><span>companies</span></div>
        <div class="stat"><b>${d.counts.people}</b><span>recruiters & managers</span></div>
        <div class="stat"><b>${d.counts.hired}</b><span>members hired 🎉</span></div>
      </div>
      <div class="layout" style="margin-top:24px">
        <div>
          <div class="section-title"><h2>Latest reviews</h2><a href="#/companies">All companies →</a></div>
          <div id="recent">${d.recent_reviews.length ? d.recent_reviews.map((r) => reviewCard(r, { showTarget: true })).join('') : '<div class="card empty">No reviews yet — be the first.</div>'}</div>
          <div class="section-title"><h2>Active in the forum</h2><a href="#/forum">Forum →</a></div>
          <div class="card">${d.hot_threads.length ? `<ul class="list">${d.hot_threads.map((t) => threadRow(t)).join('')}</ul>` : '<p class="empty">No threads yet.</p>'}</div>
        </div>
        <aside class="stack">
          <div class="card"><h3>🏆 Best candidate experience</h3>${rankList(d.top_companies, 'No ratings yet.', () => '')}</div>
          <div class="card"><h3>👎 Roughest hiring process</h3>${rankList(d.worst_companies, 'No ratings yet.', () => '')}</div>
          <div class="card"><h3>👻 Ghosting hall of shame</h3>${rankList(d.most_ghosting, 'No ratings yet.', (c) => `<span class="badge ghost">${pct(c.ghost_rate)}</span>`)}</div>
          <div class="card"><h3>🎉 Recently hired</h3>${d.recently_hired.length ? `<ul class="list">${d.recently_hired.map((u) => `<li class="person"><span class="avatar sm">${initials(u.display_name)}</span><div class="grow small"><a href="#/u/${u.id}"><b>${esc(u.display_name)}</b></a><div class="muted">${esc([u.employed_title, u.employed_company].filter(Boolean).join(' at ') || 'Landed a job')}</div></div></li>`).join('')}</ul>` : '<p class="empty">Be the first to mark yourself hired!</p>'}</div>
          ${scopeBox}
        </aside>
      </div>`;
    bindReviewActions(document.getElementById('recent'), render);
  };

  views.companies = async (_p, query) => {
    const q = query.q || '';
    const sort = query.sort || 'reviews';
    const { companies } = await GET(`/api/companies?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}`);
    const sorts = [['reviews', 'Most reviewed'], ['top', 'Best rated'], ['worst', 'Worst rated'], ['ghosting', 'Most ghosting'], ['recent', 'Newest'], ['name', 'A–Z']];
    $app.innerHTML = `
      <div class="section-title" style="margin-top:0"><h1>Companies</h1>${state.me ? '<button class="btn" id="add-co">＋ Add a company</button>' : ''}</div>
      <form class="search" id="search">
        <input type="search" name="q" placeholder="Search by name, industry or location…" value="${esc(q)}" />
        <select name="sort">${sorts.map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn secondary">Search</button>
      </form>
      <div class="card" id="add-form" hidden style="margin-top:16px">
        <h2>Add a company</h2>
        <form id="co-form">
          <div class="form-error"></div>
          <div class="grid grid-2">
            <div class="field"><label>Company name *</label><input type="text" name="name" required maxlength="120" value="${esc(q)}"/></div>
            <div class="field"><label>Industry</label><input type="text" name="industry" maxlength="80" placeholder="e.g. Fintech"/></div>
            <div class="field"><label>Website</label><input type="text" name="website" maxlength="200" placeholder="example.com"/></div>
            <div class="field"><label>HQ / location</label><input type="text" name="location" maxlength="120"/></div>
          </div>
          <div class="row"><button class="btn" type="submit">Add company</button></div>
        </form>
      </div>
      <div class="card" style="margin-top:16px">
        ${companies.length ? `<ul class="list">${companies.map(companyRow).join('')}</ul>` : `<div class="empty">No companies found${q ? ` for “${esc(q)}”` : ''}. ${state.me ? 'Add it above!' : '<a href="#/register">Join</a> to add one.'}</div>`}
      </div>`;
    document.getElementById('search').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = formData(e.target);
      go(`#/companies?q=${encodeURIComponent(f.q)}&sort=${f.sort}`);
    });
    document.getElementById('search').sort.addEventListener('change', (e) => e.target.form.requestSubmit());
    const add = document.getElementById('add-co');
    if (add) add.addEventListener('click', () => { const f = document.getElementById('add-form'); f.hidden = !f.hidden; });
    onSubmit(document.getElementById('co-form'), async (f) => {
      try {
        const { company } = await POST('/api/companies', f);
        toast(`${company.name} added.`);
        go(`#/companies/${company.id}`);
      } catch (err) {
        if (err.status === 409 && err.data.company_id) { toast('Already listed — taking you there.'); go(`#/companies/${err.data.company_id}`); return; }
        throw err;
      }
    });
  };

  views.company = async ([id], query) => {
    const d = await GET(`/api/companies/${id}${query.sort ? `?sort=${query.sort}` : ''}`);
    const c = d.company;
    const s = d.summary;
    const dims = state.meta.company_dimensions;
    const writeLink = d.my_review_id ? `#/review/edit/${d.my_review_id}` : `#/review/new?company=${c.id}`;
    $app.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:flex-start;gap:20px">
          ${score(s.ratings.overall, 'lg')}
          <div style="flex:1;min-width:220px">
            <h1>${esc(c.name)}</h1>
            <div class="muted">${[c.industry, c.location].filter(Boolean).map(esc).join(' · ')}
              ${c.website ? ` · <a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer nofollow">website ↗</a>` : ''}</div>
            <div style="margin-top:6px">${stars(s.ratings.overall)} <span class="muted small">Hiring process rating · ${s.count} review${s.count === 1 ? '' : 's'}</span></div>
            ${c.description ? `<p class="small" style="margin-top:8px">${esc(c.description)}</p>` : ''}
          </div>
          <div class="row">
            <a class="btn" href="${writeLink}">${d.my_review_id ? 'Edit your review' : '✍️ Rate their hiring process'}</a>
          </div>
        </div>
      </div>
      <div class="layout" style="margin-top:16px">
        <div>
          <div class="card">
            <h2>Candidate experience breakdown</h2>
            ${s.count ? summaryBars(s, dims) : '<p class="muted">No ratings yet.</p>'}
            <div class="grid grid-3" style="margin-top:16px">
              <div class="stat"><b>${pct(s.ghost_rate)}</b><span>ghosted candidates</span></div>
              <div class="stat"><b>${fixed(s.avg_rounds)}</b><span>avg. interview rounds</span></div>
              <div class="stat"><b>${fixed(s.avg_weeks)}</b><span>avg. weeks start→finish</span></div>
              <div class="stat"><b>${pct(s.offer_rate)}</b><span>reviewers got an offer</span></div>
              <div class="stat"><b>${fixed(s.avg_difficulty)}</b><span>avg. difficulty /5</span></div>
              <div class="stat"><b>${s.count}</b><span>reviews</span></div>
            </div>
            <div style="margin-top:12px">${outcomeBreakdown(s)}</div>
          </div>
          <div class="section-title">
            <h2>Reviews of the hiring process</h2>
            <div class="tabs" style="margin:0">
              <a href="#/companies/${c.id}" class="${query.sort !== 'helpful' ? 'active' : ''}">Newest</a>
              <a href="#/companies/${c.id}?sort=helpful" class="${query.sort === 'helpful' ? 'active' : ''}">Most helpful</a>
            </div>
          </div>
          <div id="reviews">${d.reviews.length ? d.reviews.map((r) => reviewCard(r)).join('') : `<div class="card empty">No reviews yet. <a href="${writeLink}">Share your experience</a>.</div>`}</div>
        </div>
        <aside class="stack">
          <div class="card">
            <div class="row between"><h3 style="margin:0">Recruiters & hiring managers</h3></div>
            <p class="small muted">Rate the people you dealt with during the process.</p>
            ${d.contacts.length ? `<ul class="list">${d.contacts.map((p) => `
              <li class="person">${score(p.overall, 'sm')}
                <div class="grow"><a href="#/people/${p.id}"><b>${esc(p.name)}</b></a>
                  <div class="small muted">${esc(label(state.meta.contact_roles, p.role))}${p.title ? ` · ${esc(p.title)}` : ''} · ${p.review_count} review${p.review_count === 1 ? '' : 's'}</div></div>
              </li>`).join('')}</ul>` : '<p class="muted small">Nobody listed yet.</p>'}
            ${state.me ? `<button class="btn sm secondary" id="add-person" style="margin-top:8px">＋ Add a recruiter / manager</button>
            <form id="person-form" hidden style="margin-top:12px">
              <div class="form-error"></div>
              <div class="field"><label>Name *</label><input type="text" name="name" required maxlength="80"/></div>
              <div class="field"><label>Role *</label><select name="role">${state.meta.contact_roles.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join('')}</select></div>
              <div class="field"><label>Title <span class="hint">(optional)</span></label><input type="text" name="title" maxlength="120" placeholder="e.g. Senior Technical Recruiter"/></div>
              <button class="btn sm" type="submit">Add person</button>
            </form>` : ''}
            ${d.people_summary.count ? `<p class="small muted" style="margin-top:12px">People at ${esc(c.name)} average <b>${fixed(d.people_summary.ratings.overall)}</b>/5 across ${d.people_summary.count} review${d.people_summary.count === 1 ? '' : 's'}.</p>` : ''}
          </div>
          <div class="card">
            <h3>Forum threads</h3>
            ${d.threads.length ? `<ul class="list small">${d.threads.map((t) => `<li><a href="#/forum/t/${t.id}">${esc(t.title)}</a></li>`).join('')}</ul>` : '<p class="muted small">No discussions yet.</p>'}
            <a class="btn sm secondary" href="#/forum/new?company=${c.id}">Start a discussion</a>
          </div>
        </aside>
      </div>`;
    bindReviewActions(document.getElementById('reviews'), render);
    const addBtn = document.getElementById('add-person');
    if (addBtn) {
      addBtn.addEventListener('click', () => { const f = document.getElementById('person-form'); f.hidden = !f.hidden; });
      onSubmit(document.getElementById('person-form'), async (f) => {
        const { contact } = await POST(`/api/companies/${c.id}/contacts`, f);
        toast(`${contact.name} added.`);
        go(`#/people/${contact.id}`);
      });
    }
  };

  views.person = async ([id]) => {
    const d = await GET(`/api/contacts/${id}`);
    const p = d.contact;
    const s = d.summary;
    const writeLink = d.my_review_id ? `#/review/edit/${d.my_review_id}` : `#/review/new?company=${p.company_id}&contact=${p.id}`;
    $app.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:flex-start;gap:20px">
          ${score(s.ratings.overall, 'lg')}
          <div style="flex:1;min-width:220px">
            <h1>${esc(p.name)}</h1>
            <div class="muted">${esc(label(state.meta.contact_roles, p.role))}${p.title ? ` · ${esc(p.title)}` : ''} at <a href="#/companies/${p.company_id}">${esc(p.company_name)}</a></div>
            <div style="margin-top:6px">${stars(s.ratings.overall)} <span class="muted small">${s.count} review${s.count === 1 ? '' : 's'} from candidates</span></div>
          </div>
          <a class="btn" href="${writeLink}">${d.my_review_id ? 'Edit your review' : `✍️ Rate ${esc(p.name.split(' ')[0])}`}</a>
        </div>
      </div>
      <div class="layout" style="margin-top:16px">
        <div>
          <div class="section-title" style="margin-top:0"><h2>Candidate reviews</h2></div>
          <div id="reviews">${d.reviews.length ? d.reviews.map((r) => reviewCard(r)).join('') : `<div class="card empty">No reviews yet. <a href="${writeLink}">Be the first</a>.</div>`}</div>
        </div>
        <aside class="stack">
          <div class="card"><h3>Breakdown</h3>${s.count ? summaryBars(s, state.meta.contact_dimensions) : '<p class="muted small">No ratings yet.</p>'}
            <div class="grid grid-2" style="margin-top:14px">
              <div class="stat"><b>${pct(s.ghost_rate)}</b><span>ghosted</span></div>
              <div class="stat"><b>${pct(s.offer_rate)}</b><span>got offers</span></div>
            </div>
          </div>
          <div class="notice small">Keep it about how ${esc(p.name.split(' ')[0])} handled the hiring process. No personal details, no attacks — reviews that cross the line get reported and hidden.</div>
        </aside>
      </div>`;
    bindReviewActions(document.getElementById('reviews'), render);
  };

  // Phrases that suggest a review is about employment rather than the hiring process.
  const EMPLOYMENT_HINTS = /\b(worked (here|there)|working (here|there)|my (co-?workers|boss|team lead)|as an employee|after (i|we) (joined|started)|my first (week|month|year) (here|there)|got fired|laid off|performance review|promotion)\b/i;

  views.reviewForm = async (params, query) => {
    if (needLogin()) return;
    const editing = params[0] === 'edit';
    let existing = null;
    if (editing) {
      existing = (await GET(`/api/reviews/${params[1]}`)).review;
      if (!existing.is_mine) throw Object.assign(new Error('You can only edit your own reviews.'), { status: 403 });
    }
    const { companies } = await GET('/api/companies?sort=name');
    const companyId = existing ? existing.company.id : Number(query.company) || null;
    const contactId = existing ? existing.contact && existing.contact.id : Number(query.contact) || null;
    const m = state.meta;
    const today = new Date().toISOString().slice(0, 7);

    $app.innerHTML = `
      <div class="layout">
        <form class="card" id="review-form" novalidate>
          <h1>${editing ? 'Edit your review' : 'Rate a hiring experience'}</h1>
          <p class="muted">Tell other job seekers what the <b>interview & hiring process</b> was like. Reviews are anonymous by default.</p>
          <div class="form-error"></div>

          <h2 style="margin-top:20px">1. Who are you rating?</h2>
          <div class="field">
            <label>Company *</label>
            ${editing ? `<input type="text" value="${esc(existing.company.name)}" disabled/>` : `
            <select name="company_id" id="company-select" required>
              <option value="">Select a company…</option>
              ${companies.map((c) => `<option value="${c.id}" ${c.id === companyId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <div class="hint" style="margin-top:4px">Not listed? <a href="#/companies?q=">Add the company first</a>.</div>`}
          </div>
          <div class="field" id="target-field">
            <label>Rating the… *</label>
            ${editing ? `<input type="text" disabled value="${esc(existing.contact ? `${existing.contact.name} (${label(m.contact_roles, existing.contact.role)})` : "Company's overall hiring process")}"/>` : `<select name="target" id="target-select"></select>`}
          </div>
          <div id="new-person" hidden>
            <div class="grid grid-2">
              <div class="field"><label>Their name *</label><input type="text" name="new_name" maxlength="80"/></div>
              <div class="field"><label>Their role *</label><select name="new_role">${m.contact_roles.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join('')}</select></div>
            </div>
            <div class="field"><label>Their title <span class="hint">(optional)</span></label><input type="text" name="new_title" maxlength="120"/></div>
          </div>

          <h2 style="margin-top:20px">2. About your process</h2>
          <div class="grid grid-2">
            <div class="field"><label>Position applied for</label><input type="text" name="position" maxlength="120" placeholder="e.g. Marketing Manager"/></div>
            <div class="field"><label>When was this?</label><input type="month" name="process_date" max="${today}"/></div>
            <div class="field"><label>Furthest stage you reached *</label><select name="stage_reached" required>${m.stages.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select></div>
            <div class="field"><label>Outcome *</label><select name="outcome" required>${m.outcomes.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select></div>
            <div class="field"><label>Number of interview rounds</label><input type="number" name="interview_rounds" min="0" max="30"/></div>
            <div class="field"><label>Weeks from application to final answer</label><input type="number" name="process_weeks" min="0" max="104"/></div>
          </div>
          <div class="field"><label class="check"><input type="checkbox" name="ghosted"/> I was ghosted at some point (no reply after an interview or follow-up)</label></div>
          <div class="field">
            <label>Interview difficulty</label>
            <div class="star-input" data-rating="difficulty" data-optional="1"></div>
          </div>

          <h2 style="margin-top:20px">3. Ratings</h2>
          <div id="ratings"></div>

          <h2 style="margin-top:20px">4. Your review</h2>
          <div class="field"><label>Headline *</label><input type="text" name="title" maxlength="120" required placeholder="Sum it up in a sentence"/></div>
          <div class="field">
            <label>What happened? * <span class="hint">At least 30 characters. Focus on the process: communication, interviews, timeline, how you were treated.</span></label>
            <textarea name="body" maxlength="5000" required placeholder="e.g. Recruiter was upfront about salary, 3 rounds over 2 weeks, interviewers were prepared, got a rejection email with feedback…"></textarea>
          </div>
          <div class="field"><label class="check"><input type="checkbox" name="anonymous" checked/> Post anonymously <span class="hint">(your name won't be shown on this review)</span></label></div>
          <div class="field notice"><label class="check"><input type="checkbox" name="attest_hiring_process_only" required/> I confirm this review is only about my experience as a <b>candidate during the job search / interview process</b> — not about working at this company.</label></div>
          <div class="row"><button class="btn" type="submit">${editing ? 'Save changes' : 'Publish review'}</button><button class="btn secondary" type="button" id="cancel-review">Cancel</button></div>
        </form>
        <aside class="stack">
          <div class="card">
            <h3>Rate the process, not the job</h3>
            <div class="notice small"><b>✅ Good to include</b><ul><li>Did they reply, and how fast?</li><li>Were interviews relevant to the role?</li><li>Was salary / the process explained upfront?</li><li>Did they respect your time?</li><li>How the rejection or offer was handled</li></ul></div>
            <div class="notice warn small" style="margin-top:10px"><b>🚫 Leave out</b><ul><li>What it's like to work there</li><li>Employee pay, benefits, culture</li><li>Insults or private details about people</li></ul></div>
          </div>
        </aside>
      </div>`;

    const form = document.getElementById('review-form');
    document.getElementById('cancel-review').addEventListener('click', () => history.back());

    // Star inputs
    function starInput(el, initial) {
      el.dataset.value = initial || '';
      el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-v="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')
        + (el.dataset.optional ? '<button type="button" class="btn link small" data-clear style="margin-left:8px">clear</button>' : '');
      const paint = (v) => el.querySelectorAll('.star-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= v));
      paint(Number(el.dataset.value) || 0);
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-clear]')) { el.dataset.value = ''; paint(0); return; }
        const b = e.target.closest('.star-btn');
        if (!b) return;
        el.dataset.value = b.dataset.v;
        paint(Number(b.dataset.v));
      });
      el.addEventListener('mouseover', (e) => { const b = e.target.closest('.star-btn'); if (b) paint(Number(b.dataset.v)); });
      el.addEventListener('mouseleave', () => paint(Number(el.dataset.value) || 0));
    }

    function renderRatings(type) {
      const dims = type === 'company' ? m.company_dimensions : m.contact_dimensions;
      const prev = {};
      document.querySelectorAll('#ratings .star-input').forEach((el) => { prev[el.dataset.rating] = el.dataset.value; });
      document.getElementById('ratings').innerHTML = dims.map((d) => `
        <div class="rating-field">
          <div><b>${esc(d.label)}</b>${d.required ? ' *' : ''}${d.hint ? `<div class="hint">${esc(d.hint)}</div>` : ''}</div>
          <div class="star-input" data-rating="${d.key}" ${d.required ? '' : 'data-optional="1"'}></div>
        </div>`).join('');
      document.querySelectorAll('#ratings .star-input').forEach((el) =>
        starInput(el, prev[el.dataset.rating] || (existing && existing.ratings[el.dataset.rating])));
    }

    async function loadTargets(cid) {
      const sel = document.getElementById('target-select');
      if (!sel) return;
      if (!cid) { sel.innerHTML = '<option value="company">Pick a company first</option>'; renderRatings('company'); return; }
      const { contacts } = await GET(`/api/companies/${cid}`);
      sel.innerHTML = `
        <option value="company">The company's overall hiring process</option>
        ${contacts.length ? `<optgroup label="A specific person">${contacts.map((p) => `<option value="${p.id}" ${p.id === contactId ? 'selected' : ''}>${esc(p.name)} — ${esc(label(m.contact_roles, p.role))}</option>`).join('')}</optgroup>` : ''}
        <option value="new">＋ A recruiter / hiring manager not listed yet</option>`;
      sel.dispatchEvent(new Event('change'));
    }

    starInput(form.querySelector('[data-rating=difficulty]'), existing && existing.difficulty);

    if (editing) {
      renderRatings(existing.target_type);
      for (const k of ['position', 'process_date', 'stage_reached', 'outcome', 'interview_rounds', 'process_weeks', 'title', 'body']) {
        if (existing[k] != null) form.elements[k].value = existing[k];
      }
      form.elements.ghosted.checked = existing.ghosted;
      form.elements.anonymous.checked = existing.anonymous;
    } else {
      document.getElementById('company-select').addEventListener('change', (e) => loadTargets(Number(e.target.value)));
      document.getElementById('target-select').addEventListener('change', (e) => {
        document.getElementById('new-person').hidden = e.target.value !== 'new';
        renderRatings(e.target.value === 'company' ? 'company' : 'contact');
      });
      await loadTargets(companyId);
    }

    onSubmit(form, async (f) => {
      const ratings = {};
      form.querySelectorAll('#ratings .star-input').forEach((el) => { ratings[el.dataset.rating] = el.dataset.value ? Number(el.dataset.value) : null; });
      const payload = {
        position: f.position,
        process_date: f.process_date,
        stage_reached: f.stage_reached,
        outcome: f.outcome,
        ghosted: f.ghosted,
        interview_rounds: f.interview_rounds,
        process_weeks: f.process_weeks,
        difficulty: form.querySelector('[data-rating=difficulty]').dataset.value || null,
        ratings,
        title: f.title,
        body: f.body,
        anonymous: f.anonymous,
        attest_hiring_process_only: f.attest_hiring_process_only,
      };
      if (!payload.attest_hiring_process_only) throw new Error('Please confirm your review is only about the hiring/interview process.');
      if (EMPLOYMENT_HINTS.test(`${f.title} ${f.body}`) &&
          !(await askConfirm('Parts of your review sound like they describe working at the company. JobHub reviews are only about the hiring process — reviews about employment get reported and hidden.\n\nPublish anyway?'))) return;

      let saved;
      if (editing) {
        saved = (await api('PUT', `/api/reviews/${existing.id}`, payload)).review;
      } else {
        if (!f.company_id) throw new Error('Please choose a company.');
        payload.company_id = Number(f.company_id);
        if (f.target === 'new') {
          if (!f.new_name.trim()) throw new Error("Please enter the person's name.");
          try {
            payload.contact_id = (await POST(`/api/companies/${f.company_id}/contacts`, { name: f.new_name, role: f.new_role, title: f.new_title })).contact.id;
          } catch (err) {
            if (err.status === 409 && err.data.contact_id) payload.contact_id = err.data.contact_id; else throw err;
          }
        } else if (f.target !== 'company') {
          payload.contact_id = Number(f.target);
        }
        try {
          saved = (await POST('/api/reviews', payload)).review;
        } catch (err) {
          if (err.status === 409 && err.data.review_id) {
            toast('You already reviewed this — edit your review instead.');
            go(`#/review/edit/${err.data.review_id}`);
            return;
          }
          throw err;
        }
      }
      toast(editing ? 'Review updated.' : 'Thanks! Your review is live.');
      go(saved.contact ? `#/people/${saved.contact.id}` : `#/companies/${saved.company.id}`);
    });
  };

  views.forum = async (params, query) => {
    const category = params[0] || '';
    const q = query.q || '';
    const sort = query.sort || '';
    const [{ categories }, { threads }] = await Promise.all([
      GET('/api/forum/categories'),
      GET(`/api/forum/threads?category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}&sort=${sort}`),
    ]);
    const current = categories.find((c) => c.slug === category);
    $app.innerHTML = `
      <div class="section-title" style="margin-top:0">
        <div><h1>${current ? esc(current.name) : 'Community forum'}</h1><p class="muted" style="margin:0">${current ? esc(current.description) : 'Chat, network, swap interview tips and vent about the job hunt.'}</p></div>
        <a class="btn" href="#/forum/new${category ? `?category=${category}` : ''}">＋ New thread</a>
      </div>
      <div class="tabs">
        <a href="#/forum" class="${!category ? 'active' : ''}">All</a>
        ${categories.map((c) => `<a href="#/forum/c/${c.slug}" class="${c.slug === category ? 'active' : ''}">${esc(c.name)} <span class="muted">${c.thread_count}</span></a>`).join('')}
      </div>
      <div class="layout">
        <div>
          <form class="search" id="fsearch" style="margin-bottom:12px">
            <input type="search" name="q" placeholder="Search threads…" value="${esc(q)}"/>
            <select name="sort"><option value="">Latest activity</option><option value="top" ${sort === 'top' ? 'selected' : ''}>Most liked</option></select>
            <button class="btn secondary">Search</button>
          </form>
          <div class="card">${threads.length ? `<ul class="list">${threads.map((t) => threadRow(t, { showCategory: !category })).join('')}</ul>` : '<div class="empty">No threads here yet. Start the conversation!</div>'}</div>
        </div>
        <aside class="stack">
          ${categories.map((c) => `<a class="card" href="#/forum/c/${c.slug}" style="display:block;color:inherit;text-decoration:none"><b>${esc(c.name)}</b><div class="small muted">${esc(c.description)}</div><div class="small muted" style="margin-top:4px">${c.thread_count} threads · ${c.reply_count} replies</div></a>`).join('')}
          <div class="notice small">Be kind. Vent about processes and companies, not individuals' private lives. No doxxing.</div>
        </aside>
      </div>`;
    const fs = document.getElementById('fsearch');
    fs.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = formData(fs);
      go(`#/forum${category ? `/c/${category}` : ''}?q=${encodeURIComponent(f.q)}&sort=${f.sort}`);
    });
    fs.sort.addEventListener('change', () => fs.requestSubmit());
  };

  views.newThread = async (_p, query) => {
    if (needLogin()) return;
    const { companies } = await GET('/api/companies?sort=name');
    $app.innerHTML = `
      <form class="card" id="thread-form" style="max-width:760px;margin:0 auto">
        <h1>Start a thread</h1>
        <div class="form-error"></div>
        <div class="grid grid-2">
          <div class="field"><label>Category *</label><select name="category">${state.meta.forum_categories.map((c) => `<option value="${c.slug}" ${c.slug === query.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>About a company? <span class="hint">(optional)</span></label><select name="company_id"><option value="">—</option>${companies.map((c) => `<option value="${c.id}" ${String(c.id) === query.company ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Title *</label><input type="text" name="title" maxlength="150" required/></div>
        <div class="field"><label>Post *</label><textarea name="body" maxlength="10000" required style="min-height:200px"></textarea></div>
        <div class="row"><button class="btn" type="submit">Post thread</button><a class="btn secondary" href="#/forum">Cancel</a></div>
      </form>`;
    onSubmit(document.getElementById('thread-form'), async (f) => {
      const { thread } = await POST('/api/forum/threads', { ...f, company_id: f.company_id || null });
      go(`#/forum/t/${thread.id}`);
    });
  };

  views.thread = async ([id]) => {
    const { thread: t, posts } = await GET(`/api/forum/threads/${id}`);
    const cat = state.meta.forum_categories.find((c) => c.slug === t.category);
    const authorLine = (a, at) => `<a href="#/u/${a.id}"><b>${esc(a.display_name)}</b></a> ${a.status === 'employed' ? '<span class="badge hired">✓ Hired</span>' : ''} <span class="muted small">· ${timeAgo(at)}</span>`;
    $app.innerHTML = `
      <div style="max-width:820px;margin:0 auto">
        <div class="small" style="margin-bottom:8px"><a href="#/forum">Forum</a> › <a href="#/forum/c/${t.category}">${esc(cat ? cat.name : t.category)}</a></div>
        <div class="card">
          <h1>${esc(t.title)}</h1>
          ${t.company ? `<div class="small muted" style="margin-bottom:8px">About <a href="#/companies/${t.company.id}">${esc(t.company.name)}</a></div>` : ''}
          <div class="post" style="padding-top:8px">
            <span class="avatar">${initials(t.author.display_name)}</span>
            <div class="grow"><div>${authorLine(t.author, t.created_at)}</div><p class="pre" style="margin-top:8px">${esc(t.body)}</p>
              <div class="row"><button class="btn sm ${t.liked ? '' : 'secondary'}" id="like">❤️ <span>${t.like_count}</span></button>
              ${t.is_mine ? '<button class="btn sm ghost" id="del-thread">Delete thread</button>' : ''}</div>
            </div>
          </div>
        </div>
        <div class="section-title"><h2>${posts.length} repl${posts.length === 1 ? 'y' : 'ies'}</h2></div>
        <div class="card" id="posts">
          ${posts.length ? posts.map((p) => `
            <div class="post"><span class="avatar">${initials(p.author.display_name)}</span>
              <div class="grow"><div>${authorLine(p.author, p.created_at)}</div><p class="pre" style="margin:6px 0 0">${esc(p.body)}</p>
              ${p.is_mine ? `<button class="btn link small" data-del-post="${p.id}">Delete</button>` : ''}</div></div>`).join('') : '<p class="muted">No replies yet.</p>'}
        </div>
        ${state.me ? `
          <form class="card" id="reply-form" style="margin-top:16px">
            <div class="form-error"></div>
            <label>Your reply</label>
            <textarea name="body" required maxlength="10000"></textarea>
            <div class="row" style="margin-top:10px"><button class="btn" type="submit">Reply</button></div>
          </form>` : `<div class="card" style="margin-top:16px"><a href="#/login?next=${encodeURIComponent(location.hash)}">Log in</a> or <a href="#/register">join</a> to reply.</div>`}
      </div>`;
    document.getElementById('like').addEventListener('click', async (e) => {
      if (needLogin()) return;
      try {
        const r = await POST(`/api/forum/threads/${t.id}/like`);
        e.currentTarget.classList.toggle('secondary', !r.liked);
        e.currentTarget.querySelector('span').textContent = r.like_count;
      } catch (err) { toast(err.message); }
    });
    const del = document.getElementById('del-thread');
    if (del) del.addEventListener('click', async () => {
      if (!(await askConfirm('Delete this thread and all replies?'))) return;
      await api('DELETE', `/api/forum/threads/${t.id}`);
      toast('Thread deleted.');
      go('#/forum');
    });
    document.getElementById('posts').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del-post]');
      if (!b || !(await askConfirm('Delete your reply?'))) return;
      await api('DELETE', `/api/forum/posts/${b.dataset.delPost}`);
      render();
    });
    const rf = document.getElementById('reply-form');
    if (rf) onSubmit(rf, async (f) => { await POST(`/api/forum/threads/${t.id}/posts`, f); toast('Reply posted.'); render(); });
  };

  views.members = async (_p, query) => {
    const q = query.q || '';
    const status = query.status || '';
    const { users } = await GET(`/api/users?q=${encodeURIComponent(q)}&status=${status}`);
    $app.innerHTML = `
      <div class="section-title" style="margin-top:0"><div><h1>Members</h1><p class="muted" style="margin:0">Find people in your field, connect, and celebrate when they land a role.</p></div></div>
      <form class="search" id="msearch">
        <input type="search" name="q" placeholder="Search by name, role, location…" value="${esc(q)}"/>
        <select name="status"><option value="">Everyone</option><option value="seeking" ${status === 'seeking' ? 'selected' : ''}>Job seeking</option><option value="employed" ${status === 'employed' ? 'selected' : ''}>Hired</option></select>
        <button class="btn secondary">Search</button>
      </form>
      <div class="grid grid-2" id="members" style="margin-top:16px">
        ${users.length ? users.map((u) => `
          <div class="card person">
            <span class="avatar">${initials(u.display_name)}</span>
            <div class="grow">
              <a href="#/u/${u.id}"><b>${esc(u.display_name)}</b></a> ${statusBadge(u)}
              <div class="small muted">${esc(u.headline || u.target_role || '')}${u.location ? ` · ${esc(u.location)}` : ''}</div>
            </div>
            ${connectButton(u, u.connection)}
          </div>`).join('') : '<div class="card empty">No members found.</div>'}
      </div>`;
    const ms = document.getElementById('msearch');
    ms.addEventListener('submit', (e) => { e.preventDefault(); const f = formData(ms); go(`#/members?q=${encodeURIComponent(f.q)}&status=${f.status}`); });
    ms.status.addEventListener('change', () => ms.requestSubmit());
    bindConnectButtons(document.getElementById('members'), render);
  };

  views.network = async () => {
    if (needLogin()) return;
    const d = await GET('/api/connections');
    const person = (c, actions) => `
      <li class="person"><span class="avatar">${initials(c.user.display_name)}</span>
        <div class="grow"><a href="#/u/${c.user.id}"><b>${esc(c.user.display_name)}</b></a> ${statusBadge(c.user)}
          <div class="small muted">${c.user.status === 'employed' && (c.user.employed_title || c.user.employed_company)
            ? `🎉 ${esc([c.user.employed_title, c.user.employed_company].filter(Boolean).join(' at '))}`
            : esc(c.user.headline || c.user.target_role || '')}</div></div>
        <div class="row">${actions}</div></li>`;
    $app.innerHTML = `
      <div class="section-title" style="margin-top:0"><h1>Your network</h1><a class="btn secondary" href="#/members">Find people</a></div>
      <div class="layout" id="network">
        <div class="card">
          <h2>Connections (${d.connections.length})</h2>
          <p class="small muted">When you mark yourself as hired, everyone here gets notified.</p>
          ${d.connections.length ? `<ul class="list">${d.connections.map((c) => person(c, `<button class="btn sm ghost" data-remove="${c.id}">Remove</button>`)).join('')}</ul>` : '<div class="empty">No connections yet. <a href="#/members">Find people to connect with</a>.</div>'}
        </div>
        <aside class="stack">
          <div class="card"><h3>Requests for you (${d.incoming.length})</h3>
            ${d.incoming.length ? `<ul class="list">${d.incoming.map((c) => person(c, `<button class="btn sm good" data-accept="${c.id}">Accept</button><button class="btn sm ghost" data-cancel="${c.id}">Decline</button>`)).join('')}</ul>` : '<p class="muted small">None right now.</p>'}</div>
          <div class="card"><h3>Sent requests (${d.outgoing.length})</h3>
            ${d.outgoing.length ? `<ul class="list">${d.outgoing.map((c) => person(c, `<button class="btn sm ghost" data-cancel="${c.id}">Cancel</button>`)).join('')}</ul>` : '<p class="muted small">None pending.</p>'}</div>
        </aside>
      </div>`;
    bindConnectButtons(document.getElementById('network'), render);
  };

  views.notifications = async () => {
    if (needLogin()) return;
    const d = await GET('/api/notifications');
    const icon = { employed: '🎉', connection_request: '🤝', connection_accepted: '✅', reply: '💬' };
    $app.innerHTML = `
      <div style="max-width:760px;margin:0 auto">
        <div class="section-title" style="margin-top:0"><h1>Notifications</h1>${d.unread ? '<button class="btn sm secondary" id="read-all">Mark all read</button>' : ''}</div>
        <div class="card" id="notifs">
          ${d.notifications.length ? d.notifications.map((n) => `
            <a class="notif ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/notifications')}" data-id="${n.id}" style="color:inherit;text-decoration:none">
              <span class="icon">${icon[n.type] || '🔔'}</span>
              <div><div>${esc(n.message)}</div><div class="small muted">${timeAgo(n.created_at)}</div></div>
            </a>`).join('') : '<div class="empty">You’re all caught up.</div>'}
        </div>
      </div>`;
    const ra = document.getElementById('read-all');
    if (ra) ra.addEventListener('click', async () => { await POST('/api/notifications/read-all'); state.unread = 0; renderNav(); render(); });
    document.getElementById('notifs').addEventListener('click', (e) => {
      const a = e.target.closest('[data-id]');
      if (a && a.classList.contains('unread')) {
        POST(`/api/notifications/${a.dataset.id}/read`).then(refreshUnread).catch(() => {});
      }
    });
  };

  views.profile = async ([id]) => {
    const d = await GET(`/api/users/${id}`);
    const u = d.user;
    const isSelf = d.connection.state === 'self';
    $app.innerHTML = `
      <div class="card">
        <div class="person" style="align-items:flex-start">
          <span class="avatar lg">${initials(u.display_name)}</span>
          <div class="grow">
            <h1 style="margin-bottom:4px">${esc(u.display_name)} ${statusBadge(u)}</h1>
            ${u.headline ? `<div>${esc(u.headline)}</div>` : ''}
            <div class="small muted">${[u.target_role && `Looking for: ${u.target_role}`, u.location].filter(Boolean).map(esc).join(' · ')}</div>
            ${u.status === 'employed' ? `<div class="notice small" style="margin-top:10px;display:inline-block">🎉 Landed a job${u.employed_title || u.employed_company ? `: <b>${esc([u.employed_title, u.employed_company].filter(Boolean).join(' at '))}</b>` : ''}${u.employed_at ? ` · ${timeAgo(u.employed_at)}` : ''}</div>` : ''}
            ${u.bio ? `<p class="pre" style="margin-top:10px">${esc(u.bio)}</p>` : ''}
            <div class="small muted" style="margin-top:6px">${d.stats.connections} connections · ${d.stats.reviews} reviews · ${d.stats.threads} threads · ${d.stats.replies} replies · joined ${timeAgo(u.created_at)}</div>
          </div>
          <div id="conn">${isSelf ? '<a class="btn secondary" href="#/me">Edit profile</a>' : connectButton(u, d.connection)}</div>
        </div>
      </div>
      <div class="layout" style="margin-top:16px">
        <div>
          <div class="section-title" style="margin-top:0"><h2>${isSelf ? 'Your reviews' : 'Public reviews'}</h2></div>
          ${isSelf ? '<p class="small muted">Only you can see your anonymous reviews listed here.</p>' : ''}
          <div id="reviews">${d.reviews.length ? d.reviews.map((r) => reviewCard(r, { showTarget: true })).join('') : '<div class="card empty">No public reviews.</div>'}</div>
        </div>
        <aside class="card"><h3>Threads</h3>${d.threads.length ? `<ul class="list small">${d.threads.map((t) => `<li><a href="#/forum/t/${t.id}">${esc(t.title)}</a> <span class="muted">· ${t.reply_count} replies</span></li>`).join('')}</ul>` : '<p class="muted small">No threads yet.</p>'}</aside>
      </div>`;
    bindReviewActions(document.getElementById('reviews'), render);
    bindConnectButtons(document.getElementById('conn'), render);
  };

  views.me = async () => {
    if (needLogin()) return;
    const u = state.me;
    const employed = u.status === 'employed';
    const { connections } = await GET('/api/connections');
    $app.innerHTML = `
      <div class="grid grid-2" style="align-items:start">
        <div class="card" id="employment">
          <h2>${employed ? '🎉 You’re hired!' : 'Job search status'}</h2>
          ${employed ? `
            <p>You're marked as <span class="badge hired">✓ Hired</span>${u.employed_title || u.employed_company ? ` — <b>${esc([u.employed_title, u.employed_company].filter(Boolean).join(' at '))}</b>` : ''}.</p>
            <form id="emp-update">
              <div class="form-error"></div>
              <div class="grid grid-2">
                <div class="field"><label>Job title</label><input type="text" name="title" maxlength="120" value="${esc(u.employed_title || '')}"/></div>
                <div class="field"><label>Company</label><input type="text" name="company" maxlength="120" value="${esc(u.employed_company || '')}"/></div>
              </div>
              <div class="row"><button class="btn secondary" type="submit">Update details</button><button class="btn ghost" type="button" id="back-to-seeking">I'm job seeking again</button></div>
            </form>` : `
            <p>You're currently <span class="badge seeking">Job seeking</span>. Landed something? Let your network know!</p>
            <form id="emp-form">
              <div class="form-error"></div>
              <div class="grid grid-2">
                <div class="field"><label>Job title</label><input type="text" name="title" maxlength="120" placeholder="e.g. Senior Analyst"/></div>
                <div class="field"><label>Company</label><input type="text" name="company" maxlength="120"/></div>
              </div>
              <div class="field"><label class="check"><input type="checkbox" name="share_in_forum" checked/> Also share the news in <b>Wins & Celebrations</b></label></div>
              <div class="field"><label>Message for the community <span class="hint">(optional)</span></label><textarea name="message" maxlength="2000" style="min-height:80px" placeholder="Any tips that helped you land it?"></textarea></div>
              <p class="small muted">🔔 Your ${connections.length} connection${connections.length === 1 ? '' : 's'} will get a notification.</p>
              <button class="btn good" type="submit">🎉 Mark me as employed</button>
            </form>`}
        </div>
        <form class="card" id="profile-form">
          <h2>Your profile</h2>
          <div class="form-error"></div>
          <div class="field"><label>Display name *</label><input type="text" name="display_name" maxlength="60" required value="${esc(u.display_name)}"/></div>
          <div class="field"><label>Headline</label><input type="text" name="headline" maxlength="120" value="${esc(u.headline)}" placeholder="e.g. UX designer, 6 yrs, open to remote"/></div>
          <div class="grid grid-2">
            <div class="field"><label>Target role</label><input type="text" name="target_role" maxlength="120" value="${esc(u.target_role)}"/></div>
            <div class="field"><label>Location</label><input type="text" name="location" maxlength="120" value="${esc(u.location)}"/></div>
          </div>
          <div class="field"><label>Bio</label><textarea name="bio" maxlength="2000">${esc(u.bio)}</textarea></div>
          <div class="row between">
            <div class="row"><button class="btn" type="submit">Save profile</button><a class="btn secondary" href="#/u/${u.id}">View public profile</a></div>
            <button class="btn ghost" type="button" id="logout">Log out</button>
          </div>
          <p class="small muted" style="margin-top:12px">Signed in as ${esc(u.email)}. Your email is never shown publicly.</p>
        </form>
      </div>`;

    const setMe = (user) => { state.me = user; renderNav(); };
    onSubmit(document.getElementById('profile-form'), async (f) => {
      setMe((await api('PATCH', '/api/me', f)).user);
      toast('Profile saved.');
    });
    document.getElementById('logout').addEventListener('click', async () => {
      await POST('/api/auth/logout');
      state.me = null;
      state.unread = 0;
      renderNav();
      go('#/');
    });
    const ef = document.getElementById('emp-form');
    if (ef) onSubmit(ef, async (f) => {
      const r = await POST('/api/me/employment', { status: 'employed', ...f });
      setMe(r.user);
      toast(`Congrats! 🎉 ${r.notified} connection${r.notified === 1 ? '' : 's'} notified.`);
      if (r.thread_id) go(`#/forum/t/${r.thread_id}`); else render();
    });
    const eu = document.getElementById('emp-update');
    if (eu) {
      onSubmit(eu, async (f) => {
        setMe((await POST('/api/me/employment', { status: 'employed', ...f })).user);
        toast('Updated.');
        render();
      });
      document.getElementById('back-to-seeking').addEventListener('click', async () => {
        if (!(await askConfirm('Switch your status back to job seeking?'))) return;
        setMe((await POST('/api/me/employment', { status: 'seeking' })).user);
        toast('Status updated. You’ve got this. 💪');
        render();
      });
    }
  };

  function authView(mode) {
    return async (_p, query) => {
      if (state.me) { go(query.next || '#/'); return; }
      const reg = mode === 'register';
      $app.innerHTML = `
        <form class="card" id="auth-form" style="max-width:440px;margin:24px auto">
          <h1>${reg ? 'Join JobHub' : 'Welcome back'}</h1>
          <p class="muted">${reg ? 'Rate hiring experiences, connect with other job seekers, and celebrate wins together.' : 'Log in to rate, post and connect.'}</p>
          <div class="form-error"></div>
          ${reg ? '<div class="field"><label>Display name *</label><input type="text" name="display_name" required maxlength="60" autocomplete="nickname"/><div class="hint">Shown on forum posts & non-anonymous reviews. Reviews are anonymous by default.</div></div>' : ''}
          <div class="field"><label>Email *</label><input type="email" name="email" required autocomplete="email"/></div>
          <div class="field"><label>Password *</label><input type="password" name="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}"/>${reg ? '<div class="hint">At least 8 characters.</div>' : ''}</div>
          ${reg ? '<div class="field"><label>What role are you looking for?</label><input type="text" name="target_role" maxlength="120" placeholder="e.g. Product Manager"/></div>' : ''}
          <button class="btn" type="submit" style="width:100%">${reg ? 'Create account' : 'Log in'}</button>
          <p class="small muted" style="margin-top:14px;text-align:center">${reg ? 'Already a member? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
        </form>`;
      onSubmit(document.getElementById('auth-form'), async (f) => {
        const { user } = await POST(`/api/auth/${reg ? 'register' : 'login'}`, f);
        state.me = user;
        renderNav();
        refreshUnread();
        toast(reg ? `Welcome, ${user.display_name}!` : 'Logged in.');
        go(query.next || (reg ? '#/me' : '#/'));
      });
    };
  }
  views.login = authView('login');
  views.register = authView('register');

  // ------------------------------------------------------------------ router
  const routes = [
    [/^\/$/, views.home],
    [/^\/companies$/, views.companies],
    [/^\/companies\/(\d+)$/, views.company],
    [/^\/people\/(\d+)$/, views.person],
    [/^\/review\/new$/, views.reviewForm],
    [/^\/review\/(edit)\/(\d+)$/, views.reviewForm],
    [/^\/forum$/, views.forum],
    [/^\/forum\/c\/([\w-]+)$/, views.forum],
    [/^\/forum\/new$/, views.newThread],
    [/^\/forum\/t\/(\d+)$/, views.thread],
    [/^\/members$/, views.members],
    [/^\/network$/, views.network],
    [/^\/notifications$/, views.notifications],
    [/^\/u\/(\d+)$/, views.profile],
    [/^\/me$/, views.me],
    [/^\/login$/, views.login],
    [/^\/register$/, views.register],
  ];

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const { path, query } = parseHash();
    document.getElementById('nav').classList.remove('open');
    renderNav();
    const match = routes.find(([re]) => re.test(path));
    if (!match) { $app.innerHTML = '<div class="card empty"><h1>Page not found</h1><a href="#/">Go home</a></div>'; return; }
    $app.innerHTML = '<div class="loading">Loading…</div>';
    try {
      await match[1](path.match(match[0]).slice(1), query);
      if (seq === renderSeq) { window.scrollTo(0, 0); }
    } catch (err) {
      if (seq !== renderSeq) return;
      if (err.status === 401) { state.me = null; renderNav(); needLogin(); return; }
      $app.innerHTML = `<div class="card empty"><h1>${err.status === 404 ? 'Not found' : 'Something went wrong'}</h1><p>${esc(err.message)}</p><a href="#/">Go home</a></div>`;
    }
  }

  async function boot() {
    try {
      const [meta, me] = await Promise.all([GET('/api/meta'), GET('/api/auth/me')]);
      state.meta = meta;
      state.me = me.user;
    } catch (err) {
      $app.innerHTML = `<div class="card empty">Could not reach the server. ${esc(err.message)}</div>`;
      return;
    }
    window.addEventListener('hashchange', render);
    await render();
    refreshUnread();
    setInterval(refreshUnread, 30000);
  }

  boot();
})();
