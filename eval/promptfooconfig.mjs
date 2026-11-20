const all = [
  'valid',
  'wrong_color',
  'corrected',
  'overlay',
  'integral_logo',
  'ambiguous_mark',
  'secondary',
  'refund',
  'sibling',
  'explicit',
  'silent',
  'merchant',
  'stale',
  'unauthorized',
  'detached',
  'outage',
  'closed',
];
const live = [
  'valid',
  'wrong_color',
  'corrected',
  'overlay',
  'integral_logo',
  'ambiguous_mark',
  'secondary',
  'refund',
  'sibling',
  'explicit',
  'silent',
  'merchant',
  'closed',
];
const cases =
  process.env.ONSITE_EVAL_MODE === 'flawed'
    ? ['silent']
    : process.env.ONSITE_EVAL_MODE === 'live'
      ? live
      : all;
export default {
  description: 'US seller workflow release',
  prompts: ['Evaluate {{scenario}}'],
  providers: ['file://provider.mjs'],
  defaultTest: { assert: [{ type: 'javascript', value: 'file://assert.cjs' }] },
  tests: cases.map((scenario) => ({ vars: { scenario } })),
};
