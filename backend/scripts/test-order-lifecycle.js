// scripts/test-order-lifecycle.js — pure order state machine. Offline.
//   node scripts/test-order-lifecycle.js
'use strict';
const lc = require('../src/engine/orderLifecycle');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('normalize');
ok('"open" → PENDING', lc.normalize('open') === 'PENDING');
ok('"trigger pending" → PENDING', lc.normalize('trigger pending') === 'PENDING');
ok('"complete" → COMPLETED', lc.normalize('complete') === 'COMPLETED');
ok('"filled" → COMPLETED', lc.normalize('filled') === 'COMPLETED');
ok('"partially filled" → PARTIAL', lc.normalize('partially filled') === 'PARTIAL');
ok('"rejected" → REJECTED', lc.normalize('rejected') === 'REJECTED');
ok('"cancelled" → CANCELLED', lc.normalize('cancelled') === 'CANCELLED');
ok('empty → NEW', lc.normalize('') === 'NEW');
ok('unknown → PENDING (never terminal)', lc.normalize('weird_status') === 'PENDING');

console.log('isTerminal / isOpen');
ok('COMPLETED terminal', lc.isTerminal('complete') && !lc.isOpen('complete'));
ok('PENDING open', lc.isOpen('open') && !lc.isTerminal('open'));
ok('PARTIAL open', lc.isOpen('partial'));

console.log('canTransition');
ok('PENDING → COMPLETED legal', lc.canTransition('open', 'complete'));
ok('PENDING → PARTIAL legal', lc.canTransition('pending', 'partial'));
ok('PARTIAL → COMPLETED legal', lc.canTransition('partial', 'complete'));
ok('same state is a no-op (legal)', lc.canTransition('complete', 'complete'));
ok('COMPLETED → PENDING ILLEGAL', !lc.canTransition('complete', 'open'));
ok('CANCELLED → COMPLETED ILLEGAL', !lc.canTransition('cancelled', 'complete'));
ok('REJECTED → anything ILLEGAL', !lc.canTransition('rejected', 'pending'));

console.log('transition()');
let t = lc.transition('PENDING', 'complete');
ok('PENDING→COMPLETED changed', t.state === 'COMPLETED' && t.changed && !t.illegal);
t = lc.transition('COMPLETED', 'open');
ok('COMPLETED→open flagged illegal, state held', t.state === 'COMPLETED' && !t.changed && t.illegal);
t = lc.transition('PENDING', 'pending');
ok('no-op unchanged', t.state === 'PENDING' && !t.changed && !t.illegal);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
