const { check } = require('./runtime.cjs');

function gate({ config, report, fixture }) {
  const required = condition => check(condition, 'Record an explicit user selection or waiver for this project. Fixture decisions never apply to live work.', 'DIRECTION_EVIDENCE');
  const { kind, scope, evidence, direction } = config;
  required(evidence && typeof evidence.quote === 'string' && typeof evidence.turn === 'string' && evidence.turn.trim());
  required(fixture ? scope === 'fixture' && evidence.source === 'fixture' : scope === 'project' && evidence.source === 'user');
  const quote = evidence.quote.normalize('NFKC').trim().replace(/[。.!！]$/u, '');
  if (kind === 'selection') {
    required(typeof direction === 'string' && /^[ABC]$/u.test(direction));
    const match = quote.match(/^(?:選(?:擇)?\s*(?:方向\s*)?|就用\s*(?:方向\s*)?|(?:I choose|Use|Choose)\s+(?:direction\s+)?)([ABC])(?:\s*(?:稿|版|方案))?$/iu);
    required(match && match[1].toUpperCase() === direction);
  } else {
    required(kind === 'waiver' && /^(?:(?:這次|本次)[，,\s]*)?(?:跳過三稿(?:選擇)?|不用出三稿|直接做正式稿)$|^skip the three drafts(?: for this (?:project|test case))?$/iu.test(quote));
  }
  report.checks = { scope, kind, direction: direction || null, turn: evidence.turn, verifies: 'record format and an unambiguous choice; not user identity or authorization' };
}

module.exports = { gate };
