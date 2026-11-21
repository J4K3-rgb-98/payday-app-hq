// ---------- App ----------
{
// Stratrix keeps its own storage keys: it shares a web address (origin) with Payday HQ, so it must never read or overwrite that app's data.
const STORE_KEY = 'stratrix-state', THEME_KEY = 'stratrix-theme';
// Saved data carries a version number. Each step below upgrades data from one version to the next, so updates never break old data or backups.
const DATA_VERSION = 2;
const MIGRATIONS = {
  // 1 -> 2: Payday HQ data (version 1) brought into Stratrix. Nothing to reshape yet; later stages add steps here.
  1: o => o,
};
function migrate(o) {
  o = o || {};
  let v = Number(o.v) || 1;
  while (v < DATA_VERSION) { o = (MIGRATIONS[v] || (x => x))(o); v++; }
  o.v = DATA_VERSION;
  return o;
}
const resolvedTheme = () => S.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = (n, dp = 2) => (n < 0 ? '−' : '') + '£' + Math.abs(+n || 0).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = n => Math.round(Math.max(0, Math.min(1, n || 0)) * 100) + '%';
const todayIso = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
const fDate = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' }) : '';
const fMonth = s => s ? new Date(s.slice(0, 7) + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
const daysTo = s => Math.round((new Date(s + 'T00:00:00Z') - new Date(todayIso() + 'T00:00:00Z')) / 864e5);

let S = clone(DEFAULT_STATE), rows = [], B = {}, cur = 0, viewIdx = null, logEdit = null, logKind = 'card', logDir = 'in';
let dbRef = null, saveTimer = null, lastSaved = { config: '', logs: '' }, writing = Promise.resolve(), storageMode = 'loading';
const KINDS = { card: 'Credit card', jess: 'Jess', ef: 'Emergency fund', savings: 'Savings', sinking: 'Sinking funds', undecided: 'Undecided', invest: 'Investments' };
const kindLabel = l => l.kind === 'goal' ? (S.goals.find(g => g.id === l.goal)?.name || 'Goal') : KINDS[l.kind];

// ----- persistence: per-person private documents, local copy as fallback -----
const split = s => { const { logs, investValues, checks, celebrated, ...config } = s; return { config, logs: { logs, investValues, checks, celebrated } }; };
function applyLoaded(config, logs) {
  S = migrate(Object.assign(clone(DEFAULT_STATE), config || {}, logs || {}));
  for (const k of ['logs', 'investValues', 'goals', 'dds', 'joint', 'sinking', 'salary', 'budget', 'investPlan']) if (!Array.isArray(S[k])) S[k] = [];
  for (const k of ['checks', 'celebrated', 'actualPay', 'paydayOverrides']) if (!S[k] || typeof S[k] !== 'object') S[k] = {};
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); if (S.theme) localStorage.setItem(THEME_KEY, S.theme); } catch (e) { }
  if (!dbRef) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const parts = split(S);
    for (const key of ['config', 'logs']) {
      const body = JSON.stringify(parts[key]);
      if (body === lastSaved[key]) continue;
      lastSaved[key] = body;
      writing = writing.then(() => dbRef[key].set(JSON.parse(body))).catch(e => toast(e && e.code === 'quota_exceeded' ? 'Storage is full: export a backup and clear old entries.' : 'Couldn’t save just now. Your change is kept on this device.'));
    }
  }, 500);
}
const IS_PWA = !(window.claude && window.claude.use);
async function connect() {
  try { const local = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (local) { applyLoaded(local); } } catch (e) { }
  recalc(); render();
  if (IS_PWA) { storageMode = 'device'; try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { } recalc(); milestones(true); return render(); }
  const timer = setTimeout(() => { if (storageMode === 'loading') { storageMode = 'local'; render(); } }, 10000);
  try {
    if (!window.claude || !window.claude.use) throw 0;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    const id = user && await user.id();
    if (!db || !id) throw 0;
    const base = 'data/users/' + id;
    const refs = { config: db.doc(base + '/config'), logs: db.doc(base + '/logs') };
    const [c, l] = await Promise.all([refs.config.get(), refs.logs.get()]);
    clearTimeout(timer);
    if (c.exists || l.exists) applyLoaded(c.exists ? clone(c.data()) : split(S).config, l.exists ? clone(l.data()) : split(S).logs);
    dbRef = refs; storageMode = 'cloud';
    const parts = split(S); lastSaved = { config: c.exists ? JSON.stringify(c.data()) : '', logs: l.exists ? JSON.stringify(l.data()) : '' };
    if (!c.exists || !l.exists) save();
    void parts;
  } catch (e) { clearTimeout(timer); storageMode = 'local'; }
  recalc(); milestones(true); render();
}

// ----- calculations -----
function recalc() {
  rows = plan(S, todayIso());
  B = balances(S);
  cur = currentIndex(rows, todayIso());
  if (viewIdx == null) viewIdx = cur;
}
const goalsNow = () => goalNeeds(S, rows, cur);
function clearMonth(field) {     // month a balance reaches zero in the plan
  if (rows[0][field] <= 0) return 'done';
  const n = rows.filter(r => r[field] > 0.005).length;
  return n >= rows.length ? null : rows[n - 1];
}

// ----- milestones and confetti -----
function milestoneItems() {
  const items = [
    { key: 'card', label: 'Credit card', p: S.card.balance ? 1 - B.card / S.card.balance : 0, verb: 'destroyed' },
    { key: 'jess', label: 'Jess', p: S.jess.owed ? 1 - B.jess / S.jess.owed : 0, verb: 'repaid' },
    { key: 'ef', label: 'Emergency fund', p: S.efTarget ? B.ef / S.efTarget : 0, verb: 'saved' },
  ];
  if (S.pots.savings.target) items.push({ key: 'savings', label: 'Savings', p: B.savings / S.pots.savings.target, verb: 'saved' });
  if (S.investments.target) items.push({ key: 'invest', label: 'Investments', p: B.invValue / S.investments.target, verb: 'of target' });
  for (const g of goalsNow()) if (g.target > 0) items.push({ key: 'goal-' + g.id, label: g.name, p: g.saved / g.target, verb: 'saved' });
  const total = S.card.balance + S.jess.owed;
  items.push({ key: 'debt', label: 'All debt', p: total ? 1 - (B.card + B.jess) / total : 0, verb: 'destroyed' });
  return items;
}
function milestones(silent) {
  const hits = [];
  for (const it of milestoneItems()) for (const t of [25, 50, 75, 100]) {
    const k = it.key + '-' + t;
    if (it.p * 100 >= t - 0.001 && !S.celebrated[k]) { S.celebrated[k] = true; hits.push({ ...it, t }); }
  }
  if (hits.length && !silent) {
    const top = hits.sort((a, b) => b.t - a.t)[0];
    confetti(top.t === 100);
    if (hits.length) save();
    return top.t === 100 ? `${top.label}: ${top.verb === 'destroyed' ? 'destroyed' : top.verb === 'repaid' ? 'fully repaid' : 'target reached'}!` : `${top.label}: ${top.t}% ${top.verb}!`;
  }
  if (hits.length) save();
  return null;
}
function confetti(big) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti'), x = c.getContext('2d'), W = c.width = innerWidth * devicePixelRatio, H = c.height = innerHeight * devicePixelRatio;
  const cols = ['#146356', '#2BB58A', '#7CE7C0', '#DDB13E', '#A9442B', '#EFE3C4'];
  const ps = Array.from({ length: big ? 220 : 140 }, () => ({ x: W * (0.2 + Math.random() * 0.6), y: H * 0.35, vx: (Math.random() - 0.5) * 18 * devicePixelRatio, vy: (-8 - Math.random() * 14) * devicePixelRatio, s: (5 + Math.random() * 6) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  const step = t => {
    x.clearRect(0, 0, W, H);
    for (const p of ps) { p.vy += 0.45 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); x.restore(); }
    if (t - t0 < 2600) requestAnimationFrame(step); else x.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
}
let toastTimer = null;
function toast(msg, undo, ms = 3200) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}`;
  t.classList.add('on'); t._undo = undo;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

// ----- shared pieces -----
const meter = (p, cls = '') => `<div class="meter ${cls}"><i style="width:${pct(p)}"></i></div>`;
const badges = p => `<div class="badges">${[25, 50, 75, 100].map(t => `<span class="${p * 100 >= t - 0.001 ? 'on' : ''}">${t === 100 ? 'Done' : t + '%'}</span>`).join('')}</div>`;
const acct = a => `<span class="acct ${a.toLowerCase()}">${a}</span>`;

// ----- views -----
function viewHome() {
  const total = S.card.balance + S.jess.owed, left = B.card + B.jess, paid = total - left, p = total ? paid / total : 0;
  const cm = clearMonth('T'), jm = clearMonth('U');
  const free = [cm, jm].every(x => x === 'done') ? 'done' : ([cm, jm].includes(null) ? null : [cm, jm].filter(x => x !== 'done').sort((a, b) => a.D < b.D ? -1 : 1).pop());
  const r = rows[cur], np = todayIso() < r.D ? r.D : r.E;
  const short = rows.slice(cur).filter(x => x.S < -0.005).length;
  const G = goalsNow();
  const cards = [
    { k: 'card', t: 'Credit card · TSC', v: B.card, sub: S.card.balance ? `${pct(1 - B.card / S.card.balance)} destroyed of ${gbp(S.card.balance, 0)}` : 'Not set up', p: S.card.balance ? 1 - B.card / S.card.balance : null, foot: cm === 'done' ? 'Cleared' : cm ? 'Clear by ' + fMonth(cm.A) : 'Not cleared within plan', debt: 1 },
    { k: 'jess', t: 'Jess', v: B.jess, sub: S.jess.owed ? `${pct(1 - B.jess / S.jess.owed)} repaid of ${gbp(S.jess.owed, 0)}` : 'Not set up', p: S.jess.owed ? 1 - B.jess / S.jess.owed : null, foot: jm === 'done' ? 'Repaid' : jm ? 'Repaid by ' + fMonth(jm.A) : 'Not repaid within plan', debt: 1 },
    { k: 'sinking', t: 'Sinking funds', v: B.sinking, sub: `${gbp(r.O)} set aside each period`, p: null, foot: S.sinking.filter(s => s.active && s.annual > 0).map(s => s.name).join(', ') || 'No costs added' },
    { k: 'undecided', t: 'Undecided', v: B.undecided, sub: 'Waiting for a job', p: null, foot: 'Move it with a log entry' },
  ];
  const pots = [
    { t: 'Emergency fund', v: B.ef, target: S.efTarget, plan: r.M, note: 'No target set' },
    { t: 'Savings', v: B.savings, target: S.pots.savings.target, plan: r.S > 0 ? r.S : 0, note: 'No target set' },
    { t: 'Investments', v: B.invValue, target: S.investments.target, plan: r.INV, note: B.invPaid || B.invValue ? 'No target set' : 'Not started yet',
      extra: B.invPaid || B.invValue ? `${B.invGrowth >= 0 ? '+' : '−'}${gbp(Math.abs(B.invGrowth))} growth` : '' },
  ];
  const saved = pots.reduce((a, x) => a + x.v, 0), planned = pots.reduce((a, x) => a + x.plan, 0);
  const targetTotal = pots.every(x => x.target) ? pots.reduce((a, x) => a + x.target, 0) : 0;
  const needBackup = IS_PWA && !S.blank && S.logs.length && (!S.lastBackup || daysTo(S.lastBackup) < -30);
  return `
  ${S.blank ? `<section class="card welcome"><h1>Welcome to Stratrix</h1><p class="muted">Bring your figures across from your backup file, or set things up yourself in Manage.</p>
    <div class="actions left"><label class="btn file">Restore my backup<input type="file" accept=".json,application/json" id="restore"></label><a class="btn ghost" href="#manage">Set up in Manage</a></div></section>` : ''}
  ${needBackup ? `<div class="note">It’s been a while since your last backup. <button class="linkish" data-act="backup">Download one now</button></div>` : ''}
  ${short ? `<div class="alert">Your plan is short in ${short} pay period${short > 1 ? 's' : ''}. Lower the spending budget, a goal or investments. <a href="#payday">See payday</a></div>` : ''}
  <section class="hero card">
    <div class="hero-text">
      <p class="label">Debt destroyed</p>
      <p class="huge">${gbp(paid)}</p>
      <p class="muted">of ${gbp(total)} · ${pct(p)}</p>
      ${meter(p, 'big')}
      <p class="hero-foot">${free === 'done' ? 'Debt-free. Every payday is yours now.' : free ? `Debt-free by <b>${fMonth(free.A)}</b>, ${daysTo(free.D).toLocaleString('en-GB')} days to go.` : 'Not debt-free within the plan yet.'}</p>
      <p class="muted small">Next payday ${fDate(np)}, in ${daysTo(np)} days.</p>
    </div>
    <div class="fig" id="debtChart" role="img" aria-label="Debt countdown chart"></div>
  </section>
  <section class="hero card grow">
    <div class="hero-text">
      <p class="label">Savings built</p>
      <p class="huge">${gbp(saved)}</p>
      <p class="muted">${planned > 0 ? `+${gbp(planned)} planned this pay period` : 'Nothing planned this pay period'}</p>
      ${targetTotal ? meter(saved / targetTotal, 'big') + `<p class="muted small">${pct(saved / targetTotal)} of your ${gbp(targetTotal, 0)} targets</p>` : ''}
      <div class="tallies">${pots.map(x => `
        <div class="tally">
          <p class="label">${x.t}</p>
          <p class="num">${gbp(x.v)}</p>
          ${x.target ? meter(x.v / x.target) + `<p class="muted small">${pct(x.v / x.target)} of ${gbp(x.target, 0)}</p>` : `<p class="muted small">${x.note}</p>`}
          <p class="muted small">${x.plan > 0 ? '+' + gbp(x.plan) + ' this period' : 'Nothing this period'}</p>
          ${x.extra ? `<p class="muted small">${x.extra}</p>` : ''}
        </div>`).join('')}
      </div>
    </div>
    <div class="fig" id="growChart" role="img" aria-label="Savings growth chart"></div>
  </section>
  <div class="grid">${cards.map(c => `
    <article class="card tile ${c.debt ? 'debt' : ''}">
      <p class="label">${esc(c.t)}</p>
      <p class="num">${gbp(c.v)}</p>
      <p class="muted small">${esc(c.sub)}</p>
      ${c.p != null ? meter(c.p) + badges(c.p) : ''}
      <p class="foot">${esc(c.foot)}</p>
    </article>`).join('')}
  </div>
  <div class="head-row"><h2>Goals</h2><a class="btn ghost" href="#goals">Manage goals</a></div>
  ${G.length ? `<div class="grid goals">${G.map(goalTile).join('')}</div>` : `<div class="card empty">No goals yet. <a href="#goals">Add one</a>, like a holiday or a car.</div>`}`;
}
function goalTile(g) {
  const p = g.target ? g.saved / g.target : 0;
  const status = g.target && g.saved >= g.target ? 'Done: its money now rolls into savings' : g.active === false ? 'Paused' : g.need ? `${gbp(g.need)} this period` : 'Add a target and month';
  return `<article class="card tile">
    <p class="label">${esc(g.icon || '')} ${esc(g.name)}</p>
    <p class="num">${gbp(g.saved)}</p>
    <p class="muted small">${pct(p)} of ${gbp(g.target, 0)}${g.by && g.by !== '0000-00-00' ? ' · by ' + fMonth(g.by) : ''}</p>
    ${meter(p)}${badges(p)}<p class="foot">${esc(status)}</p></article>`;
}

function viewPayday() {
  const r = rows[viewIdx], key = r.A.slice(0, 7), ck = S.checks[key] || {};
  const dds = S.dds.flatMap(d => ddDates(d, r.D, r.E).map(dt => ({ dt, name: d.name, amt: d.amt }))).sort((a, b) => a.dt < b.dt ? -1 : 1);
  const G = goalNeeds(S, rows, cur).filter(g => g.by >= r.A && g.need > 0);
  const steps = [
    { id: 'pay', n: 1, a: 'SDR', t: 'Salary lands in Santander', v: r.H, extra: `<label class="inline">Actual pay <input type="number" step="0.01" inputmode="decimal" data-pay="${key}" value="${S.actualPay[key] ?? ''}" placeholder="${eff(S.salary, r.A).toFixed(2)}"></label>` },
    { id: 'dd', n: 2, a: 'SDR', t: 'Leave in Santander for direct debits', v: r.I, extra: dds.length ? `<details><summary>${dds.length} due before next payday</summary><ul class="mini">${dds.map(d => `<li><span>${fDate(d.dt)} · ${esc(d.name)}</span><span>${gbp(d.amt)}</span></li>`).join('')}</ul></details>` : '' },
    { id: 'card', n: 3, a: 'TSC', t: 'Pay the credit card from Santander', v: r.K },
    { id: 'move', n: 4, a: 'STG', t: 'Move the rest to Starling', v: r.toStarling, extra: `<p class="muted small">Keep your ${gbp(S.buffer, 0)} buffer in Santander on top.</p>` },
    { id: 'joint', a: 'STG', t: 'Joint account', v: r.J },
    { id: 'jess', a: 'STG', t: 'Jess', v: r.L },
    { id: 'ef', a: 'STG', t: 'Emergency fund pot', v: r.M },
    { id: 'goals', a: 'STG', t: 'Goals pots', v: r.N, extra: G.length && r.status !== 'Closed' ? `<ul class="mini">${G.map(g => `<li><span>${esc(g.icon || '')} ${esc(g.name)}</span><span>${gbp(g.need)}</span></li>`).join('')}</ul>` : '' },
    { id: 'sink', a: 'STG', t: 'Sinking funds pot', v: r.O },
    { id: 'save', a: 'STG', t: 'Savings pot', v: r.S },
    { id: 'inv', a: 'STG', t: 'Investments', v: r.INV },
  ].filter(s => s.v > 0.004 || s.n || s.id === 'save');
  const done = steps.filter(s => ck[s.id]).length;
  const spend = r.Q + r.R;
  return `
  <div class="period card">
    <button class="icon" data-act="prev" aria-label="Previous pay period" ${viewIdx <= 0 ? 'disabled' : ''}>‹</button>
    <div><p class="label">${r.status === 'Current' ? 'This pay period' : r.status === 'Closed' ? 'Past pay period' : 'Coming up'}</p>
      <h1>${fDate(r.D)} → ${fDate(r.E)}</h1><p class="muted small">${r.days} days · ${done} of ${steps.length} done</p></div>
    <button class="icon" data-act="next" aria-label="Next pay period" ${viewIdx >= rows.length - 1 ? 'disabled' : ''}>›</button>
  </div>
  ${meter(done / steps.length)}
  ${r.S < -0.005 ? `<div class="alert">Short by ${gbp(-r.S)} this period. Lower the spending budget, a goal or investments in Manage.</div>` : ''}
  <ol class="steps">${steps.map((s, i) => `${i === 4 ? '<li class="sep">Then, from Starling</li>' : ''}
    <li class="step card ${ck[s.id] ? 'done' : ''}">
      <label class="tick"><input type="checkbox" data-check="${key}:${s.id}" ${ck[s.id] ? 'checked' : ''}><span>${s.n || ''}</span></label>
      <div class="step-body"><div class="step-top"><span>${esc(s.t)} ${acct(s.a)}</span><b class="${s.v < 0 ? 'neg' : ''}">${gbp(s.v)}</b></div>${s.extra || ''}</div>
    </li>`).join('')}
  </ol>
  <section class="card spend">
    <p class="label">Yours to spend</p><p class="huge">${gbp(spend)}</p>
    <p class="muted">About ${gbp(r.weekly)} a week across ${r.days} days${r.R > 0 ? ` (includes ${gbp(r.R)} spare)` : ''}.</p>
  </section>`;
}

function viewLog() {
  const goals = S.goals;
  const isDebt = logKind === 'card' || logKind === 'jess';
  const e = logEdit || {};
  const list = [...S.logs.map(l => ({ ...l, type: 'log' })), ...S.investValues.map(v => ({ ...v, type: 'value' }))]
    .sort((a, b) => (a.date === b.date ? (b.id > a.id ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 80);
  const kinds = [...Object.entries(KINDS), ...goals.map(g => ['goal:' + g.id, (g.icon ? g.icon + ' ' : '') + g.name])];
  return `
  <section class="card form">
    <h1>${logEdit ? 'Edit entry' : 'Log a payment'}</h1>
    <div class="chips" role="group" aria-label="What it's for">${kinds.map(([k, l]) => `<button class="chip ${logKind === k ? 'on' : ''}" data-kind="${k}">${esc(l)}</button>`).join('')}</div>
    ${isDebt ? '' : `<div class="seg" role="group" aria-label="Direction">
      <button class="${logDir === 'in' ? 'on' : ''}" data-dir="in">${logKind === 'invest' ? 'Paid in' : 'Money in'}</button>
      <button class="${logDir === 'out' ? 'on' : ''}" data-dir="out">${logKind === 'invest' ? 'Withdrawn' : 'Money out'}</button>
      ${logKind === 'invest' ? `<button class="${logDir === 'value' ? 'on' : ''}" data-dir="value">Update value</button>` : ''}</div>`}
    <div class="fields">
      <label>${logDir === 'value' ? 'Value shown in your app' : 'Amount'}<input id="fAmt" type="number" step="0.01" min="0" inputmode="decimal" value="${e.amt ?? e.value ?? ''}" placeholder="0.00"></label>
      <label>Date<input id="fDate" type="date" value="${e.date || todayIso()}"></label>
      ${logDir === 'value' ? '' : `<label class="wide">Note<input id="fNote" type="text" maxlength="80" value="${esc(e.note || '')}" placeholder="Optional"></label>`}
    </div>
    <div class="actions">${logEdit ? '<button class="btn ghost" data-act="cancelEdit">Cancel</button>' : ''}<button class="btn" data-act="saveLog">${logEdit ? 'Save changes' : 'Save'}</button></div>
  </section>
  <div class="head-row"><h2>History</h2></div>
  ${list.length ? `<ul class="history card">${list.map(l => l.type === 'value'
    ? `<li><div><b>Investments value</b><span class="muted small">${fDate(l.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div><span class="amt">${gbp(l.value)}</span><span class="row-btns"><button data-edit-value="${l.id}">Edit</button><button data-del-value="${l.id}">Delete</button></span></li>`
    : `<li><div><b>${esc(kindLabel(l))}</b><span class="muted small">${fDate(l.date, { day: 'numeric', month: 'short', year: 'numeric' })}${l.note ? ' · ' + esc(l.note) : ''}</span></div><span class="amt ${l.dir === 'out' ? 'neg' : ''}">${l.dir === 'out' ? '−' : '+'}${gbp(l.amt).replace('−', '')}</span><span class="row-btns"><button data-edit="${l.id}">Edit</button><button data-del="${l.id}">Delete</button></span></li>`).join('')}</ul>`
    : '<div class="card empty">Nothing logged yet. Every payment you log moves your dashboard.</div>'}`;
}

function viewGoals() {
  const G = goalsNow();
  return `<div class="head-row"><h1>Goals</h1><button class="btn" data-act="newGoal">Add goal</button></div>
  ${G.length ? `<div class="grid goals">${G.map(g => `<div>${goalTile(g)}<div class="tile-actions"><button class="btn ghost" data-loggoal="${g.id}">Log to goal</button><button class="btn ghost" data-editgoal="${g.id}">Edit</button></div></div>`).join('')}</div>` : '<div class="card empty">Add a goal with a target and a month. The plan works out what it needs each payday, and its money rolls into savings once it’s reached.</div>'}
  <div id="goalSheet"></div>`;
}
function goalForm(g) {
  g = g || { id: '', icon: '', name: '', target: '', by: '', active: true };
  return `<section class="card form"><h2>${g.id ? 'Edit goal' : 'New goal'}</h2>
    <div class="fields"><label class="narrow">Icon<input id="gIcon" maxlength="4" value="${esc(g.icon)}" placeholder="✈️"></label>
    <label class="wide">Name<input id="gName" maxlength="40" value="${esc(g.name)}" placeholder="Holiday"></label>
    <label>Target<input id="gTarget" type="number" step="1" min="0" inputmode="decimal" value="${g.target}"></label>
    <label>Reach it by<input id="gBy" type="month" value="${g.by && g.by !== '0000-00-00' ? g.by.slice(0, 7) : ''}"></label>
    <label class="check"><input id="gActive" type="checkbox" ${g.active !== false ? 'checked' : ''}> Active</label></div>
    <div class="actions">${g.id ? `<button class="btn ghost danger" data-delgoal="${g.id}">Delete</button>` : ''}<button class="btn ghost" data-act="closeGoal">Cancel</button><button class="btn" data-savegoal="${g.id}">Save goal</button></div></section>`;
}

// manage: generic editors
const fld = (label, path, type = 'number', extra = '') => {
  const v = path.split('.').reduce((o, k) => o?.[k], S);
  return `<label>${label}<input type="${type}" data-bind="${path}" value="${v ?? ''}" ${type === 'number' ? 'step="0.01" inputmode="decimal"' : ''} ${extra}></label>`;
};
const listEditor = (name, cols, addLabel) => `
  <div class="list" data-listname="${name}">${S[name].map((it, i) => `<div class="lrow">${cols.map(c => c.type === 'check'
    ? `<label class="check"><input type="checkbox" data-list="${name}" data-i="${i}" data-f="${c.f}" ${it[c.f] !== false ? 'checked' : ''}> ${c.l}</label>`
    : c.type === 'select' ? `<label>${c.l}<select data-list="${name}" data-i="${i}" data-f="${c.f}">${c.opts.map(([v, t]) => `<option value="${v}" ${String(it[c.f]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`
    : `<label class="${c.cls || ''}">${c.l}<input type="${c.type || 'text'}" data-list="${name}" data-i="${i}" data-f="${c.f}" value="${esc(it[c.f] ?? '')}" ${c.type === 'number' ? 'step="0.01" inputmode="decimal"' : ''}></label>`).join('')}
    <button class="icon del" data-delrow="${name}:${i}" aria-label="Remove">×</button></div>`).join('')}</div>
  <button class="btn ghost" data-addrow="${name}">${addLabel}</button>`;
function viewManage() {
  const r = rows[cur];
  const ddTotal = S.dds.filter(d => d.active).reduce((a, d) => a + (d.freq === '28' ? d.amt * 13 / 12 : +d.amt), 0);
  const overrides = Object.entries(S.paydayOverrides).sort();
  return `<h1>Manage</h1>
  <details class="card sec" open><summary>Credit card · TSC <span class="muted">${gbp(B.card)} left</span></summary><div class="fields">
    ${fld('Balance', 'card.balance')}${fld('Balance as at', 'card.asAt', 'date')}${fld('0% ends', 'card.promoEnd', 'date')}
    ${fld('Minimum payment', 'card.min')}${fld('Payment while Jess is being repaid', 'card.whileJess')}${fld('Clear over (months, blank = by 0% end)', 'card.clearMonths', 'number', 'step="1"')}</div>
    <p class="muted small">This period: ${gbp(r.K)}. Afterwards the card catches up to clear by the target.</p></details>
  <details class="card sec"><summary>Jess <span class="muted">${gbp(B.jess)} owed</span></summary><div class="fields">
    ${fld('Amount owed', 'jess.owed')}${fld('Owed as at', 'jess.asAt', 'date')}${fld('Repay over (months)', 'jess.months', 'number', 'step="1"')}${fld('Repayments start', 'jess.start', 'month')}</div></details>
  <details class="card sec"><summary>Emergency fund and pots</summary><div class="fields">
    ${fld('Emergency fund target', 'efTarget')}${fld('Emergency fund each month', 'efMonthly')}${fld('Emergency fund opening balance', 'pots.ef.opening')}
    ${fld('Savings opening balance', 'pots.savings.opening')}${fld('Savings target (optional)', 'pots.savings.target')}
    ${fld('Sinking funds opening balance', 'pots.sinking.opening')}${fld('Undecided opening balance', 'pots.undecided.opening')}</div></details>
  <details class="card sec"><summary>Investments <span class="muted">${gbp(B.invValue)}</span></summary><div class="fields">
    ${fld('Opening value', 'investments.opening')}${fld('Target (optional)', 'investments.target')}</div>
    <p class="label">Contribution plan</p>${listEditor('investPlan', [{ f: 'from', l: 'From', type: 'month' }, { f: 'amt', l: 'Monthly', type: 'number' }], 'Add contribution')}</details>
  <details class="card sec"><summary>Salary and spending <span class="muted">${gbp(r.H, 0)} · ${gbp(r.Q, 0)}</span></summary>
    <p class="label">Take-home pay</p>${listEditor('salary', [{ f: 'from', l: 'From', type: 'month' }, { f: 'amt', l: 'Take-home', type: 'number' }], 'Add pay change')}
    <p class="label">Spending budget</p>${listEditor('budget', [{ f: 'from', l: 'From', type: 'month' }, { f: 'amt', l: 'Budget', type: 'number' }], 'Add budget change')}
    <div class="fields"><label>Spare money goes to<select data-bind="spareTo"><option ${S.spareTo === 'Savings' ? 'selected' : ''}>Savings</option><option ${S.spareTo === 'Spending' ? 'selected' : ''}>Spending</option></select></label>
    ${fld('Santander buffer', 'buffer')}</div>
    <p class="muted small">Each change applies from its month onwards, so past months keep what they had.</p></details>
  <details class="card sec"><summary>Paydays <span class="muted">${overrides.length} moved</span></summary>
    <p class="muted small">Payday is the last working day of the month, skipping bank holidays. Move one here when it’s different.</p>
    <div class="list">${overrides.map(([m, d]) => `<div class="lrow"><label>Month<input type="month" value="${m}" data-ovm="${m}"></label><label>Paid on<input type="date" value="${d}" data-ovd="${m}"></label><button class="icon del" data-delov="${m}" aria-label="Remove">×</button></div>`).join('')}</div>
    <button class="btn ghost" data-act="addOv">Move a payday</button></details>
  <details class="card sec" id="dds"><summary>Direct debits <span class="muted">${gbp(ddTotal)} a month on average</span></summary>
    ${listEditor('dds', [{ f: 'name', l: 'Payee', cls: 'wide' }, { f: 'amt', l: 'Amount', type: 'number' }, { f: 'freq', l: 'How often', type: 'select', opts: [['m', 'Monthly'], ['28', 'Every 28 days']] }, { f: 'day', l: 'Day of month', type: 'number' }, { f: 'anchor', l: 'Known date (28-day)', type: 'date' }, { f: 'end', l: 'Ends', type: 'date' }, { f: 'active', l: 'Active', type: 'check' }], 'Add direct debit')}
    <p class="muted small">Weekend or bank holiday dates move to the next working day.</p></details>
  <details class="card sec"><summary>Joint costs <span class="muted">${gbp(r.J)} a month</span></summary>
    ${listEditor('joint', [{ f: 'name', l: 'Item', cls: 'wide' }, { f: 'amt', l: 'Your share', type: 'number' }, { f: 'freq', l: 'How often', type: 'select', opts: [['monthly', 'Monthly'], ['weekly', 'Weekly'], ['annual', 'Yearly']] }, { f: 'active', l: 'Active', type: 'check' }], 'Add joint cost')}</details>
  <details class="card sec"><summary>Sinking funds <span class="muted">${gbp(r.O)} a month</span></summary>
    ${listEditor('sinking', [{ f: 'name', l: 'Cost', cls: 'wide' }, { f: 'annual', l: 'Per year', type: 'number' }, { f: 'active', l: 'Active', type: 'check' }], 'Add cost')}</details>
  <details class="card sec"><summary>Your data</summary>
    <p class="muted small">${storageMode === 'device' ? `Saved on this device. Download a backup now and then, and keep it somewhere safe (Google Drive, email to yourself).${S.lastBackup ? ' Last backup: ' + fDate(S.lastBackup, { day: 'numeric', month: 'short', year: 'numeric' }) + '.' : ''}` : storageMode === 'cloud' ? 'Saved to your private space: it follows you to any device where you open this page signed in.' : storageMode === 'loading' ? 'Connecting…' : 'Saving on this device only. Open the page signed in to Claude to keep it everywhere.'}</p>
    <div class="actions left"><button class="btn" data-act="export">Export to Excel</button><button class="btn ghost" data-act="backup">Download backup</button>
    <label class="btn ghost file">Restore backup<input type="file" accept=".json,application/json" id="restore"></label></div></details>`;
}

// ----- chart -----
function areaChart(box, layers, nowIdx, labels) {
  if (!box) return;
  const W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
  const pad = { l: 8, r: 8, t: 20, b: 26 };
  const n = rows.length, tops = rows.map((_, i) => layers.reduce((a, L) => a + L.f(i), 0)), max = Math.max(1, ...tops);
  const X = i => pad.l + (W - pad.l - pad.r) * i / (n - 1), Y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const cum = (i, k) => layers.slice(0, k).reduce((a, L) => a + L.f(i), 0);
  const paths = layers.map((L, k) => `<path class="${L.cls}" d="M${rows.map((_, i) => `${X(i)},${Y(cum(i, k + 1))}`).join('L')}L${rows.map((_, j) => { const i = n - 1 - j; return `${X(i)},${Y(cum(i, k))}`; }).join('L')}Z"/>`).join('');
  const step = W < 520 ? 12 : 6;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths}
    <line x1="${X(nowIdx)}" x2="${X(nowIdx)}" y1="${pad.t - 6}" y2="${H - pad.b}" class="now"/>
    <text x="${Math.min(X(nowIdx) + 6, W - 40)}" y="${pad.t - 6}" class="t-now">Now</text>
    ${rows.map((r, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - 8}" class="t-ax" text-anchor="${i === 0 ? 'start' : 'middle'}">${fMonth(r.A).replace(' 20', " '")}</text>` : '').join('')}
  </svg><div class="legend">${labels.map(([c, t]) => `<span class="k ${c}"></span>${t}`).join(' ')}</div>`;
}
function drawChart() {
  areaChart($('#debtChart'), [{ cls: 'a-card', f: i => rows[i].T }, { cls: 'a-jess', f: i => rows[i].U }], cur, [['k-card', 'Credit card'], ['k-jess', 'Jess']]);
  // savings growth: today's balances, then what the plan adds each pay period
  const proj = { sav: [], inv: [] };
  rows.forEach((r, i) => {
    proj.sav[i] = i <= cur ? B.savings : proj.sav[i - 1] + Math.max(0, rows[i - 1].S);
    proj.inv[i] = i <= cur ? B.invValue : proj.inv[i - 1] + rows[i - 1].INV;
  });
  const efAt = i => i <= cur ? B.ef : Math.max(B.ef, rows[i].V + (B.ef - rows[cur].V));
  areaChart($('#growChart'), [{ cls: 'a-ef', f: efAt }, { cls: 'a-sav', f: i => proj.sav[i] }, { cls: 'a-inv', f: i => proj.inv[i] }], cur, [['k-ef', 'Emergency fund'], ['k-sav', 'Savings'], ['k-inv', 'Investments']]);
}
const chartRO = new ResizeObserver(() => drawChart());

// ----- export -----
function exportSheets() {
  const h = a => a.map(v => ({ v, t: 'h' }));
  const g = v => ({ v: Math.round(v * 100) / 100, t: 'gbp' });
  const G = goalsNow();
  const r = rows[cur];
  const sheets = [];
  sheets.push({ name: 'Summary', widths: [40, 16, 4, 28, 16], rows: [[{ v: 'This pay period', t: 'title' }], [`${fDate(r.D)} → ${fDate(r.E)} (${r.days} days)`], [],
    h(['On payday', 'Amount']), ['Salary lands in Santander', g(r.H)], ['Leave in Santander for direct debits', g(r.I)], ['Pay the credit card from Santander', g(r.K)], ['Move the rest to Starling', g(r.toStarling)],
    ['  → Joint account', g(r.J)], ['  → Jess', g(r.L)], ['  → Emergency fund pot', g(r.M)], ['  → Goals pots', g(r.N)], ['  → Sinking funds pot', g(r.O)], ['  → Savings pot', g(r.S)], ['  → Investments', g(r.INV)], ['Left to spend', g(r.Q + r.R)], [],
    h(['Where you stand', 'Balance']), ['Credit card', g(B.card)], ['Owed to Jess', g(B.jess)], ['Emergency fund', g(B.ef)], ['Savings', g(B.savings)], ['Sinking funds', g(B.sinking)], ['Investments', g(B.invValue)], ['Undecided', g(B.undecided)], ['Goals', g(G.reduce((a, x) => a + x.saved, 0))]] });
  sheets.push({ name: 'Monthly Plan', widths: [11, 12, 12, 8, 10, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14], rows: [
    h(['Month', 'Payday', 'Next payday', 'Days', 'Status', 'Take-home', 'DDs due', 'Joint account', 'Credit card', 'Jess', 'Emergency fund', 'Goals', 'Sinking funds', 'Leftover pot', 'Spending budget', 'Extra to spending', 'Savings', 'Investments', 'Card balance', 'Owed to Jess', 'Emergency fund balance', 'Weekly allowance']),
    ...rows.map(x => [{ v: x.A, t: 'month' }, { v: x.D, t: 'date' }, { v: x.E, t: 'date' }, x.days, x.status, g(x.H), g(x.I), g(x.J), g(x.K), g(x.L), g(x.M), g(x.N), g(x.O), g(x.P), g(x.Q), g(x.R), g(x.S), g(x.INV), g(x.T), g(x.U), g(x.V), g(x.weekly)])] });
  sheets.push({ name: 'Direct Debits', widths: [24, 12, 14, 12, 14, 12, 8], rows: [h(['Payee', 'Amount', 'How often', 'Day', 'Known date', 'Ends', 'Active']), ...S.dds.map(d => [d.name, g(+d.amt), d.freq === '28' ? 'Every 28 days' : 'Monthly', d.day || '', d.anchor ? { v: d.anchor, t: 'date' } : '', d.end ? { v: d.end, t: 'date' } : '', d.active ? 'Yes' : 'No'])] });
  sheets.push({ name: 'Joint Costs', widths: [24, 12, 12, 16, 8], rows: [h(['Item', 'Your share', 'How often', 'Monthly', 'Active']), ...S.joint.map(j => [j.name, g(+j.amt), j.freq, g(jointMonthly(j)), j.active ? 'Yes' : 'No'])] });
  sheets.push({ name: 'Sinking Funds', widths: [24, 12, 14, 8], rows: [h(['Cost', 'Per year', 'Per month', 'Active']), ...S.sinking.map(s => [s.name, g(+s.annual), g(s.annual / 12), s.active ? 'Yes' : 'No'])] });
  const logRows = kind => S.logs.filter(l => l.kind === kind).sort((a, b) => a.date < b.date ? -1 : 1).map(l => [{ v: l.date, t: 'date' }, l.dir === 'out' ? '' : g(+l.amt), l.dir === 'out' ? g(+l.amt) : '', l.note || '']);
  sheets.push({ name: 'Credit Card', widths: [34, 16, 14, 30], rows: [h(['Summary', 'Value']), ['Balance at start', g(S.card.balance)], ['Balance now', g(B.card)], ['0% ends', { v: S.card.promoEnd, t: 'date' }], ['Payment this period', g(r.K)], [], h(['Date', 'Paid', 'Refund', 'Note']), ...logRows('card')] });
  sheets.push({ name: 'Jess Repayment', widths: [34, 16, 14, 30], rows: [h(['Summary', 'Value']), ['Amount owed at start', g(S.jess.owed)], ['Still owed', g(B.jess)], ['Payment this period', g(r.L)], [], h(['Date', 'Paid', 'Returned', 'Note']), ...logRows('jess')] });
  const pots = [['Emergency Fund', 'ef'], ['Savings', 'savings'], ['Sinking Funds', 'sinking'], ['Undecided', 'undecided']];
  sheets.push({ name: 'Savings', widths: [18, 12, 12, 12, 30], rows: [h(['Pot', 'Opening', 'Current', 'Target']), ...pots.map(([n, k]) => [n, g(S.pots[k].opening), g(B[k]), k === 'ef' ? g(S.efTarget) : k === 'savings' && S.pots.savings.target ? g(S.pots.savings.target) : '']), [],
    h(['Date', 'Pot', 'Paid in', 'Withdrawn', 'Note']), ...S.logs.filter(l => pots.some(p => p[1] === l.kind)).sort((a, b) => a.date < b.date ? -1 : 1).map(l => [{ v: l.date, t: 'date' }, pots.find(p => p[1] === l.kind)[0], l.dir === 'out' ? '' : g(+l.amt), l.dir === 'out' ? g(+l.amt) : '', l.note || ''])] });
  sheets.push({ name: 'Goals', widths: [6, 22, 12, 12, 12, 10, 16], rows: [h(['Icon', 'Goal', 'Target', 'By', 'Saved', '%', 'This period']), ...G.map(x => [x.icon || '', x.name, g(+x.target), x.by && x.by !== '0000-00-00' ? { v: x.by, t: 'month' } : '', g(x.saved), { v: x.target ? x.saved / x.target : 0, t: 'pct' }, g(x.need)]), [],
    h(['Date', 'Goal', 'Paid in', 'Withdrawn', 'Note']), ...S.logs.filter(l => l.kind === 'goal').sort((a, b) => a.date < b.date ? -1 : 1).map(l => [{ v: l.date, t: 'date' }, kindLabel(l), l.dir === 'out' ? '' : g(+l.amt), l.dir === 'out' ? g(+l.amt) : '', l.note || ''])] });
  sheets.push({ name: 'Investments', widths: [30, 14, 14, 30], rows: [h(['Summary', 'Value']), ['Current value', g(B.invValue)], ['Paid in (net)', g(B.invPaid)], ['Growth', g(B.invGrowth)], [], h(['Date', 'Paid in', 'Withdrawn', 'Note']), ...logRows('invest'), [], h(['Date', 'Value']), ...S.investValues.sort((a, b) => a.date < b.date ? -1 : 1).map(v => [{ v: v.date, t: 'date' }, g(v.value)])] });
  sheets.push({ name: 'Settings', widths: [34, 16], rows: [h(['Take-home from', 'Amount']), ...S.salary.map(s => [{ v: s.from, t: 'month' }, g(+s.amt)]), [], h(['Spending budget from', 'Amount']), ...S.budget.map(s => [{ v: s.from, t: 'month' }, g(+s.amt)]), [],
    h(['Setting', 'Value']), ['Emergency fund target', g(S.efTarget)], ['Emergency fund each month', g(S.efMonthly)], ['Spare money goes to', S.spareTo], ['Santander buffer', g(S.buffer)], ['Card payment while Jess is repaid', g(+S.card.whileJess || 0)], ['Jess: repay over (months)', S.jess.months]] });
  return sheets;
}

// ----- render & routing -----
const ROUTES = { home: viewHome, payday: viewPayday, log: viewLog, goals: viewGoals, manage: viewManage };
const route = () => (location.hash || '#home').slice(1) in ROUTES ? (location.hash || '#home').slice(1) : 'home';
function render() {
  document.documentElement.dataset.theme = resolvedTheme();
  const rt = route();
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === rt));
  const r = rows[cur];
  $('#status').textContent = storageMode === 'local' ? 'Saving on this device only' : '';
  $('#nextPay').textContent = r ? `Payday ${fDate(todayIso() < r.D ? r.D : r.E, { day: 'numeric', month: 'short' })}` : '';
  const y = scrollY;
  $('#main').innerHTML = ROUTES[rt]();
  scrollTo(0, rt === lastRoute ? y : 0); lastRoute = rt;
  chartRO.disconnect(); ['#debtChart', '#growChart'].forEach(id => { const b = $(id); if (b) chartRO.observe(b); });
}
let lastRoute = null;
const commit = (msg, undoState) => { if (S.blank) delete S.blank; recalc(); const m = milestones(false); save(); render(); if (m) toast(m + (msg ? ' · ' + msg : ''), undoState, 5000); else if (msg) toast(msg, undoState); };

// ----- events -----
function setPath(path, val) { const ks = path.split('.'); let o = S; ks.slice(0, -1).forEach(k => o = o[k]); o[ks.at(-1)] = val; }
const num = v => v === '' || v == null ? null : Number(v);
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.bind) { delete S.blank; setPath(t.dataset.bind, t.type === 'number' ? num(t.value) : t.value); return commit(); }
  if (t.dataset.list) { const it = S[t.dataset.list][+t.dataset.i]; it[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? num(t.value) : t.value; return commit(); }
  if (t.dataset.check) { const [k, s] = t.dataset.check.split(':'); S.checks[k] = S.checks[k] || {}; S.checks[k][s] = t.checked; save(); return render(); }
  if (t.dataset.pay) { if (t.value === '') delete S.actualPay[t.dataset.pay]; else S.actualPay[t.dataset.pay] = +t.value; return commit(); }
  if (t.dataset.ovd) { S.paydayOverrides[t.dataset.ovd] = t.value; return commit(); }
  if (t.dataset.ovm) { const d = S.paydayOverrides[t.dataset.ovm]; delete S.paydayOverrides[t.dataset.ovm]; if (t.value) S.paydayOverrides[t.value] = d || t.value + '-28'; return commit(); }
  if (t.id === 'restore' && t.files[0]) {
    t.files[0].text().then(txt => { const o = JSON.parse(txt); if (!o || typeof o !== 'object' || !Array.isArray(o.logs)) throw 0; const prev = clone(S); delete o.blank; const keepTheme = S.theme; applyLoaded(o); S.theme = keepTheme; delete S.blank; commit('Backup restored', prev); })
      .catch(() => toast('That file isn’t a backup from this app.'));
  }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-act]'); if (!t) return;
  const d = t.dataset;
  if (d.act === 'theme') { S.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; save(); return render(); }
  if (d.act === 'undo') { const u = $('#toast')._undo; if (u) { S = u; $('#toast').classList.remove('on'); commit(); } return; }
  if (d.act === 'prev') { viewIdx = Math.max(0, viewIdx - 1); return render(); }
  if (d.act === 'next') { viewIdx = Math.min(rows.length - 1, viewIdx + 1); return render(); }
  if (d.kind) { logKind = d.kind; if (logKind === 'card' || logKind === 'jess') logDir = 'in'; else if (logDir === 'value' && logKind !== 'invest') logDir = 'in'; return render(); }
  if (d.dir) { logDir = d.dir; return render(); }
  if (d.act === 'cancelEdit') { logEdit = null; return render(); }
  if (d.act === 'saveLog') {
    const amt = +$('#fAmt').value, date = $('#fDate').value;
    if (!(amt > 0) || !date) { toast('Enter an amount and a date.'); return $('#fAmt').focus(); }
    const prev = clone(S);
    if (logDir === 'value') {
      if (logEdit && logEdit.type === 'value') Object.assign(S.investValues.find(v => v.id === logEdit.id), { value: amt, date });
      else S.investValues.push({ id: uid('v'), date, value: amt });
    } else {
      const [kind, goal] = logKind.startsWith('goal:') ? ['goal', logKind.slice(5)] : [logKind, null];
      const entry = { kind, goal, dir: logDir === 'out' ? 'out' : 'in', amt, date, note: ($('#fNote')?.value || '').trim() };
      if (logEdit && logEdit.type === 'log') Object.assign(S.logs.find(l => l.id === logEdit.id), entry);
      else S.logs.push({ id: uid('l'), ...entry });
    }
    const was = logEdit; logEdit = null;
    return commit(was ? 'Entry updated' : `Logged ${gbp(amt)}`, prev);
  }
  if (d.edit) { const l = S.logs.find(x => x.id === d.edit); logEdit = { ...l, type: 'log' }; logKind = l.kind === 'goal' ? 'goal:' + l.goal : l.kind; logDir = l.dir; render(); return scrollTo(0, 0); }
  if (d.editValue) { const v = S.investValues.find(x => x.id === d.editValue); logEdit = { ...v, type: 'value' }; logKind = 'invest'; logDir = 'value'; render(); return scrollTo(0, 0); }
  if (d.del) { const prev = clone(S); S.logs = S.logs.filter(l => l.id !== d.del); return commit('Entry deleted', prev); }
  if (d.delValue) { const prev = clone(S); S.investValues = S.investValues.filter(v => v.id !== d.delValue); return commit('Value deleted', prev); }
  if (d.act === 'newGoal') { $('#goalSheet').innerHTML = goalForm(); return $('#gName').focus(); }
  if (d.editgoal) { $('#goalSheet').innerHTML = goalForm(goalsNow().find(g => g.id === d.editgoal)); return $('#goalSheet').scrollIntoView({ behavior: 'smooth' }); }
  if (d.act === 'closeGoal') { $('#goalSheet').innerHTML = ''; return; }
  if (d.savegoal !== undefined) {
    const name = $('#gName').value.trim(); if (!name) { toast('Give the goal a name.'); return $('#gName').focus(); }
    const g = { icon: $('#gIcon').value.trim(), name, target: +$('#gTarget').value || 0, by: $('#gBy').value, active: $('#gActive').checked };
    const prev = clone(S);
    if (d.savegoal) Object.assign(S.goals.find(x => x.id === d.savegoal), g); else S.goals.push({ id: uid('g'), ...g });
    return commit('Goal saved', prev);
  }
  if (d.delgoal) { const prev = clone(S); S.goals = S.goals.filter(g => g.id !== d.delgoal); S.logs = S.logs.filter(l => l.goal !== d.delgoal); return commit('Goal and its payments deleted', prev); }
  if (d.loggoal) { logKind = 'goal:' + d.loggoal; logDir = 'in'; logEdit = null; location.hash = '#log'; return; }
  if (d.addrow) {
    const n = d.addrow, blank = { dds: { name: '', amt: null, freq: 'm', day: null, anchor: '', end: '', active: true }, joint: { name: '', amt: null, freq: 'monthly', active: true }, sinking: { name: '', annual: null, active: true }, salary: { from: '', amt: null }, budget: { from: '', amt: null }, investPlan: { from: '', amt: null } }[n];
    S[n].push({ id: uid(n[0]), ...blank }); save(); return render();
  }
  if (d.delrow) { const [n, i] = d.delrow.split(':'); const prev = clone(S); S[n].splice(+i, 1); return commit('Removed', prev); }
  if (d.act === 'addOv') { const m = rows[Math.min(rows.length - 1, cur + 1)].A.slice(0, 7); if (!S.paydayOverrides[m]) S.paydayOverrides[m] = rows[Math.min(rows.length - 1, cur + 1)].def; return commit(); }
  if (d.delov) { const prev = clone(S); delete S.paydayOverrides[d.delov]; return commit('Payday reset', prev); }
  if (d.act === 'export' || d.act === 'backup') {
    const stamp = todayIso();
    const file = d.act === 'export' ? { filename: `Stratrix_${stamp}.xlsx`, data: XL.build(exportSheets()), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } : { filename: `Stratrix_backup_${stamp}.json`, data: JSON.stringify(S, null, 1), type: 'application/json' };
    const done = () => { if (d.act === 'backup') { S.lastBackup = todayIso(); save(); render(); } toast('File ready'); };
    if (IS_PWA) {
      const url = URL.createObjectURL(new Blob([file.data], { type: file.type }));
      const a = document.createElement('a'); a.href = url; a.download = file.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000); return done();
    }
    const dl = await window.claude.use('downloads');
    if (!dl) return toast('Downloads aren’t available in this view.');
    try { await dl.save({ filename: file.filename, data: file.data }); done(); } catch (err) { if (err && err.code !== 'declined') toast('Couldn’t create the file here.'); }
  }
});
addEventListener('hashchange', () => { if (route() !== 'log') logEdit = null; viewIdx = route() === 'payday' ? viewIdx : cur; render(); });
try { const th = localStorage.getItem(THEME_KEY); if (th) S.theme = th; } catch (e) { }
document.documentElement.dataset.theme = resolvedTheme();
window.paydayExportBytes = () => Array.from(XL.build(exportSheets()));
connect();
}
