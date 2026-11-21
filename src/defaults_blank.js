// Blank starting set-up for the installable version: no personal figures in the code.
const DEFAULT_STATE = (() => {
  const d = new Date(), m = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getFullYear() + 3, d.getMonth() + 1, 0)).toISOString().slice(0, 10);
  const today = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
  return {
    v: 2, theme: null, blank: true, planStart: m, buffer: 0, efTarget: 1000, efMonthly: 0, spareTo: 'Savings',
    salary: [], budget: [], investPlan: [], paydayOverrides: {}, actualPay: {},
    card: { balance: 0, asAt: today, promoEnd: end, min: 0, whileJess: null, clearMonths: null },
    jess: { owed: 0, asAt: today, months: 12, start: m.slice(0, 7) },
    pots: { ef: { opening: 0, asAt: today }, savings: { opening: 0, asAt: today, target: null }, sinking: { opening: 0, asAt: today }, undecided: { opening: 0, asAt: today } },
    investments: { opening: 0, asAt: today, target: null, growth: 0 },
    dds: [], joint: [], sinking: [], goals: [], logs: [], investValues: [], celebrated: {}, checks: {},
  };
})();
