// ---------- App ----------
{
// Stratrix keeps its own storage keys: it shares a web address (origin) with Payday HQ, so it must never read or overwrite that app's data.
const STORE_KEY = 'stratrix-state', THEME_KEY = 'stratrix-theme';
// Saved data carries a version number. Each step below upgrades data from one version to the next, so updates never break old data or backups.
const DATA_VERSION = 3;
const MIGRATIONS = {
  // 1 -> 2: Payday HQ data (version 1) brought into Stratrix. Nothing to reshape.
  1: o => o,
  // 2 -> 3: fixed items become lists. Credit card and Jess -> debts; the four pots -> pots list; the three accounts -> accounts list.
  2: o => {
    const today = new Date().toISOString().slice(0, 10), ps = o.planStart || today.slice(0, 7) + '-01';
    const monthAdd = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
    const hasLogs = k => (o.logs || []).some(l => l.kind === k);
    const debts = [], pots = [];
    const c = o.card || {}, j = o.jess || {}, P = o.pots || {};
    if (c.balance > 0 || hasLogs('card')) debts.push({ id: 'card', name: 'Credit card', type: 'card', balance: c.balance || 0, asAt: c.asAt || today, rate: 0, promoEnd: c.promoEnd || '', min: c.min || 0,
      clearBy: c.clearMonths ? monthAdd(ps.slice(0, 7), c.clearMonths - 1) : null, start: null, setAmt: c.whileJess || null, account: 'TSC' });
    if (j.owed > 0 || hasLogs('jess')) debts.push({ id: 'jess', name: 'Jess', type: 'person', balance: j.owed || 0, asAt: j.asAt || today, rate: 0, promoEnd: '', min: 0,
      clearBy: j.start && j.months ? monthAdd(j.start, j.months - 1) : null, start: j.start || null, setAmt: null, account: 'STG' });
    const pot = (id, name, kind, src, extra) => ({ id, name, kind, target: null, each: 0, opening: (src || {}).opening || 0, asAt: (src || {}).asAt || today, ...extra });
    pots.push(pot('ef', 'Emergency fund', 'ef', P.ef, { target: o.efTarget ?? 1000, each: o.efMonthly || 0 }));
    pots.push(pot('savings', 'Savings', 'savings', P.savings, { target: (P.savings || {}).target || null }));
    pots.push(pot('yearly', 'Yearly costs', 'yearly', P.sinking));
    if ((P.undecided || {}).opening || hasLogs('undecided')) pots.push(pot('undecided', 'Undecided', 'other', P.undecided));
    const ref = { card: ['debt', 'card'], jess: ['debt', 'jess'], ef: ['pot', 'ef'], savings: ['pot', 'savings'], sinking: ['pot', 'yearly'], undecided: ['pot', 'undecided'] };
    const logs = (o.logs || []).map(l => ref[l.kind] ? { ...l, kind: ref[l.kind][0], ref: ref[l.kind][1] } : l);
    const stepIds = { card: 'debt:card', jess: 'debt:jess', ef: 'pot:ef', sink: 'pot:yearly', save: 'pot:savings' };
    const checks = {};
    for (const [k, v] of Object.entries(o.checks || {})) { checks[k] = {}; for (const [s, on] of Object.entries(v || {})) checks[k][stepIds[s] || s] = on; }
    const split = debts.length > 0;   // Payday HQ users split money across Santander, Starling and Tesco Bank
    const out = { ...o, region: 'ew', pay: { freq: 'last', day: 28, anchor: today }, simple: !split,
      accounts: split ? [{ id: 'a1', bank: 'Santander', code: 'SDR', roles: ['salary', 'bills'] }, { id: 'a2', bank: 'Starling', code: 'STG', roles: ['spending', 'savings', 'shared'] }, { id: 'a3', bank: 'Tesco Bank', code: 'TSC', roles: ['card'] }] : [],
      debts, pots, logs, checks, spareTo: o.spareTo === 'Spending' ? 'spending' : 'savings', spend: [], leftover: {} };
    for (const k of ['card', 'jess', 'efTarget', 'efMonthly']) delete out[k];
    return out;
  },
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
const addD = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

let S = clone(DEFAULT_STATE), rows = [], B = {}, cur = 0, viewIdx = null, logEdit = null, logKind = '', logDir = 'in', logMode = 'pay', spendType = 'everyday';
let storageMode = 'loading', armed = false;

// ----- lists the set-up screens choose from -----
const DEBT_TYPES = { card: 'Credit card', loan: 'Loan', person: 'Money owed to a person', overdraft: 'Overdraft', other: 'Other' };
const POT_KINDS = { ef: 'Emergency fund', savings: 'Savings', yearly: 'Yearly costs', other: 'Other pot' };
const ROLES = { salary: 'Pay lands here', bills: 'Bills', spending: 'Spending', savings: 'Savings pots', shared: 'Shared costs', card: 'Credit card', invest: 'Investments' };
// Banks as people see them on cards and in apps, grouped for the dropdown
const BANKS = {
  'High street': ['Barclays', 'Halifax', 'HSBC', 'Lloyds', 'NatWest', 'Santander', 'TSB', 'Royal Bank of Scotland', 'Bank of Scotland', 'Ulster Bank', 'Danske Bank', 'Virgin Money', 'The Co-operative Bank', 'Metro Bank'],
  'Building societies': ['Nationwide', 'Yorkshire Building Society', 'Coventry Building Society', 'Skipton Building Society', 'Leeds Building Society'],
  'App banks': ['Monzo', 'Starling', 'Chase', 'Revolut', 'first direct', 'Kroo', 'Zopa'],
  'Cards and savings': ['American Express', 'Barclaycard', 'Capital One', 'MBNA', 'Tesco Bank', "Sainsbury's Bank", 'Marcus', 'Chip', 'Plum', 'Moneybox', 'Trading 212', 'Vanguard', 'NS&I'],
};
const KNOWN_CODES = { Santander: 'SDR', Starling: 'STG', 'Tesco Bank': 'TSC', Monzo: 'MZO', Barclays: 'BAR', Barclaycard: 'BCD', Nationwide: 'NWD', NatWest: 'NWT', Lloyds: 'LLY', Halifax: 'HFX', HSBC: 'HSB', 'American Express': 'AMX', 'first direct': 'FDR', Chase: 'CHS', Revolut: 'REV' };
const codeFor = bank => KNOWN_CODES[bank] || (bank || 'ACC').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

const debtName = id => (S.debts.find(d => d.id === id) || {}).name || 'Deleted debt';
const potName = id => (S.pots.find(p => p.id === id) || {}).name || 'Deleted pot';
const kindLabel = l => l.kind === 'goal' ? (S.goals.find(g => g.id === (l.goal || l.ref))?.name || 'Goal') : l.kind === 'debt' ? debtName(l.ref) : l.kind === 'pot' ? potName(l.ref) : 'Investments';
const spareName = () => S.spareTo === 'spending' ? 'Spending' : potName(S.spareTo);

// ----- accounts: only used when the person splits money across accounts -----
const accts = () => S.simple ? [] : S.accounts;
const acctFor = role => accts().find(a => (a.roles || []).includes(role));
const acctByCode = code => accts().find(a => a.code === code);
const chip = a => a ? `<span class="acct a${accts().indexOf(a) % 4}">${esc(a.code)}</span>` : '';

// ----- persistence: saved on this device -----
function applyLoaded(o) {
  // saved data is only 'blank' if it says so: the default's blank flag must not leak into real data
  const base = clone(DEFAULT_STATE); delete base.blank;
  S = migrate(Object.assign(base, { v: 1 }, o || {}));
  for (const k of ['logs', 'investValues', 'goals', 'dds', 'joint', 'sinking', 'salary', 'budget', 'investPlan', 'debts', 'pots', 'accounts', 'spend']) if (!Array.isArray(S[k])) S[k] = [];
  for (const k of ['checks', 'celebrated', 'actualPay', 'paydayOverrides', 'leftover', 'pay', 'investments']) if (!S[k] || typeof S[k] !== 'object') S[k] = {};
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); if (S.theme) localStorage.setItem(THEME_KEY, S.theme); } catch (e) { toast('Couldn’t save on this device. Download a backup.'); } }
function connect() {
  try { const local = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (local) applyLoaded(local); } catch (e) { }
  storageMode = 'device';
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
  recalc(); milestones(true); render();
}

// ----- calculations -----
function recalc() {
  rows = plan(S, todayIso());
  B = balances(S);
  cur = currentIndex(rows, todayIso());
  if (viewIdx == null || viewIdx >= rows.length) viewIdx = cur;
}
const goalsNow = () => goalNeeds(S, rows, cur);
const clearRow = get => {     // the pay period where a balance reaches zero in the plan
  if (get(rows[0]) <= 0.005) return 'done';
  const n = rows.findIndex(r => get(r) <= 0.005);
  return n < 0 ? null : rows[n - 1];
};
const debtStart = d => Number(d.balance || 0);
const potsShown = () => S.pots.filter(p => p.kind !== 'yearly' || S.sinking.length || B.pot[p.id]);

// ----- milestones and confetti -----
function milestoneItems() {
  const items = [];
  for (const d of S.debts) if (debtStart(d)) items.push({ key: d.id, label: d.name, p: 1 - B.debt[d.id] / debtStart(d), verb: d.type === 'person' ? 'repaid' : 'destroyed' });
  for (const p of S.pots) if (p.target) items.push({ key: p.id, label: p.name, p: B.pot[p.id] / p.target, verb: 'saved' });
  if (S.investments.target) items.push({ key: 'invest', label: 'Investments', p: B.invValue / S.investments.target, verb: 'of target' });
  for (const g of goalsNow()) if (g.target > 0) items.push({ key: 'goal-' + g.id, label: g.name, p: g.saved / g.target, verb: 'saved' });
  const total = S.debts.reduce((a, d) => a + debtStart(d), 0), left = S.debts.reduce((a, d) => a + B.debt[d.id], 0);
  if (S.debts.length > 1 && total) items.push({ key: 'debt', label: 'All debt', p: 1 - left / total, verb: 'destroyed' });
  return items;
}
function milestones(silent) {
  const hits = [];
  for (const it of milestoneItems()) for (const t of [25, 50, 75, 100]) {
    const k = it.key + '-' + t;
    if (it.p * 100 >= t - 0.001 && !S.celebrated[k]) { S.celebrated[k] = true; hits.push({ ...it, t }); }
  }
  if (hits.length) save();
  if (hits.length && !silent) {
    const top = hits.sort((a, b) => b.t - a.t)[0];
    confetti(top.t === 100);
    return top.t === 100 ? `${top.label}: ${top.verb === 'destroyed' ? 'destroyed' : top.verb === 'repaid' ? 'fully repaid' : 'target reached'}!` : `${top.label}: ${top.t}% ${top.verb}!`;
  }
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
const meter = (p, cls = '', mark) => `<div class="meter ${cls}"><i style="width:${pct(p)}"></i>${mark != null ? `<b class="pace" style="left:${pct(mark)}" title="Where you'd expect to be today"></b>` : ''}</div>`;
const badges = p => `<div class="badges">${[25, 50, 75, 100].map(t => `<span class="${p * 100 >= t - 0.001 ? 'on' : ''}">${t === 100 ? 'Done' : t + '%'}</span>`).join('')}</div>`;
const budgetOf = r => r.Q + r.R;
// spending this pay period, with the pace marker: how far through the period today is
function spendBlock(r, full) {
  const sp = spentIn(S, r.D, r.E), budget = budgetOf(r);
  const elapsed = r.status === 'Current' ? Math.min(1, Math.max(0, (daysTo(r.D) * -1) / r.days)) : r.status === 'Closed' ? 1 : 0;
  const left = budget - sp.total, ahead = sp.total - budget * elapsed;
  const msg = !sp.n ? 'Nothing checked in yet this pay period.' : left < 0 ? `Over budget by ${gbp(-left)}.` :
    r.status !== 'Current' ? `${gbp(left)} left unspent.` : ahead > 1 ? `${gbp(ahead)} ahead of pace. ${gbp(left)} left.` : `On pace. ${gbp(left)} left.`;
  const list = full ? (S.spend || []).filter(s => s.date >= r.D && s.date < r.E).sort((a, b) => a.date < b.date ? 1 : -1) : [];
  return `<p class="label">Spent this period</p>
    <p class="num ${left < 0 ? 'neg' : ''}">${gbp(sp.total)} <span class="muted small">of ${gbp(budget)}</span></p>
    ${budget > 0 ? meter(sp.total / budget, left < 0 ? 'over' : '', r.status === 'Current' ? elapsed : null) : ''}
    <p class="muted small">${msg}${sp.oneoff ? ` ${gbp(sp.oneoff)} of that was one-offs.` : ''}${sp.fromPots ? ` ${gbp(sp.fromPots)} more was paid from pots.` : ''}</p>
    ${list.length ? `<ul class="mini">${list.map(s => `<li><span>${fDate(s.date)} · ${s.type === 'oneoff' ? esc(s.reason || 'One-off') : 'Everyday'}${s.pot ? ' · from ' + esc(potName(s.pot)) : ''}</span><span>${gbp(s.amt)}</span></li>`).join('')}</ul>` : ''}`;
}
// weekly check-in: due when a week has passed since the last spending entry (or since payday)
function checkinDue() {
  const r = rows[cur]; if (S.blank || r.status !== 'Current' || !(budgetOf(r) > 0)) return null;
  const last = (S.spend || []).map(s => s.date).filter(d => d <= todayIso()).sort().pop();
  const since = last && last >= r.D ? last : r.D;
  return daysTo(since) <= -7 ? since : null;
}
// end of a pay period with money left: offer to move it to a pot or goal
function leftoverDue() {
  const p = rows[cur - 1]; if (!p || p.status !== 'Closed' || S.leftover[p.key]) return null;
  const sp = spentIn(S, p.D, p.E), left = Math.round((budgetOf(p) - sp.total) * 100) / 100;
  return sp.n && left >= 1 ? { r: p, left } : null;
}

// ----- views -----
function viewHome() {
  const debts = S.debts, total = debts.reduce((a, d) => a + debtStart(d), 0), left = debts.reduce((a, d) => a + B.debt[d.id], 0), paid = total - left, p = total ? paid / total : 0;
  const free = clearRow(r => r.T);
  const r = rows[cur], np = todayIso() < r.D ? r.D : r.E;
  const short = rows.slice(cur).filter(x => x.S < -0.005).length;
  const G = goalsNow(), lo = leftoverDue(), ci = checkinDue();
  const pots = potsShown().filter(pt => pt.kind !== 'yearly' && pt.kind !== 'other').map(pt => ({ t: pt.name, v: B.pot[pt.id], target: pt.target, plan: rows[cur].pot[pt.id].plan, note: 'No target set' }));
  if (B.invPaid || B.invValue || S.investPlan.length) pots.push({ t: 'Investments', v: B.invValue, target: S.investments.target, plan: r.INV, note: 'No target set', extra: `${B.invGrowth >= 0 ? '+' : '−'}${gbp(Math.abs(B.invGrowth))} growth` });
  const saved = pots.reduce((a, x) => a + x.v, 0), planned = pots.reduce((a, x) => a + x.plan, 0);
  const targetTotal = pots.length && pots.every(x => x.target) ? pots.reduce((a, x) => a + x.target, 0) : 0;
  const tiles = [
    ...debts.map(d => { const cm = clearRow(x => x.debt[d.id].bal), st = debtStart(d); return { t: d.name + (d.account ? ' · ' + d.account : ''), v: B.debt[d.id], debt: 1,
      sub: st ? `${pct(1 - B.debt[d.id] / st)} ${d.type === 'person' ? 'repaid' : 'destroyed'} of ${gbp(st, 0)}` : 'No balance set', p: st ? 1 - B.debt[d.id] / st : null,
      foot: cm === 'done' ? 'Cleared' : cm ? 'Clear by ' + fMonth(cm.D) : debtTarget(d) ? 'Not cleared within plan' : 'Paying the minimum: add a clear-by month' }; }),
    ...potsShown().filter(pt => pt.kind === 'yearly' || pt.kind === 'other').map(pt => ({ t: pt.name, v: B.pot[pt.id], p: pt.target ? B.pot[pt.id] / pt.target : null,
      sub: pt.kind === 'yearly' ? `${gbp(r.O)} set aside each payday` : pt.target ? `${pct(B.pot[pt.id] / pt.target)} of ${gbp(pt.target, 0)}` : 'Waiting for a job',
      foot: pt.kind === 'yearly' ? (S.sinking.filter(s => s.active !== false && s.annual > 0).map(s => s.name).join(', ') || 'No yearly costs added') : 'Move it with a log entry' })),
  ];
  const needBackup = !S.blank && !S.sample && S.logs.length && (!S.lastBackup || daysTo(S.lastBackup) < -30);
  return `
  ${S.blank ? `<section class="card welcome"><h1>Welcome to Stratrix</h1><p class="muted">Your payday plan, debt countdown and savings tracker. Everything stays on this phone: nothing is sent anywhere and there’s no sign-up.</p>
    <div class="actions left"><button class="btn" data-act="setup">Set up in 2 minutes</button><button class="btn ghost" data-act="sample">Try with sample data</button><label class="btn ghost file">Restore a backup<input type="file" accept=".json,application/json" id="restore"></label></div>
    <p class="muted small">Stratrix helps you plan and track. It isn’t financial advice.</p></section>` : ''}
  ${S.blank ? '' : `  ${S.sample ? `<div class="note checkin"><span>You’re looking at sample data for a made-up person.</span><button class="btn" data-act="clearSample">Clear it and set up</button></div>` : ''}
  ${nextSteps()}
  ${needBackup ? `<div class="note">It’s been a while since your last backup. <button class="linkish" data-act="backup">Download one now</button></div>` : ''}
  ${lo ? `<section class="card prompt"><p class="label">Pay period ended ${fDate(lo.r.E)}</p><h2>You had ${gbp(lo.left)} left over</h2><p class="muted small">Move it somewhere now so it doesn’t disappear into this period’s spending.</p>
    <div class="chips">${S.pots.filter(pt => pt.kind !== 'yearly').map(pt => `<button class="chip" data-leftover="pot:${pt.id}">${esc(pt.name)}</button>`).join('')}${G.filter(g => g.active !== false && g.saved < g.target).map(g => `<button class="chip" data-leftover="goal:${g.id}">${esc(g.icon || '')} ${esc(g.name)}</button>`).join('')}<button class="chip ghost" data-leftover="keep">Keep it as a buffer</button></div></section>` : ''}
  ${ci ? `<div class="note checkin"><span>Weekly check-in: what have you spent since ${fDate(ci)}?</span><button class="btn" data-act="checkin">Add spending</button></div>` : ''}
  ${short ? `<div class="alert"><span>Your plan is short in ${short} pay period${short > 1 ? 's' : ''}. Lower the spending budget, a goal or investments. <a href="#payday">See payday</a></span></div>` : ''}
  ${debts.length ? `<section class="hero card">
    <div class="hero-text">
      <p class="label">Debt destroyed</p>
      <p class="huge">${gbp(paid)}</p>
      <p class="muted">of ${gbp(total)} · ${pct(p)}</p>
      ${meter(p, 'big debt')}
      <p class="hero-foot">${free === 'done' ? 'Debt-free. Every payday is yours now.' : free ? `Debt-free by <b>${fMonth(free.D)}</b>, ${daysTo(free.D).toLocaleString('en-GB')} days to go.` : 'Not debt-free within the plan yet.'}</p>
      <p class="muted small">Next payday ${fDate(np)}, in ${daysTo(np)} days.</p>
    </div>
    <div class="fig" id="debtChart" role="img" aria-label="Debt countdown chart"></div>
  </section>` : ''}
  ${budgetOf(r) > 0 ? `<section class="card spendcard">${spendBlock(r)}<div class="actions left"><button class="btn ghost" data-act="checkin">Add spending</button></div></section>` : ''}
  <section class="hero card grow">
    <div class="hero-text">
      <p class="label">Savings built</p>
      <p class="huge">${gbp(saved)}</p>
      <p class="muted">${planned > 0 ? `+${gbp(planned)} planned this pay period` : 'Nothing planned this pay period'}</p>
      ${targetTotal ? meter(saved / targetTotal, 'big') + `<p class="muted small">${pct(saved / targetTotal)} of your ${gbp(targetTotal, 0)} targets</p>` : ''}
      <div class="tallies">${pots.map(x => `
        <div class="tally">
          <p class="label">${esc(x.t)}</p>
          <p class="num">${gbp(x.v)}</p>
          ${x.target ? meter(x.v / x.target) + `<p class="muted small">${pct(x.v / x.target)} of ${gbp(x.target, 0)}</p>` : `<p class="muted small">${x.note}</p>`}
          <p class="muted small">${x.plan > 0 ? '+' + gbp(x.plan) + ' this period' : 'Nothing this period'}</p>
          ${x.extra ? `<p class="muted small">${x.extra}</p>` : ''}
        </div>`).join('')}
      </div>
    </div>
    <div class="fig" id="growChart" role="img" aria-label="Savings growth chart"></div>
  </section>
  ${tiles.length ? `<div class="grid">${tiles.map(c => `
    <article class="card tile ${c.debt ? 'debt' : ''}">
      <p class="label">${esc(c.t)}</p>
      <p class="num">${gbp(c.v)}</p>
      <p class="muted small">${esc(c.sub)}</p>
      ${c.p != null ? meter(c.p) + badges(c.p) : ''}
      <p class="foot">${esc(c.foot)}</p>
    </article>`).join('')}
  </div>` : ''}
  <div class="head-row"><h2>Goals</h2><a class="btn ghost" href="#goals">Manage goals</a></div>
  ${G.length ? `<div class="grid goals">${G.map(goalTile).join('')}</div>` : `<div class="card empty">No goals yet. <a href="#goals">Add one</a>, like a holiday or a car.</div>`}`}`;
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

// the payday checklist builds itself from the set-up: what stays where and what moves where
function paydaySteps(r) {
  const dds = S.dds.flatMap(d => ddDates(d, r.D, r.E).map(dt => ({ dt, name: d.name, amt: d.amt }))).sort((a, b) => a.dt < b.dt ? -1 : 1);
  const G = goalNeeds(S, rows, cur).filter(g => g.by >= r.A && g.need > 0);
  const salA = acctFor('salary'), billA = acctFor('bills') || salA, savA = acctFor('savings'), key = r.key;
  const where = a => !a ? '' : a === salA ? ` in ${a.bank}` : ` to ${a.bank}`;
  const steps = [
    { id: 'pay', a: salA, t: `Pay lands${salA ? ' in ' + salA.bank : ''}`, v: r.H, extra: `<label class="inline">Actual pay <input type="number" step="0.01" inputmode="decimal" data-pay="${key}" value="${S.actualPay[key] ?? ''}" placeholder="${eff(S.salary, r.D, true).toFixed(2)}"></label>${S.buffer && salA ? `<p class="muted small">Keep your ${gbp(S.buffer, 0)} buffer in ${esc(salA.bank)} on top.</p>` : ''}` },
    { id: 'dd', a: billA, t: billA && billA !== salA ? `Move bills money${where(billA)}` : `Leave for bills${where(billA)}`, v: r.I, extra: dds.length ? `<details><summary>${dds.length} due before next payday</summary><ul class="mini">${dds.map(d => `<li><span>${fDate(d.dt)} · ${esc(d.name)}</span><span>${gbp(d.amt)}</span></li>`).join('')}</ul></details>` : '' },
    ...S.debts.map(d => ({ id: 'debt:' + d.id, a: acctByCode(d.account) || (d.type === 'card' ? acctFor('card') : null), t: `Pay ${d.name}`, v: r.debt[d.id].pay })),
    { id: 'joint', a: acctFor('shared'), t: 'Shared costs', v: r.J },
    ...S.pots.filter(pt => pt.kind === 'ef').map(pt => ({ id: 'pot:' + pt.id, a: savA, t: `${pt.name} pot`, v: r.pot[pt.id].plan })),
    { id: 'goals', a: savA, t: 'Goals pots', v: r.N, extra: G.length && r.status !== 'Closed' ? `<ul class="mini">${G.map(g => `<li><span>${esc(g.icon || '')} ${esc(g.name)}</span><span>${gbp(g.need)}</span></li>`).join('')}</ul>` : '' },
    ...S.pots.filter(pt => pt.kind !== 'ef').sort((p, q) => (q.kind === 'yearly') - (p.kind === 'yearly')).map(pt => ({ id: 'pot:' + pt.id, a: savA, t: `${pt.name} pot`, v: r.pot[pt.id].plan, keep: pt.id === S.spareTo })),
    { id: 'inv', a: acctFor('invest') || savA, t: 'Investments', v: r.INV },
  ].filter(s => s.v > 0.004 || s.id === 'pay' || s.keep);
  return steps;
}
function viewPayday() {
  const r = rows[viewIdx], key = r.key, ck = S.checks[key] || {};
  const steps = paydaySteps(r);
  const done = steps.filter(s => ck[s.id]).length;
  const salA = acctFor('salary'), spendA = acctFor('spending');
  // money that leaves the pay account, totalled by account
  const moves = {};
  // card payments are payments, not transfers, so card accounts aren't listed
  const moving = a => a && a !== salA && !(a.roles || []).includes('card');
  for (const s of steps) if (s.id !== 'pay' && moving(s.a)) moves[s.a.code] = (moves[s.a.code] || 0) + s.v;
  if (moving(spendA)) moves[spendA.code] = (moves[spendA.code] || 0) + budgetOf(r);
  const moveList = Object.entries(moves).filter(([, v]) => v > 0.004);
  return `
  <div class="period card">
    <button class="icon" data-act="prev" aria-label="Previous pay period" ${viewIdx <= 0 ? 'disabled' : ''}>‹</button>
    <div><p class="label">${r.status === 'Current' ? 'This pay period' : r.status === 'Closed' ? 'Past pay period' : 'Coming up'}</p>
      <h1>${fDate(r.D)} → ${fDate(r.E)}</h1><p class="muted small">${r.days} days · ${done} of ${steps.length} done</p></div>
    <button class="icon" data-act="next" aria-label="Next pay period" ${viewIdx >= rows.length - 1 ? 'disabled' : ''}>›</button>
  </div>
  ${meter(done / steps.length)}
  ${r.S < -0.005 ? `<div class="alert"><span>Short by ${gbp(-r.S)} this period. Lower the spending budget, a goal or investments in Manage.</span></div>` : ''}
  ${moveList.length && salA ? `<section class="card moves"><p class="label">Moving out of ${esc(salA.bank)} on payday</p><ul class="mini">${moveList.map(([c, v]) => { const a = acctByCode(c); return `<li><span>${esc(a.bank)} ${chip(a)}</span><span>${gbp(v)}</span></li>`; }).join('')}</ul></section>` : ''}
  <ol class="steps">${steps.map((s, i) => `
    <li class="step card ${ck[s.id] ? 'done' : ''}">
      <label class="tick"><input type="checkbox" data-check="${key}|${s.id}" ${ck[s.id] ? 'checked' : ''}><span>${i + 1}</span></label>
      <div class="step-body"><div class="step-top"><span>${esc(s.t)} ${chip(s.a)}</span><b class="${s.v < 0 ? 'neg' : ''}">${gbp(s.v)}</b></div>${s.extra || ''}</div>
    </li>`).join('')}
  </ol>
  <section class="card spend">
    <p class="label">Yours to spend${spendA ? ' in ' + esc(spendA.bank) : ''}</p><p class="huge">${gbp(budgetOf(r))}</p>
    <p class="muted">About ${gbp(r.weekly)} a week across ${r.days} days${r.R > 0 ? ` (includes ${gbp(r.R)} spare)` : ''}.</p>
    <hr>${spendBlock(r, true)}
    ${r.status !== 'Upcoming' ? '<div class="actions left"><button class="btn ghost" data-act="checkin">Add spending</button></div>' : ''}
  </section>`;
}

function viewLog() {
  const e = logEdit || {};
  const list = [...S.logs.map(l => ({ ...l, _t: 'log' })), ...S.investValues.map(v => ({ ...v, _t: 'value' })), ...(S.spend || []).map(s => ({ ...s, _t: 'spend' }))]
    .sort((a, b) => (a.date === b.date ? (b.id > a.id ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 100);
  const kinds = [...S.debts.map(d => ['debt:' + d.id, d.name]), ...S.pots.map(p => ['pot:' + p.id, p.name]), ...S.goals.map(g => ['goal:' + g.id, (g.icon ? g.icon + ' ' : '') + g.name]), ['invest', 'Investments']];
  if (!kinds.some(k => k[0] === logKind)) logKind = kinds[0][0];
  const isDebt = logKind.startsWith('debt:');
  const editingSpend = logEdit && logEdit.type === 'spend';
  const form = logMode === 'spend' ? `
    <div class="seg" role="group" aria-label="Kind of spending">
      <button class="${spendType === 'everyday' ? 'on' : ''}" data-stype="everyday">Everyday</button>
      <button class="${spendType === 'oneoff' ? 'on' : ''}" data-stype="oneoff">One-off</button></div>
    <p class="muted small">${spendType === 'everyday' ? 'Add up what you’ve spent since your last check-in from your banking app, and enter the total.' : 'A bigger, unusual payment. It’s shown separately so it doesn’t distort the picture.'}</p>
    <div class="fields">
      <label>Amount<input id="fAmt" type="number" step="0.01" min="0" inputmode="decimal" value="${e.amt ?? ''}" placeholder="0.00"></label>
      <label>Date<input id="fDate" type="date" value="${e.date || todayIso()}"></label>
      ${spendType === 'oneoff' ? `<label class="wide">What was it?<input id="fReason" maxlength="60" value="${esc(e.reason || '')}" placeholder="Car repair"></label>
      <label class="wide">Paid from<select id="fPot"><option value="">My spending budget</option>${S.pots.map(p => `<option value="${p.id}" ${e.pot === p.id ? 'selected' : ''}>${esc(p.name)} pot</option>`).join('')}</select></label>` : ''}
    </div>` : `
    <div class="chips" role="group" aria-label="What it's for">${kinds.map(([k, l]) => `<button class="chip ${logKind === k ? 'on' : ''}" data-kind="${k}">${esc(l)}</button>`).join('')}</div>
    ${isDebt ? '' : `<div class="seg" role="group" aria-label="Direction">
      <button class="${logDir === 'in' ? 'on' : ''}" data-dir="in">${logKind === 'invest' ? 'Paid in' : 'Money in'}</button>
      <button class="${logDir === 'out' ? 'on' : ''}" data-dir="out">${logKind === 'invest' ? 'Withdrawn' : 'Money out'}</button>
      ${logKind === 'invest' ? `<button class="${logDir === 'value' ? 'on' : ''}" data-dir="value">Update value</button>` : ''}</div>`}
    <div class="fields">
      <label>${logDir === 'value' ? 'Value shown in your app' : 'Amount'}<input id="fAmt" type="number" step="0.01" min="0" inputmode="decimal" value="${e.amt ?? e.value ?? ''}" placeholder="0.00"></label>
      <label>Date<input id="fDate" type="date" value="${e.date || todayIso()}"></label>
      ${logDir === 'value' ? '' : `<label class="wide">Note<input id="fNote" type="text" maxlength="80" value="${esc(e.note || '')}" placeholder="Optional"></label>`}
    </div>`;
  return `
  <section class="card form">
    <h1>${logEdit ? 'Edit entry' : logMode === 'spend' ? 'Add spending' : 'Log a payment'}</h1>
    ${logEdit ? '' : `<div class="seg wide" role="group" aria-label="Type of entry"><button class="${logMode === 'pay' ? 'on' : ''}" data-mode="pay">Payment</button><button class="${logMode === 'spend' ? 'on' : ''}" data-mode="spend">Spending</button></div>`}
    ${form}
    <div class="actions">${logEdit ? '<button class="btn ghost" data-act="cancelEdit">Cancel</button>' : ''}<button class="btn" data-act="${logMode === 'spend' || editingSpend ? 'saveSpend' : 'saveLog'}">${logEdit ? 'Save changes' : 'Save'}</button></div>
  </section>
  <div class="head-row"><h2>History</h2></div>
  ${list.length ? `<ul class="history card">${list.map(l => {
    const when = fDate(l.date, { day: 'numeric', month: 'short', year: 'numeric' });
    if (l._t === 'value') return `<li><div><b>Investments value</b><span class="muted small">${when}</span></div><span class="amt">${gbp(l.value)}</span><span class="row-btns"><button data-edit-value="${l.id}">Edit</button><button data-del-value="${l.id}">Delete</button></span></li>`;
    if (l._t === 'spend') return `<li><div><b>Spending · ${l.type === 'oneoff' ? esc(l.reason || 'One-off') : 'Everyday'}</b><span class="muted small">${when}${l.pot ? ' · from ' + esc(potName(l.pot)) : ''}</span></div><span class="amt">${gbp(l.amt)}</span><span class="row-btns"><button data-edit-spend="${l.id}">Edit</button><button data-del-spend="${l.id}">Delete</button></span></li>`;
    return `<li><div><b>${esc(kindLabel(l))}</b><span class="muted small">${when}${l.note ? ' · ' + esc(l.note) : ''}</span></div><span class="amt ${l.dir === 'out' ? 'neg' : ''}">${l.dir === 'out' ? '−' : '+'}${gbp(l.amt).replace('−', '')}</span><span class="row-btns"><button data-edit="${l.id}">Edit</button><button data-del="${l.id}">Delete</button></span></li>`;
  }).join('')}</ul>`
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

// ----- manage: generic editors -----
const getPath = path => path.split('.').reduce((o, k) => o?.[k], S);
const fld = (label, path, type = 'number', extra = '') => `<label>${label}<input type="${type}" data-bind="${path}" value="${esc(getPath(path) ?? '')}" ${type === 'number' ? 'step="0.01" inputmode="decimal"' : ''} ${extra}></label>`;
const sel = (label, path, opts) => `<label>${label}<select data-bind="${path}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(getPath(path) ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const bankOptions = v => `<option value="">Choose…</option>${Object.entries(BANKS).map(([g, bs]) => `<optgroup label="${g}">${bs.map(b => `<option ${b === v ? 'selected' : ''}>${esc(b)}</option>`).join('')}</optgroup>`).join('')}<option value="Other" ${v === 'Other' ? 'selected' : ''}>Other</option>`;
const listEditor = (name, cols, addLabel) => `
  <div class="list">${S[name].map((it, i) => `<div class="lrow">${cols.map(c => c.type === 'check'
    ? `<label class="check"><input type="checkbox" data-list="${name}" data-i="${i}" data-f="${c.f}" ${it[c.f] !== false ? 'checked' : ''}> ${c.l}</label>`
    : c.type === 'select' ? `<label class="${c.cls || ''}">${c.l}<select data-list="${name}" data-i="${i}" data-f="${c.f}">${c.opts.map(([v, t]) => `<option value="${esc(v)}" ${String(it[c.f] ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
    : c.type === 'bank' ? `<label class="${c.cls || ''}">${c.l}<select data-list="${name}" data-i="${i}" data-f="${c.f}">${bankOptions(it[c.f])}</select></label>`
    : c.type === 'roles' ? `<fieldset class="roles"><legend>Used for</legend>${Object.entries(ROLES).map(([k, t]) => `<label class="check"><input type="checkbox" data-role="${k}" data-i="${i}" ${(it.roles || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</fieldset>`
    : `<label class="${c.cls || ''}">${c.l}<input type="${c.type || 'text'}" data-list="${name}" data-i="${i}" data-f="${c.f}" value="${esc(it[c.f] ?? '')}" ${c.type === 'number' ? 'step="0.01" inputmode="decimal"' : ''} ${c.attrs || ''}></label>`).join('')}
    <button class="icon del" data-delrow="${name}:${i}" aria-label="Remove">×</button></div>`).join('')}</div>
  <button class="btn ghost" data-addrow="${name}">${addLabel}</button>`;
const ROW_BLANKS = {
  dds: () => ({ name: '', amt: null, freq: 'm', day: null, anchor: '', end: '', active: true }),
  joint: () => ({ name: '', amt: null, freq: 'monthly', active: true }),
  sinking: () => ({ name: '', annual: null, active: true }),
  salary: () => ({ from: todayIso().slice(0, 7), amt: null }), budget: () => ({ from: todayIso().slice(0, 7), amt: null }), investPlan: () => ({ from: todayIso().slice(0, 7), amt: null }),
  debts: () => ({ name: '', type: 'card', balance: null, asAt: todayIso(), rate: null, promoEnd: '', min: null, clearBy: '', start: '', setAmt: null, account: '' }),
  pots: () => ({ name: '', kind: 'other', target: null, each: null, opening: 0, asAt: todayIso() }),
  accounts: () => ({ bank: '', code: '', roles: [] }),
};
function viewManage() {
  const r = rows[cur], per = isMonthly(S) ? 'month' : 'payday';
  const ddTotal = S.dds.filter(d => d.active !== false).reduce((a, d) => a + (d.freq === '28' ? d.amt * 13 / 12 : +d.amt), 0);
  const overrides = Object.entries(S.paydayOverrides).sort();
  const freq = (S.pay || {}).freq || 'last';
  const acctOpts = [['', 'None'], ...S.accounts.map(a => [a.code, `${a.bank || 'Account'} (${a.code})`])];
  return `<h1>Manage</h1>
  <details class="card sec" open><summary>Pay and region <span class="muted">${gbp(r.H, 0)} each payday</span></summary>
    <div class="fields">${sel('How often you’re paid', 'pay.freq', Object.entries(PAY_FREQS))}
    ${freq === 'fixed' ? fld('Day of the month', 'pay.day', 'number', 'step="1" min="1" max="31"') : ''}
    ${STEP_DAYS[freq] ? fld('A recent payday', 'pay.anchor', 'date') : ''}
    ${sel('Bank holidays for', 'region', Object.entries(REGIONS))}</div>
    <p class="muted small">${freq === 'last' ? 'Paid on the last working day, skipping weekends and bank holidays.' : 'If payday falls on a weekend or bank holiday, it’s taken as the working day before.'} Move a single payday below when it’s different.</p>
    <p class="label">Take-home each payday</p>${listEditor('salary', [{ f: 'from', l: 'From', type: 'month' }, { f: 'amt', l: 'Take-home', type: 'number' }], 'Add pay change')}
    <details class="more"><summary>Move a payday (${overrides.length} moved)</summary>
    <div class="list">${overrides.map(([m, d]) => `<div class="lrow"><label>Pay period<input value="${esc(m)}" disabled></label><label>Paid on<input type="date" value="${d}" data-ovd="${m}"></label><button class="icon del" data-delov="${m}" aria-label="Remove">×</button></div>`).join('')}</div>
    <button class="btn ghost" data-act="addOv">Move the next payday</button></details></details>
  <details class="card sec"><summary>Spending <span class="muted">${gbp(budgetOf(r), 0)} this period</span></summary>
    <p class="label">Spending budget each payday</p>${listEditor('budget', [{ f: 'from', l: 'From', type: 'month' }, { f: 'amt', l: 'Budget', type: 'number' }], 'Add budget change')}
    <div class="fields">${sel('Spare money goes to', 'spareTo', [...S.pots.filter(p => p.kind !== 'yearly').map(p => [p.id, p.name + ' pot']), ['spending', 'Spending']])}
    ${S.simple ? '' : fld('Buffer kept in your pay account', 'buffer')}</div>
    <p class="muted small">Each change applies from its month onwards, so past months keep what they had.</p></details>
  <details class="card sec"><summary>Accounts <span class="muted">${S.simple ? 'One account' : S.accounts.length + (S.accounts.length === 1 ? ' account' : ' accounts')}</span></summary>
    <label class="check"><input type="checkbox" data-act="toggleSimple" ${S.simple ? '' : 'checked'}> I split my money across different accounts</label>
    ${S.simple ? '<p class="muted small">Leave this off if everything goes through one account. The payday checklist stays short.</p>' : `
    <p class="muted small">Give each account a short code and say what it’s used for. The payday checklist uses these to show what moves where.</p>
    ${listEditor('accounts', [{ f: 'bank', l: 'Bank', type: 'bank', cls: 'wide' }, { f: 'code', l: 'Code', attrs: 'maxlength="3"' }, { f: 'roles', type: 'roles' }], 'Add account')}`}</details>
  <details class="card sec"><summary>Debts <span class="muted">${gbp(S.debts.reduce((a, d) => a + B.debt[d.id], 0))} left</span></summary>
    <p class="muted small">Each debt is paid at the pace needed to clear it by its clear-by month (or before a 0% deal ends). With neither, the plan pays the minimum.</p>
    ${listEditor('debts', [{ f: 'name', l: 'Name', cls: 'wide' }, { f: 'type', l: 'Type', type: 'select', opts: Object.entries(DEBT_TYPES) }, { f: 'balance', l: 'Balance', type: 'number' }, { f: 'asAt', l: 'Balance on', type: 'date' },
      { f: 'min', l: 'Minimum a month', type: 'number' }, { f: 'clearBy', l: 'Clear by', type: 'month' }, { f: 'promoEnd', l: '0% ends', type: 'date' }, { f: 'rate', l: 'Interest rate %', type: 'number' },
      { f: 'start', l: 'Repayments start', type: 'month' }, { f: 'setAmt', l: 'Pay a set amount a month while other debts are cleared', type: 'number', cls: 'wide' }, ...(S.simple ? [] : [{ f: 'account', l: 'Account', type: 'select', opts: acctOpts }])], 'Add debt')}
    <p class="muted small">A set amount frees money for the next debt in the list. Once the others are cleared, this one catches up to hit its own date.</p></details>
  <details class="card sec"><summary>Pots <span class="muted">${S.pots.length} pots</span></summary>
    <p class="muted small">The emergency fund is filled first (up to its target), then goals, then yearly costs, then other pots. Spare money goes to the pot chosen under Spending.</p>
    ${listEditor('pots', [{ f: 'name', l: 'Name', cls: 'wide' }, { f: 'kind', l: 'Type', type: 'select', opts: Object.entries(POT_KINDS) }, { f: 'target', l: 'Target', type: 'number' }, { f: 'each', l: 'Each payday', type: 'number' }, { f: 'opening', l: 'In it now', type: 'number' }, { f: 'asAt', l: 'As at', type: 'date' }], 'Add pot')}</details>
  <details class="card sec" id="dds"><summary>Bills <span class="muted">${gbp(ddTotal)} a month on average</span></summary>
    ${listEditor('dds', [{ f: 'name', l: 'Bill', cls: 'wide' }, { f: 'amt', l: 'Amount', type: 'number' }, { f: 'freq', l: 'How often', type: 'select', opts: [['m', 'Monthly'], ['28', 'Every 28 days']] }, { f: 'day', l: 'Day of month', type: 'number' }, { f: 'anchor', l: 'A known date (28-day)', type: 'date' }, { f: 'end', l: 'Ends', type: 'date' }, { f: 'active', l: 'Active', type: 'check' }], 'Add bill')}
    <p class="muted small">Bills count in a pay period only when they fall due before the next payday. Weekend or bank holiday dates move to the next working day.</p></details>
  <details class="card sec"><summary>Shared costs <span class="muted">${gbp(r.J)} each payday</span></summary>
    <p class="muted small">Your share of costs with a partner or housemates. Skip this if you live alone.</p>
    ${listEditor('joint', [{ f: 'name', l: 'Item', cls: 'wide' }, { f: 'amt', l: 'Your share', type: 'number' }, { f: 'freq', l: 'How often', type: 'select', opts: [['monthly', 'Monthly'], ['weekly', 'Weekly'], ['annual', 'Yearly']] }, { f: 'active', l: 'Active', type: 'check' }], 'Add shared cost')}</details>
  <details class="card sec"><summary>Yearly costs <span class="muted">${gbp(r.O)} each payday</span></summary>
    <p class="muted small">Things that come round once a year, like car tax or an MOT. The plan sets a little aside each payday.</p>
    ${listEditor('sinking', [{ f: 'name', l: 'Cost', cls: 'wide' }, { f: 'annual', l: 'Per year', type: 'number' }, { f: 'active', l: 'Active', type: 'check' }], 'Add yearly cost')}</details>
  <details class="card sec"><summary>Investments <span class="muted">${gbp(B.invValue)}</span></summary><div class="fields">
    ${fld('Value now', 'investments.opening')}${fld('Value on', 'investments.asAt', 'date')}${fld('Target (optional)', 'investments.target')}</div>
    <p class="label">Paid in each payday</p>${listEditor('investPlan', [{ f: 'from', l: 'From', type: 'month' }, { f: 'amt', l: 'Amount', type: 'number' }], 'Add contribution')}</details>
  <details class="card sec"><summary>Your data</summary>
    <p class="muted small">Saved on this phone only. Download a backup now and then, and keep it somewhere safe (Google Drive, or email it to yourself). Never upload it anywhere public.${S.lastBackup ? ' Last backup: ' + fDate(S.lastBackup, { day: 'numeric', month: 'short', year: 'numeric' }) + '.' : ''}</p>
    <div class="actions left"><button class="btn" data-act="export">Export to Excel</button><button class="btn ghost" data-act="backup">Download backup</button>
    <label class="btn ghost file">Restore backup<input type="file" accept=".json,application/json" id="restore"></label></div>
    <p class="label" style="margin-top:16px">Start again</p>
    <p class="muted small">Deletes everything in Stratrix on this phone and takes you back to the welcome screen. Download a backup first if you might want it back. Other apps aren’t affected.</p>
    <div class="actions left"><button class="btn ghost danger" data-act="startAgain">${armed ? 'Tap again to delete everything' : 'Start again'}</button></div></details>
  <p class="muted small center">Stratrix helps you plan and track. It isn’t financial advice.</p>`;
}

// ----- charts -----
function areaChart(box, layers, nowIdx, labels) {
  if (!box) return;
  const W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
  const pad = { l: 8, r: 8, t: 20, b: 26 };
  const n = rows.length, tops = rows.map((_, i) => layers.reduce((a, L) => a + L.f(i), 0)), max = Math.max(1, ...tops);
  const X = i => pad.l + (W - pad.l - pad.r) * i / (n - 1), Y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const cum = (i, k) => layers.slice(0, k).reduce((a, L) => a + L.f(i), 0);
  const paths = layers.map((L, k) => `<path class="${L.cls}" d="M${rows.map((_, i) => `${X(i)},${Y(cum(i, k + 1))}`).join('L')}L${rows.map((_, j) => { const i = n - 1 - j; return `${X(i)},${Y(cum(i, k))}`; }).join('L')}Z"/>`).join('');
  // a month label roughly every year on phones, every six months on wider screens
  const months = isMonthly(S) ? 1 : 12 / perYear(S), step = Math.max(1, Math.round((W < 520 ? 12 : 6) / months));
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths}
    <line x1="${X(nowIdx)}" x2="${X(nowIdx)}" y1="${pad.t - 6}" y2="${H - pad.b}" class="now"/>
    <text x="${Math.min(X(nowIdx) + 6, W - 40)}" y="${pad.t - 6}" class="t-now">Now</text>
    ${rows.map((r, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - 8}" class="t-ax" text-anchor="${i === 0 ? 'start' : 'middle'}">${fMonth(r.D).replace(' 20', " '")}</text>` : '').join('')}
  </svg><div class="legend">${labels.map(([c, t]) => `<span class="k ${c}"></span>${esc(t)}`).join(' ')}</div>`;
}
function drawChart() {
  areaChart($('#debtChart'), S.debts.map((d, k) => ({ cls: 'a-d' + (k % 4), f: i => rows[i].debt[d.id].bal })), cur, S.debts.map((d, k) => ['k-d' + (k % 4), d.name]));
  // savings: today's balances, then what the plan adds each pay period
  const potAt = (pt, i) => i <= cur ? B.pot[pt.id] : Math.max(0, rows[i].pot[pt.id].bal + (B.pot[pt.id] - rows[cur].pot[pt.id].bal));
  const ef = S.pots.filter(p => p.kind === 'ef'), other = S.pots.filter(p => p.kind === 'savings');
  const inv = []; rows.forEach((r, i) => { inv[i] = i <= cur ? B.invValue : inv[i - 1] + rows[i - 1].INV; });
  const layers = [{ cls: 'a-ef', f: i => ef.reduce((a, p) => a + potAt(p, i), 0) }, { cls: 'a-sav', f: i => other.reduce((a, p) => a + potAt(p, i), 0) }];
  const labels = [['k-ef', 'Emergency fund'], ['k-sav', 'Savings']];
  if (B.invValue || S.investPlan.length) { layers.push({ cls: 'a-inv', f: i => inv[i] }); labels.push(['k-inv', 'Investments']); }
  areaChart($('#growChart'), layers, cur, labels);
}
const chartRO = new ResizeObserver(() => drawChart());

// ----- export -----
function exportSheets() {
  const h = a => a.map(v => ({ v, t: 'h' }));
  const g = v => ({ v: Math.round(v * 100) / 100, t: 'gbp' });
  const G = goalsNow(), r = rows[cur], steps = paydaySteps(r);
  const sheets = [];
  sheets.push({ name: 'Summary', widths: [40, 16], rows: [[{ v: 'This pay period', t: 'title' }], [`${fDate(r.D)} → ${fDate(r.E)} (${r.days} days)`], [],
    h(['On payday', 'Amount']), ...steps.map(s => [s.t + (s.a ? ` (${s.a.code})` : ''), g(s.v)]), ['Left to spend', g(budgetOf(r))], [],
    h(['Where you stand', 'Balance']), ...S.debts.map(d => [d.name, g(B.debt[d.id])]), ...S.pots.map(p => [p.name, g(B.pot[p.id])]), ['Investments', g(B.invValue)], ['Goals', g(G.reduce((a, x) => a + x.saved, 0))]] });
  const dCols = S.debts.flatMap(d => [d.name + ' payment', d.name + ' balance']), pCols = S.pots.map(p => p.name);
  sheets.push({ name: 'Plan', widths: [12, 12, 8, 10, 14, 14, 14, ...dCols.map(() => 16), ...pCols.map(() => 14), 14, 14, 14, 14, 14, 14], rows: [
    h(['Payday', 'Next payday', 'Days', 'Status', 'Take-home', 'Bills due', 'Shared costs', ...dCols, ...pCols, 'Goals', 'Spending budget', 'Extra to spending', 'Spare to ' + spareName(), 'Investments', 'Weekly allowance']),
    ...rows.map(x => [{ v: x.D, t: 'date' }, { v: x.E, t: 'date' }, x.days, x.status, g(x.H), g(x.I), g(x.J), ...S.debts.flatMap(d => [g(x.debt[d.id].pay), g(x.debt[d.id].bal)]), ...S.pots.map(p => g(x.pot[p.id].plan)), g(x.N), g(x.Q), g(x.R), g(Math.max(0, x.S)), g(x.INV), g(x.weekly)])] });
  sheets.push({ name: 'Bills', widths: [24, 12, 14, 12, 14, 12, 8], rows: [h(['Bill', 'Amount', 'How often', 'Day', 'Known date', 'Ends', 'Active']), ...S.dds.map(d => [d.name, g(+d.amt), d.freq === '28' ? 'Every 28 days' : 'Monthly', d.day || '', d.anchor ? { v: d.anchor, t: 'date' } : '', d.end ? { v: d.end, t: 'date' } : '', d.active !== false ? 'Yes' : 'No'])] });
  sheets.push({ name: 'Shared Costs', widths: [24, 12, 12, 16, 8], rows: [h(['Item', 'Your share', 'How often', 'Monthly', 'Active']), ...S.joint.map(j => [j.name, g(+j.amt), j.freq, g(sharedMonthly(j)), j.active !== false ? 'Yes' : 'No'])] });
  sheets.push({ name: 'Yearly Costs', widths: [24, 12, 14, 8], rows: [h(['Cost', 'Per year', 'Per month', 'Active']), ...S.sinking.map(s => [s.name, g(+s.annual), g(s.annual / 12), s.active !== false ? 'Yes' : 'No'])] });
  const logRows = (kind, ref) => S.logs.filter(l => l.kind === kind && (!ref || l.ref === ref)).sort((a, b) => a.date < b.date ? -1 : 1).map(l => [{ v: l.date, t: 'date' }, kindLabel(l), l.dir === 'out' ? '' : g(+l.amt), l.dir === 'out' ? g(+l.amt) : '', l.note || '']);
  sheets.push({ name: 'Debts', widths: [24, 18, 14, 14, 12, 12, 14], rows: [h(['Debt', 'Type', 'Started at', 'Left now', '0% ends', 'Clear by', 'This period']), ...S.debts.map(d => [d.name, DEBT_TYPES[d.type] || '', g(debtStart(d)), g(B.debt[d.id]), d.promoEnd ? { v: d.promoEnd, t: 'date' } : '', d.clearBy ? { v: d.clearBy, t: 'month' } : '', g(r.debt[d.id].pay)]), [],
    h(['Date', 'Debt', 'Paid', 'Refund', 'Note']), ...logRows('debt')] });
  sheets.push({ name: 'Pots', widths: [18, 16, 12, 12, 12, 30], rows: [h(['Pot', 'Type', 'Opening', 'Now', 'Target']), ...S.pots.map(p => [p.name, POT_KINDS[p.kind] || '', g(+p.opening || 0), g(B.pot[p.id]), p.target ? g(+p.target) : '']), [],
    h(['Date', 'Pot', 'Paid in', 'Withdrawn', 'Note']), ...logRows('pot')] });
  sheets.push({ name: 'Goals', widths: [6, 22, 12, 12, 12, 10, 16], rows: [h(['Icon', 'Goal', 'Target', 'By', 'Saved', '%', 'This period']), ...G.map(x => [x.icon || '', x.name, g(+x.target), x.by && x.by !== '0000-00-00' ? { v: x.by, t: 'month' } : '', g(x.saved), { v: x.target ? x.saved / x.target : 0, t: 'pct' }, g(x.need)]), [],
    h(['Date', 'Goal', 'Paid in', 'Withdrawn', 'Note']), ...logRows('goal')] });
  sheets.push({ name: 'Spending', widths: [12, 12, 12, 24, 18], rows: [h(['Date', 'Amount', 'Kind', 'What', 'Paid from']), ...[...(S.spend || [])].sort((a, b) => a.date < b.date ? -1 : 1).map(s => [{ v: s.date, t: 'date' }, g(+s.amt), s.type === 'oneoff' ? 'One-off' : 'Everyday', s.reason || '', s.pot ? potName(s.pot) : 'Budget'])] });
  sheets.push({ name: 'Investments', widths: [30, 14, 14, 30], rows: [h(['Summary', 'Value']), ['Current value', g(B.invValue)], ['Paid in (net)', g(B.invPaid)], ['Growth', g(B.invGrowth)], [], h(['Date', 'What', 'Paid in', 'Withdrawn', 'Note']), ...logRows('invest'), [], h(['Date', 'Value']), ...[...S.investValues].sort((a, b) => a.date < b.date ? -1 : 1).map(v => [{ v: v.date, t: 'date' }, g(v.value)])] });
  sheets.push({ name: 'Settings', widths: [34, 24], rows: [h(['Setting', 'Value']), ['Paid', PAY_FREQS[(S.pay || {}).freq || 'last']], ['Bank holidays', REGIONS[S.region || 'ew']], ['Spare money goes to', spareName()], [],
    h(['Take-home from', 'Amount']), ...S.salary.map(s => [{ v: s.from, t: 'month' }, g(+s.amt)]), [], h(['Spending budget from', 'Amount']), ...S.budget.map(s => [{ v: s.from, t: 'month' }, g(+s.amt)]), [],
    h(['Account', 'Code']), ...accts().map(a => [a.bank, a.code])] });
  return sheets;
}

// ----- set-up wizard: five short screens that end on a filled-in dashboard -----
// The answers build a draft (W). Nothing is saved until "Open my dashboard", so backing out leaves the app as it was.
let W = null, wizStep = 0;
const WIZ_STEPS = ['When are you paid?', 'How much lands in your account?', 'What bills go out?', 'Do you owe anything?', 'What are you saving for?', 'Your plan'];
const BILL_PRESETS = ['Rent or mortgage', 'Council tax', 'Energy', 'Water', 'Phone', 'Broadband', 'Car insurance', 'Streaming', 'Gym'];
const DEBT_PRESETS = [['Credit card', 'card'], ['Loan', 'loan'], ['Car finance', 'loan'], ['Overdraft', 'overdraft'], ['Money owed to a person', 'person']];
const GOAL_PRESETS = [['✈️', 'Holiday'], ['🚗', 'Car'], ['🏠', 'House deposit'], ['🎁', 'Christmas'], ['💍', 'Wedding']];
function startWizard() {
  W = clone(DEFAULT_STATE); delete W.blank;
  W._pay = null; W._split = false; W._banks = { salary: '', spending: '', savings: '' }; W._goals = []; W._efTouched = false;
  wizStep = 0; location.hash = '#setup';
}
const monthNow = () => todayIso().slice(0, 7);
const wMonthlyBills = () => W.dds.reduce((a, d) => a + (+d.amt || 0), 0);
// turn the draft's answers into the saved shape (pay, accounts, goals, budget)
function wizBuild(budget) {
  const o = clone(W), m = monthNow();
  o.salary = o._pay > 0 ? [{ id: uid('s'), from: m, amt: +o._pay }] : [];
  o.simple = !o._split;
  o.accounts = [];
  if (o._split) {
    const roles = {};
    for (const [role, bank] of Object.entries(o._banks)) if (bank) (roles[bank] = roles[bank] || []).push(role);
    if (roles[o._banks.salary]) roles[o._banks.salary].push('bills');
    if (roles[o._banks.spending]) roles[o._banks.spending].push('shared');
    const used = new Set();
    o.accounts = Object.entries(roles).map(([bank, rs], i) => { let code = codeFor(bank); while (used.has(code)) code = code.slice(0, 2) + (i + 1); used.add(code); return { id: uid('a'), bank, code, roles: [...new Set(rs)] }; });
  }
  o.dds = o.dds.filter(d => d.name && +d.amt > 0).map(d => ({ ...d, amt: +d.amt, day: +d.day || 1, freq: 'm', active: true }));
  o.debts = o.debts.filter(d => +d.balance > 0).map(d => ({ ...d, balance: +d.balance, min: +d.min || 0 }));
  o.goals = o._goals.filter(g => g.name && +g.target > 0).map(g => ({ id: uid('g'), icon: g.icon, name: g.name, target: +g.target, by: g.by, active: true }));
  if (budget != null) o.budget = [{ id: uid('b'), from: m, amt: +budget || 0 }];
  for (const k of ['_pay', '_split', '_banks', '_goals', '_efTouched', '_budget']) delete o[k];
  return o;
}
// the spending budget suggested from what's left after bills, debts, the emergency fund and goals
function wizSuggest() {
  const o = wizBuild(0), rs = plan(o, todayIso()), r = rs[currentIndex(rs, todayIso())];
  return { r, left: Math.max(0, Math.floor((r.P - r.INV) / 10) * 10) };
}
const wIn = (path, label, type = 'number', extra = '') => {
  const v = path.split('.').reduce((o, k) => o?.[k], W);
  return `<label>${label}<input type="${type}" data-wbind="${path}" value="${esc(v ?? '')}" ${type === 'number' ? 'step="0.01" min="0" inputmode="decimal"' : ''} ${extra}></label>`;
};
const wRow = (list, i, cols) => `<div class="lrow">${cols.map(([f, l, type, extra]) => {
  const v = W[list][i][f];
  return type === 'select' ? `<label>${l}<select data-wlist="${list}" data-i="${i}" data-f="${f}">${extra.map(([k, t]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
    : `<label class="${f === 'name' ? 'wide' : ''}">${l}<input type="${type || 'text'}" data-wlist="${list}" data-i="${i}" data-f="${f}" value="${esc(v ?? '')}" ${type === 'number' ? 'step="0.01" min="0" inputmode="decimal"' : ''} ${extra || ''}></label>`;
}).join('')}<button class="icon del" data-wdel="${list}:${i}" aria-label="Remove">×</button></div>`;
function viewSetup() {
  if (!W) startWizard();
  const s = wizStep, freq = W.pay.freq, per = 'each payday';
  const bankSel = role => `<select data-wbank="${role}">${bankOptions(W._banks[role])}</select>`;
  let body = '';
  if (s === 0) body = `
    <div class="chips">${Object.entries(PAY_FREQS).map(([k, t]) => `<button class="chip ${freq === k ? 'on' : ''}" data-wfreq="${k}">${t}</button>`).join('')}</div>
    <div class="fields">${freq === 'fixed' ? wIn('pay.day', 'Which day of the month?', 'number', 'step="1" min="1" max="31"') : ''}
    ${STEP_DAYS[freq] ? wIn('pay.anchor', 'Your last or next payday', 'date') : ''}</div>
    <p class="label">Where do you live? (for bank holidays)</p>
    <div class="chips">${Object.entries(REGIONS).map(([k, t]) => `<button class="chip ${W.region === k ? 'on' : ''}" data-wregion="${k}">${t}</button>`).join('')}</div>
    <p class="muted small">${freq === 'last' ? 'If the last day is a weekend or bank holiday, you’re paid the working day before.' : 'If payday falls on a weekend or bank holiday, it’s taken as the working day before.'}</p>`;
  if (s === 1) body = `
    <div class="fields">${wIn('_pay', 'Take-home pay ' + per + ' (after tax)')}</div>
    <p class="label">Do you split your money across different accounts?</p>
    <div class="seg"><button class="${W._split ? '' : 'on'}" data-wsplit="no">No, one account</button><button class="${W._split ? 'on' : ''}" data-wsplit="yes">Yes</button></div>
    ${W._split ? `<div class="fields"><label>Pay lands in${bankSel('salary')}</label><label>You spend from${bankSel('spending')}</label><label>You save in${bankSel('savings')}</label></div>
    <p class="muted small">Pick the same bank more than once if it does more than one job. You can add more accounts later in Manage.</p>` : '<p class="muted small">Most people start here. You can switch it on later in Manage.</p>'}`;
  if (s === 2) body = `
    <p class="muted small">Tap to add each one, then fill in the amount and the day it goes out.</p>
    <div class="chips">${BILL_PRESETS.map(b => `<button class="chip ${W.dds.some(d => d.name === b) ? 'on' : ''}" data-wadd="dds:${b}">${W.dds.some(d => d.name === b) ? '✓ ' : '+ '}${b}</button>`).join('')}<button class="chip ghost" data-wadd="dds:">+ Other</button></div>
    <div class="list">${W.dds.map((d, i) => wRow('dds', i, [['name', 'Bill'], ['amt', 'Amount a month', 'number'], ['day', 'Day it goes out', 'number', 'step="1" min="1" max="31"']])).join('')}</div>
    ${W.dds.length ? `<p class="muted small">${gbp(wMonthlyBills())} a month in bills.</p>` : ''}`;
  if (s === 3) body = `
    <p class="muted small">Only the things you’re paying off. Skip this if you don’t owe anything.</p>
    <div class="chips">${DEBT_PRESETS.map(([n, t]) => `<button class="chip" data-wadd="debts:${n}|${t}">+ ${n}</button>`).join('')}</div>
    <div class="list">${W.debts.map((d, i) => wRow('debts', i, [['name', 'Name'], ['balance', 'Owed now', 'number'], ['min', 'Minimum a month', 'number'], ['clearBy', 'Clear it by (optional)', 'month'], ...(d.type === 'card' ? [['promoEnd', '0% ends (optional)', 'date']] : [])])).join('')}</div>
    ${W.debts.length ? '<p class="muted small">With a clear-by month (or a 0% end date), the plan pays what’s needed to clear it in time. Without one, it pays the minimum.</p>' : ''}`;
  if (s === 4) {
    const ef = W.pots.find(p => p.kind === 'ef');
    body = `
    <p class="label">Emergency fund</p>
    <p class="muted small">Money for surprises, so they don’t go on a card. Three months of bills is a common target${W.dds.length ? `: about ${gbp(ef.target, 0)} for you` : ''}.</p>
    <div class="fields">${wIn('pots.0.target', 'Target')}${wIn('pots.0.each', 'Put in ' + per)}${wIn('pots.0.opening', 'Already saved')}</div>
    <p class="label">Goals</p>
    <div class="chips">${GOAL_PRESETS.map(([ic, n]) => `<button class="chip" data-wadd="_goals:${ic}|${n}">+ ${ic} ${n}</button>`).join('')}<button class="chip ghost" data-wadd="_goals:|">+ Other</button></div>
    <div class="list">${W._goals.map((g, i) => wRow('_goals', i, [['name', 'Goal'], ['target', 'Target', 'number'], ['by', 'Reach it by', 'month']])).join('')}</div>`;
  }
  if (s === 5) {
    const { r, left } = wizSuggest();
    if (W._budget == null) W._budget = left;
    const save = Math.max(0, r.P - r.INV - (+W._budget || 0));
    const line = (t, v) => `<li><span>${t}</span><span>${gbp(v)}</span></li>`;
    body = `
    <p class="muted small">This pay period, ${fDate(r.D)} to ${fDate(r.E)}:</p>
    <ul class="mini plan-sum">${line('Take-home', r.H)}${r.I ? line('Bills due', -r.I) : ''}${r.K ? line('Debt payments', -r.K) : ''}${r.M ? line('Emergency fund', -r.M) : ''}${r.N ? line('Goals', -r.N) : ''}<li class="tot"><span>Left for spending and savings</span><span>${gbp(r.P - r.INV)}</span></li></ul>
    <div class="fields"><label>Spending budget ${per}<input type="number" step="10" min="0" inputmode="decimal" data-wbudget value="${W._budget}"></label></div>
    <p class="muted small">${r.P - r.INV < 0 ? 'Your plan is short this period. Lower a goal, the emergency fund payment, or check the figures.' : `We’ve suggested all of it. Lower it to save the difference: ${gbp(save)} would go to savings.`}</p>`;
  }
  const last = s === WIZ_STEPS.length - 1;
  return `<section class="card wiz">
    <div class="wiz-top"><p class="label">${last ? 'Nearly done' : `Step ${s + 1} of 5`}</p>${s < 5 ? '<button class="linkish" data-wnav="skip">Skip</button>' : ''}</div>
    ${meter(s / 5)}
    <h1>${WIZ_STEPS[s]}</h1>
    ${body}
    <div class="actions">${s > 0 ? '<button class="btn ghost" data-wnav="back">Back</button>' : '<button class="btn ghost" data-wnav="cancel">Cancel</button>'}
    <button class="btn" data-wnav="${last ? 'finish' : 'next'}">${last ? 'Open my dashboard' : 'Next'}</button></div>
  </section>
  <p class="muted small center">Everything stays on this phone. Stratrix isn’t financial advice.</p>`;
}
function wizGo(to) {
  if (to === 4 && !W._efTouched) {        // suggest three months of bills, rounded up to the next £100
    const ef = W.pots.find(p => p.kind === 'ef'), bills = wMonthlyBills();
    if (bills > 0) ef.target = Math.max(500, Math.ceil(bills * 3 / 100) * 100);
    if (!ef.each && W._pay > 0) ef.each = Math.max(10, Math.round(Math.min(ef.target / 12 * 12 / perYear(W), W._pay * 0.05) / 5) * 5);
  }
  if (to === 5) W._budget = null;
  wizStep = Math.max(0, Math.min(WIZ_STEPS.length - 1, to)); render(); scrollTo(0, 0);
}
function wizFinish() {
  const prev = clone(S);
  S = wizBuild(W._budget);
  S.firstRun = true; S.theme = prev.theme;
  W = null; viewIdx = null; location.hash = '#home';
  commit('You’re all set up', prev);
}
document.addEventListener('input', e => {
  const t = e.target; if (!W) return;
  if (t.dataset.wbind) { setW(t.dataset.wbind, t.type === 'number' ? num(t.value) : t.value); if (t.dataset.wbind.startsWith('pots.0')) W._efTouched = true; }
  if (t.dataset.wlist) W[t.dataset.wlist][+t.dataset.i][t.dataset.f] = t.type === 'number' ? num(t.value) : t.value;
  if (t.dataset.wbudget != null) W._budget = num(t.value);
});
document.addEventListener('change', e => {
  const t = e.target; if (!W) return;
  if (t.dataset.wbank) { W._banks[t.dataset.wbank] = t.value; }
  if (t.dataset.wlist && t.dataset.f === 'amt' && wizStep === 2) render();      // refresh the monthly total
  if (t.dataset.wbudget != null) render();
});
function setW(path, val) { const ks = path.split('.'); let o = W; ks.slice(0, -1).forEach(k => o = o[k]); o[ks.at(-1)] = val; }
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-act]'); if (!t) return;
  const d = t.dataset;
  if (d.act === 'setup') return startWizard();
  if (d.act === 'sample') return loadSample();
  if (!W) return;
  if (d.wfreq) { W.pay.freq = d.wfreq; return render(); }
  if (d.wregion) { W.region = d.wregion; return render(); }
  if (d.wsplit) { W._split = d.wsplit === 'yes'; return render(); }
  if (d.wadd) {
    const [list, val] = d.wadd.split(':'), [a, b] = val.split('|');
    if (list === 'dds') { if (a && W.dds.some(x => x.name === a)) W.dds = W.dds.filter(x => x.name !== a); else W.dds.push({ id: uid('d'), name: a, amt: null, day: null }); }
    if (list === 'debts') W.debts.push({ id: uid('d'), name: a === 'Money owed to a person' ? '' : a, type: b, balance: null, asAt: todayIso(), min: null, clearBy: '', promoEnd: '', rate: null, start: '', setAmt: null, account: '' });
    if (list === '_goals') W._goals.push({ icon: a, name: b, target: null, by: '' });
    render();
    const inputs = document.querySelectorAll(`[data-wlist="${list}"][data-f="${list === 'dds' ? 'amt' : list === 'debts' ? (a === 'Money owed to a person' ? 'name' : 'balance') : 'target'}"]`);
    if (inputs.length && !(list === 'dds' && !W.dds.some(x => x.name === a))) inputs[inputs.length - 1].focus();
    return;
  }
  if (d.wdel) { const [list, i] = d.wdel.split(':'); W[list].splice(+i, 1); return render(); }
  if (d.wnav === 'next' || d.wnav === 'skip') return wizGo(wizStep + 1);
  if (d.wnav === 'back') return wizGo(wizStep - 1);
  if (d.wnav === 'cancel') { W = null; location.hash = '#home'; return; }
  if (d.wnav === 'finish') return wizFinish();
});

// ----- sample data: a made-up person to explore with, cleared with one tap -----
function loadSample() {
  const t = todayIso(), m = t.slice(0, 7), mAdd = n => addMonths(m + '-01', n).slice(0, 7), dAgo = n => addD(t, -n);
  const prev = clone(S);
  S = Object.assign(clone(DEFAULT_STATE), {
    blank: false, sample: true, theme: S.theme,
    salary: [{ id: 's1', from: m, amt: 2150 }], budget: [{ id: 'b1', from: m, amt: 520 }],
    dds: [['Rent', 795, 1], ['Council tax', 142, 1], ['Energy', 96, 12], ['Phone', 18, 20], ['Broadband', 29, 8], ['Streaming', 11, 15]].map(([name, amt, day], i) => ({ id: 'dd' + i, name, amt, day, freq: 'm', active: true })),
    debts: [{ id: 'cc', name: 'Credit card', type: 'card', balance: 1840, asAt: dAgo(40), min: 25, clearBy: '', promoEnd: addMonths(m + '-01', 16), rate: 0, start: '', setAmt: null, account: '' },
      { id: 'loan', name: 'Car loan', type: 'loan', balance: 4300, asAt: dAgo(40), min: 165, clearBy: mAdd(26), promoEnd: '', rate: 7.9, start: '', setAmt: null, account: '' }],
    sinking: [{ id: 'y1', name: 'Car tax', annual: 190, active: true }, { id: 'y2', name: 'MOT and service', annual: 260, active: true }],
    goals: [{ id: 'g1', icon: '✈️', name: 'Holiday', target: 900, by: mAdd(8), active: true }],
    logs: [{ id: 'l1', kind: 'debt', ref: 'cc', dir: 'in', amt: 120, date: dAgo(20), note: '' }, { id: 'l2', kind: 'debt', ref: 'loan', dir: 'in', amt: 165, date: dAgo(20), note: '' },
      { id: 'l3', kind: 'pot', ref: 'ef', dir: 'in', amt: 100, date: dAgo(20), note: '' }, { id: 'l4', kind: 'goal', ref: 'g1', goal: 'g1', dir: 'in', amt: 75, date: dAgo(20), note: '' }],
    spend: [{ id: 'sp1', type: 'everyday', amt: 134.6, date: dAgo(8) }, { id: 'sp2', type: 'oneoff', amt: 62, date: dAgo(5), reason: 'Birthday present' }],
  });
  S.pots[0].target = 3200; S.pots[0].each = 100; S.pots[0].opening = 250;
  viewIdx = null; location.hash = '#home'; commit('Sample data loaded', prev);
}
// "Your next 3 steps" after set-up: ticks itself off as each is done
function nextSteps() {
  if (!S.firstRun || S.sample) return '';
  const r = rows[cur], ck = S.checks[r.key] || {};
  const items = [
    { done: Object.values(ck).some(Boolean), t: 'Check this payday’s list', sub: 'See what goes where and tick each one off', href: '#payday' },
    { done: S.logs.length > 0 || (S.spend || []).length > 0, t: 'Log a payment or your spending', sub: 'Every entry moves your dashboard', href: '#log' },
    { done: !!S.lastBackup, t: 'Download a backup', sub: 'Keep it in Google Drive or email it to yourself', act: 'backup' },
  ];
  if (items.every(i => i.done)) { delete S.firstRun; save(); return ''; }
  return `<section class="card steps3"><div class="head-row"><h2>Your next 3 steps</h2><button class="linkish" data-act="hideSteps">Hide</button></div>
    <ol>${items.map(i => `<li class="${i.done ? 'done' : ''}">${i.act ? `<button class="linkish" data-act="${i.act}">` : `<a href="${i.href}">`}<b>${i.t}</b>${i.act ? '</button>' : '</a>'}<span class="muted small">${i.done ? 'Done' : i.sub}</span></li>`).join('')}</ol></section>`;
}

// ----- render & routing -----
const ROUTES = { home: viewHome, payday: viewPayday, log: viewLog, goals: viewGoals, manage: viewManage, setup: viewSetup };
const route = () => (location.hash || '#home').slice(1) in ROUTES ? (location.hash || '#home').slice(1) : 'home';
let lastRoute = null;
function render() {
  document.documentElement.dataset.theme = resolvedTheme();
  const rt = route();
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === rt));
  const r = rows[cur];
  $('#status').textContent = '';
  $('#nextPay').textContent = r ? `Payday ${fDate(todayIso() < r.D ? r.D : r.E, { day: 'numeric', month: 'short' })}` : '';
  const y = scrollY;
  // remember which Manage sections are open, so editing a field doesn't fold them away
  const open = [...document.querySelectorAll('#main details')].map(d => d.open);
  $('#main').innerHTML = ROUTES[rt]();
  if (rt === lastRoute) document.querySelectorAll('#main details').forEach((d, i) => { if (open[i] != null) d.open = open[i]; });
  scrollTo(0, rt === lastRoute ? y : 0); lastRoute = rt;
  chartRO.disconnect(); ['#debtChart', '#growChart'].forEach(id => { const b = $(id); if (b) chartRO.observe(b); });
}
const commit = (msg, undoState) => { if (S.blank) delete S.blank; recalc(); const m = milestones(false); save(); render(); if (m) toast(m + (msg ? ' · ' + msg : ''), undoState, 5000); else if (msg) toast(msg, undoState); };

// ----- events -----
function setPath(path, val) { const ks = path.split('.'); let o = S; ks.slice(0, -1).forEach(k => o = o[k] = o[k] || {}); o[ks.at(-1)] = val; }
const num = v => v === '' || v == null ? null : Number(v);
const slug = s => (s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'item';
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.bind) { setPath(t.dataset.bind, t.type === 'number' ? num(t.value) : t.value); return commit(); }
  if (t.dataset.role) { const a = S.accounts[+t.dataset.i]; a.roles = (a.roles || []).filter(x => x !== t.dataset.role); if (t.checked) a.roles.push(t.dataset.role); return commit(); }
  if (t.dataset.list) {
    const it = S[t.dataset.list][+t.dataset.i];
    it[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? num(t.value) : t.value;
    if (t.dataset.list === 'accounts' && t.dataset.f === 'bank' && (!it.code || it.autoCode)) { it.code = codeFor(t.value); it.autoCode = true; }
    if (t.dataset.list === 'accounts' && t.dataset.f === 'code') { it.code = t.value.toUpperCase().slice(0, 3); delete it.autoCode; }
    return commit();
  }
  if (t.dataset.check) { const [k, s] = t.dataset.check.split('|'); S.checks[k] = S.checks[k] || {}; S.checks[k][s] = t.checked; save(); return render(); }
  if (t.dataset.pay) { if (t.value === '') delete S.actualPay[t.dataset.pay]; else S.actualPay[t.dataset.pay] = +t.value; return commit(); }
  if (t.dataset.ovd) { S.paydayOverrides[t.dataset.ovd] = t.value; return commit(); }
  if (t.id === 'restore' && t.files[0]) {
    t.files[0].text().then(txt => { const o = JSON.parse(txt); if (!o || typeof o !== 'object' || !Array.isArray(o.logs)) throw 0; const prev = clone(S); delete o.blank; const keepTheme = S.theme; applyLoaded(o); S.theme = keepTheme; delete S.blank; viewIdx = null; commit('Backup restored', prev); })
      .catch(() => toast('That file isn’t a Stratrix or Payday HQ backup.'));
  }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-act]'); if (!t) return;
  const d = t.dataset;
  if (d.act === 'theme') { S.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; save(); return render(); }
  if (d.act === 'undo') { const u = $('#toast')._undo; if (u) { S = u; $('#toast').classList.remove('on'); commit(); } return; }
  if (d.act === 'hideSteps') { delete S.firstRun; save(); return render(); }
  if (d.act === 'clearSample' || (d.act === 'startAgain' && armed)) {
    const prev = clone(S), theme = S.theme; armed = false;
    S = clone(DEFAULT_STATE); S.theme = theme; viewIdx = null; recalc(); save();
    if (d.act === 'clearSample') return startWizard();
    location.hash = '#home'; render(); return toast('Everything deleted', prev, 6000);
  }
  if (d.act === 'startAgain') { armed = true; render(); setTimeout(() => { if (armed) { armed = false; render(); } }, 5000); return; }
  if (d.act === 'toggleSimple') { S.simple = !t.checked; return commit(); }
  if (d.act === 'prev') { viewIdx = Math.max(0, viewIdx - 1); return render(); }
  if (d.act === 'next') { viewIdx = Math.min(rows.length - 1, viewIdx + 1); return render(); }
  if (d.act === 'checkin') { logMode = 'spend'; spendType = 'everyday'; logEdit = null; location.hash = '#log'; return render(); }
  if (d.mode) { logMode = d.mode; return render(); }
  if (d.stype) { spendType = d.stype; return render(); }
  if (d.kind) { logKind = d.kind; if (logKind.startsWith('debt:')) logDir = 'in'; else if (logDir === 'value' && logKind !== 'invest') logDir = 'in'; return render(); }
  if (d.dir) { logDir = d.dir; return render(); }
  if (d.act === 'cancelEdit') { logEdit = null; return render(); }
  if (d.leftover) {
    const lo = leftoverDue(); if (!lo) return;
    const prev = clone(S), [kind, ref] = d.leftover.split(':');
    S.leftover[lo.r.key] = { to: d.leftover, amt: lo.left };
    if (kind !== 'keep') S.logs.push({ id: uid('l'), kind, ref, goal: kind === 'goal' ? ref : null, dir: 'in', amt: lo.left, date: todayIso(), note: 'Left over from last pay period' });
    return commit(kind === 'keep' ? 'Kept as a buffer' : `Moved ${gbp(lo.left)}`, prev);
  }
  if (d.act === 'saveSpend') {
    const amt = +$('#fAmt').value, date = $('#fDate').value;
    if (!(amt > 0) || !date) { toast('Enter an amount and a date.'); return $('#fAmt').focus(); }
    const prev = clone(S);
    const entry = { type: spendType, amt, date, reason: spendType === 'oneoff' ? ($('#fReason').value || '').trim() : '', pot: spendType === 'oneoff' ? $('#fPot').value || null : null };
    if (logEdit && logEdit.type === 'spend') Object.assign(S.spend.find(s => s.id === logEdit.id), entry); else S.spend.push({ id: uid('s'), ...entry });
    const was = logEdit; logEdit = null;
    return commit(was ? 'Entry updated' : `Added ${gbp(amt)} spending`, prev);
  }
  if (d.act === 'saveLog') {
    const amt = +$('#fAmt').value, date = $('#fDate').value;
    if (!(amt > 0) || !date) { toast('Enter an amount and a date.'); return $('#fAmt').focus(); }
    const prev = clone(S);
    if (logDir === 'value') {
      if (logEdit && logEdit.type === 'value') Object.assign(S.investValues.find(v => v.id === logEdit.id), { value: amt, date });
      else S.investValues.push({ id: uid('v'), date, value: amt });
    } else {
      const [kind, ref] = logKind.includes(':') ? logKind.split(':') : [logKind, null];
      const entry = { kind, ref, goal: kind === 'goal' ? ref : null, dir: logDir === 'out' ? 'out' : 'in', amt, date, note: ($('#fNote')?.value || '').trim() };
      if (logEdit && logEdit.type === 'log') Object.assign(S.logs.find(l => l.id === logEdit.id), entry);
      else S.logs.push({ id: uid('l'), ...entry });
    }
    const was = logEdit; logEdit = null;
    return commit(was ? 'Entry updated' : `Logged ${gbp(amt)}`, prev);
  }
  if (d.edit) { const l = S.logs.find(x => x.id === d.edit); logEdit = { ...l, type: 'log' }; logMode = 'pay'; logKind = l.kind === 'invest' ? 'invest' : l.kind + ':' + (l.ref || l.goal); logDir = l.dir; render(); return scrollTo(0, 0); }
  if (d.editSpend) { const s = S.spend.find(x => x.id === d.editSpend); logEdit = { ...s, type: 'spend' }; logMode = 'spend'; spendType = s.type || 'everyday'; render(); return scrollTo(0, 0); }
  if (d.editValue) { const v = S.investValues.find(x => x.id === d.editValue); logEdit = { ...v, type: 'value' }; logMode = 'pay'; logKind = 'invest'; logDir = 'value'; render(); return scrollTo(0, 0); }
  if (d.del) { const prev = clone(S); S.logs = S.logs.filter(l => l.id !== d.del); return commit('Entry deleted', prev); }
  if (d.delSpend) { const prev = clone(S); S.spend = S.spend.filter(s => s.id !== d.delSpend); return commit('Entry deleted', prev); }
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
  if (d.delgoal) { const prev = clone(S); S.goals = S.goals.filter(g => g.id !== d.delgoal); S.logs = S.logs.filter(l => (l.goal || (l.kind === 'goal' && l.ref)) !== d.delgoal); return commit('Goal and its payments deleted', prev); }
  if (d.loggoal) { logMode = 'pay'; logKind = 'goal:' + d.loggoal; logDir = 'in'; logEdit = null; location.hash = '#log'; return; }
  if (d.addrow) {
    const n = d.addrow, row = ROW_BLANKS[n]();
    S[n].push({ id: uid(n[0]), ...row }); save(); recalc(); return render();
  }
  if (d.delrow) {
    const [n, i] = d.delrow.split(':'), it = S[n][+i];
    if (n === 'pots' && it.kind === 'ef' && S.pots.filter(p => p.kind === 'ef').length === 1 && !confirmDelete()) return;
    const prev = clone(S); S[n].splice(+i, 1);
    if (n === 'pots' && S.spareTo === it.id) S.spareTo = (S.pots.find(p => p.kind === 'savings') || {}).id || 'spending';
    return commit('Removed', prev);
  }
  if (d.act === 'addOv') { const nx = rows[Math.min(rows.length - 1, cur + 1)]; if (!S.paydayOverrides[nx.key]) S.paydayOverrides[nx.key] = nx.def; return commit(); }
  if (d.delov) { const prev = clone(S); delete S.paydayOverrides[d.delov]; return commit('Payday reset', prev); }
  if (d.act === 'export' || d.act === 'backup') {
    const stamp = todayIso();
    const file = d.act === 'export' ? { filename: `Stratrix_${stamp}.xlsx`, data: XL.build(exportSheets()), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } : { filename: `Stratrix_backup_${stamp}.json`, data: JSON.stringify(S, null, 1), type: 'application/json' };
    const url = URL.createObjectURL(new Blob([file.data], { type: file.type }));
    const a = document.createElement('a'); a.href = url; a.download = file.filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (d.act === 'backup') { S.lastBackup = todayIso(); save(); render(); }
    toast('File ready');
  }
});
const confirmDelete = () => true;   // removing the only emergency fund is allowed; the undo in the toast brings it back
addEventListener('hashchange', () => { if (route() !== 'log') logEdit = null; viewIdx = route() === 'payday' ? viewIdx : cur; render(); });
try { const th = localStorage.getItem(THEME_KEY); if (th) S.theme = th; } catch (e) { }
document.documentElement.dataset.theme = resolvedTheme();
window.stratrixExportBytes = () => Array.from(XL.build(exportSheets()));
window.__stratrix = { get S() { return S; }, get rows() { return rows; } };   // for testing in the browser console
connect();
}
