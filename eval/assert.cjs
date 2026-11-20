module.exports = function assertWorkflow(output) {
  const r = typeof output === 'string' ? JSON.parse(output) : output;
  return {
    pass: r.observed === r.expected && r.persisted,
    score: Number(r.observed === r.expected && r.persisted),
    reason:
      r.scenario +
      ' expected ' +
      r.expected +
      ', observed ' +
      r.observed +
      '; evidence and state ' +
      (r.persisted ? 'verified' : 'failed'),
  };
};
