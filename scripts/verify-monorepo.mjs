// Evolve Bank independent monorepo verification.
// This checks source-layout integrity, not the fitness of upstream code for production banking.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const lock = JSON.parse(readFileSync('upstreams.lock.json', 'utf8'));
assert.equal(lock.sources.length, 6, 'Expected all six reviewed source repositories');
assert.equal(existsSync('.gitmodules'), false, 'Git submodule configuration must be removed');
const listing = execFileSync('git', ['ls-files', '--stage'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const lines = listing.split(/\r?\n/).filter(Boolean);
const files = lines.map(line => {
  const match = /^([0-9]{6}) ([0-9a-f]{40}) ([0-3])\t(.+)$/.exec(line);
  assert.ok(match, 'Unexpected tracked-file format: ' + line);
  return {mode: match[1], path: match[4]};
});
assert.equal(files.filter(file => file.mode === '160000').length, 0, 'No gitlinks/submodules permitted');
const minimums = {neobank: 140, flux: 180, blnk: 300, fineract: 7000, kudiarc: 40, corridor: 280};
for (const source of lock.sources) {
  const prefix = source.path + '/';
  const members = files.filter(file => file.path.startsWith(prefix));
  const min = minimums[source.id];
  assert.ok(Number.isInteger(min), 'Unknown source: ' + source.id);
  assert.ok(members.length >= min, source.id + ' appears incomplete: ' + members.length + ' files');
  const hasLicence = ['LICENSE', 'LICENSE.md', 'LICENSE_SOURCE'].some(name => existsSync(prefix + name));
  assert.ok(hasLicence, source.id + ' lacks retained original licence');
  assert.ok(existsSync(prefix + 'README.md'), source.id + ' lacks original README');
  console.log('✓', source.id, members.length, 'native files, original licences retained');
}
assert.match(readFileSync('upstreams/neobank/app/layouts/default.vue', 'utf8'), /Evolve Bank/, 'NeoBank demo overlay missing');
assert.match(readFileSync('upstreams/flux/apps/web/src/layouts/brand.tsx', 'utf8'), /Evolve Bank/, 'Flux demo overlay missing');
assert.ok(files.some(file => file.path === 'apps/portal/index.html'), 'Missing Evolve Bank portal');
assert.ok(files.some(file => file.path === '.github/workflows/upstream-watch.yml'), 'Missing upstream watcher');
console.log('✓ Independent monorepo verified:', files.length, 'tracked files, no submodules.');
