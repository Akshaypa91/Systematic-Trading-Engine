// scripts/test-corp-loader.js — offline test for the NSE subject parser.
//   node scripts/test-corp-loader.js
'use strict';
const { parsePurpose, parseDate, extractActions } = require('../src/data/corpActionLoader');

let pass = 0, fail = 0;
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
function ok(name, cond, extra = '') { cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name} ${extra}`)); }

console.log('parseDate');
ok('28-Oct-2024 -> 2024-10-28', parseDate('28-Oct-2024') === '2024-10-28');
ok('5-Jan-2023 -> 2023-01-05', parseDate('5-Jan-2023') === '2023-01-05');
ok('ISO passthrough', parseDate('2024-10-28') === '2024-10-28');
ok('garbage -> null', parseDate('n/a') === null);

console.log('parsePurpose — bonus');
let r = parsePurpose('Bonus 1:1');
ok('1:1 bonus factor 0.5', r && r.action_type === 'BONUS' && approx(r.factor, 0.5), JSON.stringify(r));
r = parsePurpose('Bonus issue 2 : 1');
ok('2:1 bonus factor 1/3', r && approx(r.factor, 1 / 3), JSON.stringify(r));

console.log('parsePurpose — split');
r = parsePurpose('Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share');
ok('split 10->2 factor 0.2', r && r.action_type === 'SPLIT' && approx(r.factor, 0.2), JSON.stringify(r));
r = parsePurpose('Face Value Split From Rs 10 To Rs 5');
ok('split 10->5 factor 0.5', r && approx(r.factor, 0.5), JSON.stringify(r));
r = parsePurpose('Stock Split 1:5');
ok('split 1:5 factor 0.2', r && r.action_type === 'SPLIT' && approx(r.factor, 0.2), JSON.stringify(r));

console.log('parsePurpose — ignored');
ok('dividend -> null', parsePurpose('Dividend - Rs 8 Per Share') === null);
ok('AGM -> null', parsePurpose('Annual General Meeting') === null);
ok('empty -> null', parsePurpose('') === null);

console.log('extractActions');
const rows = [
  { subject: 'Bonus 1:1', exDate: '28-Oct-2024' },
  { subject: 'Dividend - Rs 5', exDate: '10-Aug-2024' },   // dropped
  { subject: 'Face Value Split From Rs 10 To Rs 1', exDate: '15-Jul-2020' },
];
const acts = extractActions(rows);
ok('keeps only split+bonus (2)', acts.length === 2, `got ${acts.length}`);
ok('bonus factor present', acts.some(a => a.action_type === 'BONUS' && approx(a.factor, 0.5)));
ok('split 10->1 factor 0.1', acts.some(a => a.action_type === 'SPLIT' && approx(a.factor, 0.1)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
