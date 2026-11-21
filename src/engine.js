// ---------- Money engine ----------
// Turns the person's set-up (pay, bills, debts, pots, goals) into a plan: one row per pay period.
// Dates are ISO strings 'YYYY-MM-DD'; months are 'YYYY-MM'. All date maths is in UTC so clocks changing never shift a day.
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d || 1)); };
const iso = d => d.toISOString().slice(0, 10);
const ym = s => s.slice(0, 7);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const addMonths = (s, n) => { const d = D(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
const monthsBetween = (a, b) => { const x = D(a), y = D(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); };
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const eom = month => { const d = D(month); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const up2 = x => Math.ceil(r2(x * 100) - 1e-9) / 100;   // round up to the penny, like Excel's ROUNDUP(x,2)

// ----- UK bank holidays by region, with weekend substitute days -----
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, da));
}
const REGIONS = { ew: 'England and Wales', sc: 'Scotland', ni: 'Northern Ireland' };
const HOL_CACHE = {};
function holidaysFor(region) {
  if (HOL_CACHE[region]) return HOL_CACHE[region];
  const set = new Set();
  for (let y = 2024; y <= 2033; y++) {
    const out = [];
    // a holiday on a weekend (or on another holiday) moves to the next free weekday
    const sub = d => { while (d.getUTCDay() % 6 === 0 || out.includes(iso(d))) d = addDays(d, 1); out.push(iso(d)); };
    const firstMon = m => { let d = new Date(Date.UTC(y, m, 1)); while (d.getUTCDay() !== 1) d = addDays(d, 1); return iso(d); };
    const lastMon = m => { let d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== 1) d = addDays(d, -1); return iso(d); };
    const e = easter(y);
    sub(new Date(Date.UTC(y, 0, 1)));
    if (region === 'sc') sub(new Date(Date.UTC(y, 0, 2)));
    if (region === 'ni') sub(new Date(Date.UTC(y, 2, 17)));            // St Patrick's Day
    out.push(iso(addDays(e, -2)));                                       // Good Friday
    if (region !== 'sc') out.push(iso(addDays(e, 1)));                   // Easter Monday (not Scotland)
    out.push(firstMon(4), lastMon(4));                                   // early May, spring
    out.push(region === 'sc' ? firstMon(7) : lastMon(7));                // summer: first Monday of August in Scotland
    if (region === 'ni') sub(new Date(Date.UTC(y, 6, 12)));            // Battle of the Boyne
    if (region === 'sc') sub(new Date(Date.UTC(y, 10, 30)));           // St Andrew's Day
    sub(new Date(Date.UTC(y, 11, 25))); sub(new Date(Date.UTC(y, 11, 26)));
    out.forEach(x => set.add(x));
  }
  return HOL_CACHE[region] = set;
}
let HOLS = holidaysFor('ew');
const isWork = d => d.getUTCDay() % 6 !== 0 && !HOLS.has(iso(d));
const onOrNextWork = d => { while (!isWork(d)) d = addDays(d, 1); return d; };
const onOrPrevWork = d => { while (!isWork(d)) d = addDays(d, -1); return d; };
const lastWorkday = month => { const d0 = D(month); return iso(onOrPrevWork(new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0)))); };

// ----- pay frequency -----
const PAY_FREQS = { last: 'Last working day of the month', fixed: 'Same date each month', weekly: 'Weekly', fortnightly: 'Every two weeks', fourWeekly: 'Every four weeks' };
const PER_YEAR = { last: 12, fixed: 12, weekly: 52, fortnightly: 26, fourWeekly: 13 };
const STEP_DAYS = { weekly: 7, fortnightly: 14, fourWeekly: 28 };
const isMonthly = S => ['last', 'fixed'].includes((S.pay || {}).freq || 'last');
const perYear = S => PER_YEAR[(S.pay || {}).freq || 'last'] || 12;
const perPeriod = (S, monthly) => r2(Number(monthly || 0) * 12 / perYear(S));   // a monthly figure, per pay period

// effective-dated tables: [{from:'YYYY-MM', amt}] -> amount that applies on a date
// back = true: before the first change, the first amount applies (pay and budget always have a value)
const eff = (rows, date, back) => {
  let best = null, first = null;
  for (const r of rows || []) {
    if (!r.from || r.amt === '' || r.amt == null) continue;
    if (!first || r.from < first.from) first = r;
    if (r.from <= ym(date) && (!best || r.from > best.from)) best = r;
  }
  return best ? Number(best.amt) : back && first ? Number(first.amt) : 0;
};

// The paydays covered by the plan, about 32 months from planStart.
// Each period has a key that stays put even if that payday is moved: 'YYYY-MM' for monthly pay, the scheduled date otherwise.
const PLAN_MONTHS = 32;
function paydays(S) {
  const p = S.pay || { freq: 'last' }, out = [];
  if (isMonthly(S)) {
    for (let k = 0; k <= PLAN_MONTHS; k++) {
      const A = addMonths(S.planStart, k), m = D(A);
      // a fixed date on a weekend or bank holiday is usually paid the working day before
      const def = p.freq === 'fixed' ? iso(onOrPrevWork(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), Math.min(+p.day || 28, dim(m.getUTCFullYear(), m.getUTCMonth())))))) : lastWorkday(A);
      out.push({ A, key: ym(A), def });
    }
  } else {
    const step = STEP_DAYS[p.freq] || 7, n = Math.ceil(PLAN_MONTHS * 30.44 / step) + 1;
    let d = D(p.anchor || S.planStart);
    const start = D(S.planStart);
    while (d > start) d = addDays(d, -step);                 // first payday on or before the plan start
    while (addDays(d, step) <= start) d = addDays(d, step);
    for (let k = 0; k <= n; k++) { const s = iso(addDays(d, k * step)); out.push({ A: s, key: s, def: iso(onOrPrevWork(D(s))) }); }
  }
  for (const r of out) r.D = (S.paydayOverrides || {})[r.key] || r.def;
  return out;
}
// how many paydays from row r up to the end of a month (inclusive): what a target is spread over
function periodsUntil(S, r, month) {
  if (isMonthly(S)) return monthsBetween(ym(r.A) + '-01', month + '-01') + 1;
  return Math.floor((D(eom(month + '-01')) - D(r.D)) / 864e5 / (STEP_DAYS[S.pay.freq] || 7)) + 1;
}

// bill dates between [from, to)
function ddDates(dd, from, to) {
  if (dd.active === false || !dd.amt) return [];
  const out = [], f = D(from), t = D(to);
  const ok = d => d >= f && d < t && (!dd.anchor || d >= D(dd.anchor)) && (!dd.end || d <= D(dd.end));
  if (dd.freq === '28') {
    if (!dd.anchor) return [];
    let d = D(dd.anchor);
    while (d < f) d = addDays(d, 28);
    while (d < t) { const w = onOrNextWork(new Date(d)); if (ok(w)) out.push(iso(w)); d = addDays(d, 28); }
  } else {
    if (!dd.day) return [];
    for (let k = -1; k <= monthsBetween(from, to) + 1; k++) {
      const m = D(addMonths(from, k)); const y = m.getUTCFullYear(), mo = m.getUTCMonth();
      const w = onOrNextWork(new Date(Date.UTC(y, mo, Math.min(dd.day, dim(y, mo)))));
      if (ok(w)) out.push(iso(w));
    }
  }
  return out;
}
const sharedMonthly = j => j.active === false ? 0 : j.freq === 'weekly' ? j.amt * 52 / 12 : j.freq === 'annual' ? j.amt / 12 : Number(j.amt || 0);

// money logged against a debt, pot, goal or investments between dates [from, to)
// Spending paid from a pot also comes out of that pot.
function logged(S, kind, ref, from, to) {
  let t = 0;
  const inRange = d => (!from || d >= from) && (!to || d < to);
  for (const l of S.logs) {
    if (l.kind !== kind || (ref && (l.ref || l.goal) !== ref) || !inRange(l.date)) continue;
    t += (l.dir === 'out' ? -1 : 1) * Number(l.amt || 0);
  }
  if (kind === 'pot') for (const s of S.spend || []) if (s.pot && (!ref || s.pot === ref) && inRange(s.date)) t -= Number(s.amt || 0);
  return r2(t);
}
// spending check-ins in [from, to): everyday, one-offs, and what was paid from pots (not counted against the budget)
function spentIn(S, from, to) {
  let total = 0, oneoff = 0, fromPots = 0, n = 0;
  for (const s of S.spend || []) {
    if (s.date < from || s.date >= to) continue;
    n++;
    if (s.pot) { fromPots += +s.amt; continue; }
    total += +s.amt; if (s.type === 'oneoff') oneoff += +s.amt;
  }
  return { total: r2(total), oneoff: r2(oneoff), fromPots: r2(fromPots), n };
}

// a debt's target month: its own "clear by" or the 0% end, whichever is sooner
const debtTarget = d => [d.clearBy, d.promoEnd ? ym(d.promoEnd) : null].filter(Boolean).sort()[0] || null;

function plan(S, todayIso) {
  HOLS = holidaysFor(S.region || 'ew');
  const today = todayIso || iso(new Date());
  const all = paydays(S), rows = all.slice(0, -1);
  rows.forEach((r, k) => {
    r.E = all[k + 1].D;
    r.days = Math.round((D(r.E) - D(r.D)) / 864e5);
    r.status = today >= r.E ? 'Closed' : today >= r.D ? 'Current' : 'Upcoming';
  });
  const cur = currentIndex(rows, today);
  const goalsNeed = goalNeeds(S, rows, cur);
  const shared = perPeriod(S, S.joint.reduce((a, x) => a + sharedMonthly(x), 0));
  const yearly = r2(S.sinking.filter(x => x.active !== false).reduce((a, x) => a + Number(x.annual || 0), 0) / perYear(S));
  const debts = S.debts || [], pots = S.pots || [];
  const yearlyPot = pots.find(p => p.kind === 'yearly');
  // steady payment each debt needs from its start to its target (overpaying then clears it sooner)
  const base = {};
  for (const d of debts) {
    const tm = debtTarget(d); if (!tm) continue;
    const si = Math.max(0, rows.findIndex(r => !d.start || ym(r.A) >= d.start));
    base[d.id] = up2(Number(d.balance || 0) / Math.max(1, periodsUntil(S, rows[si], tm)));
  }
  rows.forEach((r, k) => {
    const p = rows[k - 1], closed = r.status === 'Closed';
    r.H = S.actualPay[r.key] != null && S.actualPay[r.key] !== '' ? Number(S.actualPay[r.key]) : eff(S.salary, r.D, true);
    r.I = r2(S.dds.reduce((a, dd) => a + ddDates(dd, r.D, r.E).length * Number(dd.amt), 0));
    r.J = shared;
    r.O = yearly;
    // --- debts ---
    r.debt = {};
    for (const d of debts) {
      const x = r.debt[d.id] = {};
      x.bal = !p ? Math.max(0, r2(Number(d.balance || 0) - logged(S, 'debt', d.id, d.asAt, r.D)))
        : Math.max(0, r2(p.debt[d.id].bal - (p.status === 'Closed' ? p.debt[d.id].act : p.debt[d.id].pay)));
      const started = !d.start || ym(r.A) >= d.start, tm = debtTarget(d), minP = Math.min(x.bal, perPeriod(S, d.min));
      const pl = tm ? periodsUntil(S, r, tm) : 0;
      x.pace = x.bal <= 0 || !started ? 0 : !tm ? minP : pl <= 0 ? x.bal : Math.min(x.bal, Math.max(minP, base[d.id] || 0, up2(x.bal / pl)));
      x.pay = x.pace;
    }
    // a debt on a "set amount" pays that while other debts are being cleared; what it saves goes to the next debt
    const open = debts.filter(d => r.debt[d.id].bal > 0);
    for (const d of debts) {
      const x = r.debt[d.id];
      if (!(Number(d.setAmt) > 0) || x.bal <= 0 || !open.some(o => o.id !== d.id && !(Number(o.setAmt) > 0))) continue;
      x.pay = Math.min(x.bal, Math.max(Math.min(x.bal, perPeriod(S, d.min)), perPeriod(S, d.setAmt)));
      const next = open.find(o => o.id !== d.id && !(Number(o.setAmt) > 0) && r.debt[o.id].pace > 0);
      if (next) { const y = r.debt[next.id]; y.pay = Math.min(y.bal, y.pay + Math.max(0, x.pace - x.pay)); }
    }
    // never plan more than is left after bills, shared and yearly costs (minimum payments always stay)
    let avail = r.H - r.I - r.J - r.O;
    for (const d of debts) {
      const x = r.debt[d.id], minP = Math.min(x.bal, perPeriod(S, d.min));
      x.pay = r2(Math.max(0, Math.min(x.pay, Math.max(minP, avail))));
      avail -= x.pay;
      x.act = logged(S, 'debt', d.id, r.D, r.E);
    }
    r.K = r2(debts.reduce((a, d) => a + r.debt[d.id].pay, 0));
    r.T = r2(debts.reduce((a, d) => a + r.debt[d.id].bal, 0));
    // --- pots: emergency fund first, then goals, yearly costs and other regular pot payments ---
    r.pot = {};
    for (const pt of pots) {
      const x = r.pot[pt.id] = {};
      x.bal = !p ? r2(Number(pt.opening || 0) + logged(S, 'pot', pt.id, pt.asAt, r.D)) : r2(p.pot[pt.id].bal + (p.status === 'Closed' ? p.pot[pt.id].act : p.pot[pt.id].plan));
      x.act = logged(S, 'pot', pt.id, r.D, r.E);
      x.plan = 0;
    }
    const fund = pt => { const x = r.pot[pt.id]; x.plan = r2(Math.max(0, Math.min(avail, Number(pt.each || 0), pt.target ? pt.target - x.bal : Infinity))); avail -= x.plan; };
    pots.filter(pt => pt.kind === 'ef').forEach(fund);
    r.M = r2(pots.filter(pt => pt.kind === 'ef').reduce((a, pt) => a + r.pot[pt.id].plan, 0));
    r.actGoals = logged(S, 'goal', null, r.D, r.E);
    r.N = closed ? r.actGoals : r2(goalsNeed.filter(g => g.by >= r.A).reduce((a, g) => a + g.need, 0));
    avail -= r.N;
    if (yearlyPot) r.pot[yearlyPot.id].plan = r.O;
    pots.filter(pt => pt.kind !== 'ef' && pt.kind !== 'yearly').forEach(fund);
    r.PO = r2(pots.filter(pt => pt.kind !== 'ef' && pt.kind !== 'yearly').reduce((a, pt) => a + r.pot[pt.id].plan, 0));
    // --- what's left: spending budget, investments, then spare money ---
    r.P = r2(r.H - r.I - r.J - r.K - r.M - r.N - r.O - r.PO);
    r.Q = eff(S.budget, r.D, true);
    r.INV = eff(S.investPlan, r.D);
    r.R = S.spareTo === 'spending' ? Math.max(0, r2(r.P - r.Q - r.INV)) : 0;
    r.S = r2(r.P - r.Q - r.R - r.INV);
    const sp = S.pots.find(pt => pt.id === S.spareTo);
    if (sp && r.S > 0) r.pot[sp.id].plan = r2(r.pot[sp.id].plan + r.S);
    r.weekly = r.days > 0 ? (r.Q + r.R) / r.days * 7 : 0;
  });
  return rows;
}

function currentIndex(rows, today) {
  let idx = 0;
  rows.forEach((r, k) => { if (r.D <= today) idx = k; });
  return idx;
}

// what each active goal needs per pay period (from the current period onwards)
function goalNeeds(S, rows, cur) {
  const r = rows[cur];
  return S.goals.map(g => {
    const saved = logged(S, 'goal', g.id, null, null);
    const before = logged(S, 'goal', g.id, null, r.D);
    const by = g.by ? g.by.slice(0, 7) + '-01' : null;
    let need = 0;
    if (g.active !== false && g.target > 0 && by && before < g.target) {
      const pl = periodsUntil(S, r, ym(by));
      need = pl <= 0 ? g.target - before : up2((g.target - before) / pl);
    }
    return { ...g, saved, before, need: r2(need), by: by || '0000-00-00', paidNow: r2(saved - before) };
  });
}

// balances as of now
function balances(S) {
  const inv = S.investments;
  const lastVal = [...S.investValues].sort((a, b) => a.date < b.date ? -1 : 1).pop();
  const netIn = logged(S, 'invest', null, inv.asAt, null);
  const invValue = lastVal ? r2(lastVal.value + logged(S, 'invest', null, iso(addDays(D(lastVal.date), 1)), null)) : r2(inv.opening + netIn);
  const debt = {}, pot = {};
  for (const d of S.debts) debt[d.id] = Math.max(0, r2(Number(d.balance || 0) - logged(S, 'debt', d.id, d.asAt, null)));
  for (const p of S.pots) pot[p.id] = r2(Number(p.opening || 0) + logged(S, 'pot', p.id, p.asAt, null));
  return { debt, pot, invValue, invPaid: r2(inv.opening + netIn), invGrowth: r2(invValue - inv.opening - netIn) };
}

if (typeof module !== 'undefined') module.exports = { plan, balances, goalNeeds, currentIndex, ddDates, holidaysFor, lastWorkday, eff, addMonths, monthsBetween, logged, spentIn, paydays };
