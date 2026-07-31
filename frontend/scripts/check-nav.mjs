// scripts/check-nav.mjs — the sidebar and the shortcut table must agree.
//   node scripts/check-nav.mjs
//
// These two lists are maintained by hand in different files. Last time they
// drifted, four advertised shortcuts (G O / G P / G E / G X) did nothing: the
// sidebar rendered a hint from its own config while the handler list had no
// matching entry. A shortcut the UI promises and does not deliver is worse than
// no shortcut, so this runs in CI.
//
// It also catches the quieter failure: the same key bound to two routes, or a
// label that says one thing in the sidebar and another in the help modal.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sidebar   = readFileSync(join(root, 'src/components/Sidebar.jsx'), 'utf8');
const shortcuts = readFileSync(join(root, 'src/hooks/useGlobalShortcuts.js'), 'utf8');

let fail = 0;
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const ok  = (m) => console.log(`  ✅ ${m}`);

// Sidebar entries that advertise a shortcut: { to: '/x', ..., kbd: 'G D' }
const navItems = [...sidebar.matchAll(/\{\s*to:\s*'([^']+)'[^}]*?label:\s*'([^']+)'[^}]*?kbd:\s*'([^']+)'/g)]
  .map(([, path, label, kbd]) => ({ path, label, kbd: kbd.toLowerCase() }));

// Shortcut table entries: { keys: 'g d', path: '/', label: 'Dashboard' }
const routes = [...shortcuts.matchAll(/keys:\s*'([^']+)',\s*path:\s*'([^']+)',\s*label:\s*'([^']+)'/g)]
  .map(([, keys, path, label]) => ({ keys, path, label }));

console.log(`\nsidebar items with a hint: ${navItems.length} · shortcut routes: ${routes.length}\n`);
if (navItems.length === 0 || routes.length === 0) {
  console.error('Parsed nothing — the file shape changed. Fix this script before trusting it.\n');
  process.exit(1);
}

// 1. Every advertised hint must have a handler, bound to the same route.
for (const item of navItems) {
  const hit = routes.find(r => r.keys === item.kbd);
  if (!hit) { bad(`"${item.label}" advertises ${item.kbd.toUpperCase()} but no handler exists`); continue; }
  if (hit.path !== item.path) bad(`${item.kbd.toUpperCase()} goes to ${hit.path} but the sidebar links ${item.path}`);
  else if (hit.label !== item.label) bad(`${item.kbd.toUpperCase()} labelled "${hit.label}" in help, "${item.label}" in sidebar`);
}
if (!fail) ok('every sidebar hint has a matching handler, route and label');

// 2. No orphan handlers — a shortcut nothing tells the user about.
for (const r of routes) {
  if (!navItems.some(i => i.kbd === r.keys)) bad(`${r.keys.toUpperCase()} → ${r.path} is unreachable from the sidebar`);
}

// 3. No key bound twice.
const seen = new Map();
for (const r of routes) {
  if (seen.has(r.keys)) bad(`${r.keys.toUpperCase()} is bound to both ${seen.get(r.keys)} and ${r.path}`);
  seen.set(r.keys, r.path);
}
if (seen.size === routes.length) ok('no duplicate key bindings');

console.log(fail === 0 ? '\n✅ nav and shortcuts are in sync\n' : `\n❌ ${fail} problem(s)\n`);
process.exit(fail === 0 ? 0 : 1);
