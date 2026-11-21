// ---------- Money engine: the same rules as the Salary Tracker workbook ----------
// Dates are ISO strings 'YYYY-MM-DD'; months are 'YYYY-MM'. All maths in UTC.
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d || 1)); };
const iso = d => d.toISOString().slice(0, 10);
const ym = s => s.slice(0, 7);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const addMonths = (s, n) => { const d = D(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
const monthsBetween = (a, b) => { const x = D(a), y = D(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); };
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const up2 = x => Math.ceil(r2(x * 100) - 1e-9) / 100;   // ROUNDUP(x,2)

// UK (England & Wales) bank holidays, standard rules with weekend substitutes
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, da));
}
const HOLS = new Set();
for (let y = 2025; y <= 2032; y++) {
  const out = [];
  const sub = d => { while (d.getUTCDay() % 6 === 0 || out.includes(iso(d))) d = addDays(d, 1); out.push(iso(d)); };
  const firstMon = m => { let d = new Date(Date.UTC(y, m, 1)); while (d.getUTCDay() !== 1) d = addDays(d, 1); return iso(d); };
  const lastMon = m => { let d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== 1) d = addDays(d, -1); return iso(d); };
  sub(new Date(Date.UTC(y, 0, 1)));
  const e = easter(y);
  out.push(iso(addDays(e, -2)), iso(addDays(e, 1)), firstMon(4), lastMon(4), lastMon(7));
  sub(new Date(Date.UTC(y, 11, 25))); sub(new Date(Date.UTC(y, 11, 26)));
  out.forEach(x => HOLS.add(x));
}
const isWork = d => d.getUTCDay() % 6 !== 0 && !HOLS.has(iso(d));
const onOrNextWork = d => { while (!isWork(d)) d = addDays(d, 1); return d; };
const lastWorkday = month => { const d0 = D(month); let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0)); while (!isWork(d)) d = addDays(d, -1); return iso(d); };

// effective-dated tables: [{from:'YYYY-MM', amt}] -> amount for month
const eff = (rows, month) => {
  let best = null;
  for (const r of rows || []) if (r.from && r.amt !== '' && r.amt != null && r.from <= ym(month) && (!best || r.from > best.from)) best = r;
  return best ? Number(best.amt) : 0;
};

// DD occurrences between [from, to)
function ddDates(dd, from, to) {
  if (!dd.active || !dd.amt) return [];
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
const jointMonthly = j => !j.active ? 0 : j.freq === 'weekly' ? j.amt * 52 / 12 : j.freq === 'annual' ? j.amt / 12 : Number(j.amt);

// money logged against a kind between dates [from, to)
function logged(S, kind, from, to, goalId) {
  let t = 0;
  for (const l of S.logs) {
    if (l.kind !== kind || (goalId && l.goal !== goalId)) continue;
    if (from && l.date < from) continue;
    if (to && l.date >= to) continue;
    t += (l.dir === 'out' ? -1 : 1) * Number(l.amt || 0);
  }
  return r2(t);
}

const PLAN_MONTHS = 32;

function plan(S, todayIso) {
  const today = todayIso || iso(new Date());
  const rows = [];
  for (let k = 0; k < PLAN_MONTHS; k++) {
    const A = addMonths(S.planStart, k);
    const def = lastWorkday(A);
    const pay = (S.paydayOverrides || {})[ym(A)] || def;
    rows.push({ A, def, D: pay });
  }
  rows.forEach((r, k) => {
    r.E = k < rows.length - 1 ? rows[k + 1].D : lastWorkday(addMonths(r.A, 1));
    r.days = Math.round((D(r.E) - D(r.D)) / 864e5);
    r.status = today >= r.E ? 'Closed' : today >= r.D ? 'Current' : 'Upcoming';
  });
  const c = S.card, j = S.jess;
  const promoMonth = ym(c.promoEnd) + '-01';
  const cardTarget = c.clearMonths ? [addMonths(S.planStart, c.clearMonths - 1), promoMonth].sort()[0] : promoMonth;
  const jessEnd = addMonths(j.start + '-01', j.months - 1);
  const sinking = r2(S.sinking.filter(x => x.active).reduce((a, x) => a + Number(x.annual || 0) / 12, 0));
  const joint = S.joint.reduce((a, x) => a + jointMonthly(x), 0);
  const cur = currentIndex(rows, today);
  const goalsNeed = goalNeeds(S, rows, cur);
  rows.forEach((r, k) => {
    const p = rows[k - 1];
    const closed = r.status === 'Closed';
    r.H = S.actualPay[ym(r.A)] != null && S.actualPay[ym(r.A)] !== '' ? Number(S.actualPay[ym(r.A)]) : eff(S.salary, r.A);
    r.I = r2(S.dds.reduce((a, dd) => a + ddDates(dd, r.D, r.E).length * Number(dd.amt), 0));
    r.J = joint;
    if (!p) {
      r.T = Math.max(0, r2(c.balance - logged(S, 'card', c.asAt, r.D)));
      r.U = Math.max(0, r2(j.owed - logged(S, 'jess', j.asAt, r.D)));
      r.V = r2(S.pots.ef.opening + logged(S, 'ef', S.pots.ef.asAt, r.D));
    } else {
      r.T = Math.max(0, r2(p.T - (p.status === 'Closed' ? p.actCard : p.K)));
      r.U = Math.max(0, r2(p.U - (p.status === 'Closed' ? p.actJess : p.L)));
      r.V = r2(p.V + (p.status === 'Closed' ? p.actEf : p.M));
    }
    const ml = monthsBetween(r.A, cardTarget) + 1;
    r.pace = r.T <= 0 ? 0 : ml <= 0 ? r.T : Math.min(r.T, Math.max(c.min, up2(r.T / ml)));
    r.K = r.T <= 0 ? 0 : (Number(c.whileJess) > 0 && r.U > 0) ? Math.min(r.T, Math.max(c.min, Number(c.whileJess))) : r.pace;
    r.O = sinking;
    const avail = r.H - r.I - r.J - r.K - r.O;
    const jl = monthsBetween(r.A, jessEnd) + 1;
    r.L = (r.U <= 0 || ym(r.A) < j.start) ? 0 :
      Math.max(0, Math.min(r.U, avail, jl <= 0 ? r.U : Math.max(up2(j.owed / j.months), up2(r.U / jl)) + Math.max(0, r.pace - r.K)));
    r.L = r2(r.L);
    r.M = r2(Math.max(0, Math.min(avail - r.L, S.efMonthly, S.efTarget - r.V)));
    r.actCard = logged(S, 'card', r.D, r.E); r.actJess = logged(S, 'jess', r.D, r.E); r.actEf = logged(S, 'ef', r.D, r.E);
    r.actGoals = logged(S, 'goal', r.D, r.E);
    r.N = closed ? r.actGoals : r2(goalsNeed.filter(g => g.by >= r.A).reduce((a, g) => a + g.need, 0));
    r.P = r2(r.H - r.I - r.J - r.K - r.L - r.M - r.N - r.O);
    r.Q = eff(S.budget, r.A);
    r.INV = eff(S.investPlan, r.A);
    r.R = S.spareTo === 'Spending' ? Math.max(0, r2(r.P - r.Q - r.INV)) : 0;
    r.S = r2(r.P - r.Q - r.R - r.INV);
    r.weekly = r.days > 0 ? (r.Q + r.R) / r.days * 7 : 0;
    r.toStarling = r2(r.H - r.I - r.K);
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
    const saved = logged(S, 'goal', null, null, g.id);
    const before = logged(S, 'goal', null, r.D, g.id);
    const by = g.by ? g.by + '-01' : null;
    let need = 0;
    if (g.active !== false && g.target > 0 && by && before < g.target) {
      const ml = monthsBetween(r.A, by) + 1;
      need = ml <= 0 ? g.target - before : up2((g.target - before) / ml);
    }
    return { ...g, saved, before, need: r2(need), by: by || '0000-00-00', paidNow: r2(saved - before) };
  });
}

// balances as of now
function balances(S) {
  const inv = S.investments;
  const lastVal = [...S.investValues].sort((a, b) => a.date < b.date ? -1 : 1).pop();
  const netIn = logged(S, 'invest', inv.asAt, null);
  const invValue = lastVal ? r2(lastVal.value + logged(S, 'invest', addDays(D(lastVal.date), 1).toISOString().slice(0, 10), null)) : r2(inv.opening + netIn);
  return {
    card: Math.max(0, r2(S.card.balance - logged(S, 'card', S.card.asAt, null))),
    jess: Math.max(0, r2(S.jess.owed - logged(S, 'jess', S.jess.asAt, null))),
    ef: r2(S.pots.ef.opening + logged(S, 'ef', S.pots.ef.asAt, null)),
    savings: r2(S.pots.savings.opening + logged(S, 'savings', S.pots.savings.asAt, null)),
    sinking: r2(S.pots.sinking.opening + logged(S, 'sinking', S.pots.sinking.asAt, null)),
    undecided: r2(S.pots.undecided.opening + logged(S, 'undecided', S.pots.undecided.asAt, null)),
    invValue, invPaid: r2(inv.opening + netIn), invGrowth: r2(invValue - inv.opening - netIn),
  };
}

if (typeof module !== 'undefined') module.exports = { plan, balances, goalNeeds, currentIndex, ddDates, HOLS, lastWorkday, eff, addMonths, monthsBetween, logged };
