// Blank starting set-up: no personal figures in the code.
const DEFAULT_STATE = (() => {
  const d = new Date(), m = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  const today = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
  return {
    v: 3, theme: null, blank: true, planStart: m, region: 'ew', pay: { freq: 'last', day: 28, anchor: today },
    simple: true, accounts: [], buffer: 0, spareTo: 'savings',
    salary: [], budget: [], investPlan: [], paydayOverrides: {}, actualPay: {},
    debts: [],
    pots: [
      { id: 'ef', name: 'Emergency fund', kind: 'ef', target: 1000, each: 0, opening: 0, asAt: today },
      { id: 'savings', name: 'Savings', kind: 'savings', target: null, each: 0, opening: 0, asAt: today },
      { id: 'yearly', name: 'Yearly costs', kind: 'yearly', target: null, each: 0, opening: 0, asAt: today },
    ],
    investments: { opening: 0, asAt: today, target: null },
    dds: [], joint: [], sinking: [], goals: [], logs: [], investValues: [], spend: [], leftover: {}, celebrated: {}, checks: {},
  };
})();
