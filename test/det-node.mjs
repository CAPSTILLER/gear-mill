// Node headless determinism test: bundles src/main.ts with a tiny DOM stub and replays a seed + input log.
import { build } from 'esbuild';
import { readFileSync } from 'fs';
const out = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'esm', define: { 'import.meta.env.DEV': 'true' } });
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? { setProperty() {} } : k === 'getContext' ? () => ctx2d : k === 'getBoundingClientRect' ? () => ({ left: 0, top: 0 }) : k === 'appendChild' || k === 'addEventListener' ? () => {} : k === 'textContent' || k === 'innerHTML' ? '' : el(), set: () => true, apply: () => el() });
const ctx2d = new Proxy({}, { get: (t, k) => k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
globalThis.window = globalThis; globalThis.innerWidth = 412; globalThis.innerHeight = 860; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.document = { getElementById: () => el(), createElement: () => el(), querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const file = process.argv[2] || 'test/det-fixture.json';
const { seed, ticks, log } = JSON.parse(readFileSync(file, 'utf8'));
const expected = JSON.parse(readFileSync('test/det-expected.json', 'utf8'))[file];
const a = window.__det.replay(seed, log, ticks), b = window.__det.replay(seed, log, ticks);
const ok = a.hash === b.hash && a.score === b.score && (!expected || a.hash === expected);
console.log(JSON.stringify({ file, runA: a, runB: b, expected, ok }));
if (!ok) process.exit(1);
