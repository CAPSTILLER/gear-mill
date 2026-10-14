/// <reference types="vite/client" />
const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const N = 10, ANTE = 50, SPAWN = 0.5, POWER_HOLD = 15, REWARD = 10, WIN_BONUS = 100;
let W = 0, H = 0, cs = 0, ox = 0, oy = 0, rackY = 0, dpr = 1;
type Seat = { r: number; c: number; age: number; id: number; power: boolean; hold: number; ang: number; on: boolean; srcConn: boolean; earned: boolean; lvl: number; dir: number; jam: boolean };
type Gear = { id: number; x: number; y: number; vx: number; vy: number; ang: number; va: number; power: boolean; phase: 'rack' | 'fall'; dir: number; dropX: number; stuck: number; earned: boolean; dead?: boolean; skip?: string; skipT?: number };
type Mill = { r: number; c: number; upperDone: boolean; born: number; dir: number };
let pins: boolean[][], edge: Map<string, boolean>, seats: Map<string, Seat>, gears: Gear[], wms: Mill[];
let mill = { r: 0, c: 0 };
let postDir = new Map<string, number>(), jamLinks: [string, string][] = [], jamSides = new Set<string>(), postAng = 0;
type Spark = { x: number; y: number; vx: number; vy: number; t: number; col: string };
let sparks: Spark[] = [];
const SPARK_COLS = ['#ffffff', '#fff27a', '#ffd23a', '#ff9a1f'];
function emit(x: number, y: number, n: number) { for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), v = rnd(0.8, 3.5) * cs; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs, t: rnd(0.15, 0.45), col: SPARK_COLS[ri(0, 3)] }); } }
const HOLE_COST = 100, HOLE_TIME = 100, SWEEP_EVERY = 120, SWEEP_STEPS = 80;
let holeT = 0, sweepNext = SWEEP_EVERY, sweep: { k: number; t: number } | null = null, sweepPost = '';
const sweepOrder: [number, number][] = [];
for (let c = 0; c < 10; c++) sweepOrder.push([-1, c]); for (let r = 0; r < 10; r++) sweepOrder.push([r, 10]);
for (let c = 9; c >= 0; c--) sweepOrder.push([10, c]); for (let r = 9; r >= 0; r--) sweepOrder.push([r, -1]);
function buyHole() {
  if (!playing || over || holeT > 0 || queue + credit + anteLeft < HOLE_COST) return false;
  let need = HOLE_COST; const q = Math.min(queue, need); queue -= q; need -= q;
  const cr = Math.min(credit, need); credit -= cr; need -= cr; anteLeft -= need;
  holeT = HOLE_TIME; say('HOLE GEARS · 100 s'); return true;
}
let detached = 0, anteLeft = 0, queue = 0, bin = 0, credit = 0, spawned = 0, lost = 0, reclaims = 0, nextId = 1;
let spawnT = 0, score = 0, time = 0, over = false, won = false, playing = false, flash = 0, wmAng = 0, millAng = 0, millSpin = 0, toast = '', toastT = 0;
let best = +(localStorage.getItem('gearmill.best') || 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ri = (a: number, b: number) => Math.floor(rnd(a, b + 1));
const inG = (r: number, c: number) => r >= 0 && c >= 0 && r < N && c < N;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SLOT_CATCH = 80 * Math.PI / 180, SLOT_UP_TOL = 25 * Math.PI / 180, SETTLE_RATE = 0.7, SETTLE_GRACE = 2.0;
const K = (r: number, c: number) => r + ',' + c;
const seatAt = (r: number, c: number) => seats.get(K(r, c));
const angDiff = (a: number, b: number) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = Math.min(window.innerWidth, 520); H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cs = Math.min((W - 16) / (N + 1), (H - 210) / (N + 1));
  ox = (W - cs * N) / 2; rackY = 100; oy = rackY + cs * 1.3;
}
window.addEventListener('resize', resize); resize();

const isWm = (r: number, c: number) => wms.some(w => w.r === r && w.c === c);
const isMill = (r: number, c: number) => r === mill.r && c === mill.c;
const locked = (r: number, c: number) => isWm(r, c) || isMill(r, c);
const pinUp = (r: number, c: number) => inG(r, c) ? pins[r][c] : !!edge.get(r + ',' + c);
const pinRaised = (r: number, c: number) => DIRS.every(([dr, dc]) => pinUp(r + dr, c + dc));
const postDown = (r: number, c: number) => edge.get(K(r, c)) === false;
// ROW/COLUMN FLIP: opposite border posts pair up (left r <-> right r, top c <-> bottom c).
// When a pair becomes MATCHING (both up or both down) it inverts every square in that line (XOR with the pin rule).
let flip: boolean[][] = [], sweeps: { row: boolean; i: number; t: number }[] = [];
const partner = (r: number, c: number): [number, number] => c < 0 ? [r, N] : c >= N ? [r, -1] : r < 0 ? [N, c] : [-1, c];
function setEdge(r: number, c: number, v: boolean) {
  const k = K(r, c); if (!edge.has(k) || edge.get(k) === v) return;
  edge.set(k, v);
  if (!v) releaseSeat(r, c);
  { const [pr, pc] = partner(r, c); if (edge.get(K(pr, pc)) === v) {
    const row = c < 0 || c >= N, i = row ? r : c;
    for (let j = 0; j < N; j++) { const rr = row ? i : j, cc = row ? j : i; flip[rr][cc] = !flip[rr][cc]; }
    sweeps.push({ row, i, t: 0 }); say(`${row ? 'ROW' : 'COLUMN'} ${i + 1} FLIPPED`);
  } }
}
const raised = (r: number, c: number) => pinRaised(r, c) !== !!flip[r]?.[c];
const pinsUpCount = () => pins.flat().filter(Boolean).length + [...edge.values()].filter(Boolean).length;
const cx = (c: number) => ox + (c + 0.5) * cs, cy = (r: number) => oy + (r + 0.5) * cs;
// edge posts sit just outside the grid, at the virtual neighbour position (half a cell out so they fit on screen)
const ex = (c: number) => c < 0 ? ox - cs * 0.42 : c >= N ? ox + N * cs + cs * 0.42 : cx(c);
const ey = (r: number) => r < 0 ? oy - cs * 0.42 : r >= N ? oy + N * cs + cs * 0.42 : cy(r);
const edgeKeys = () => { const k: [number, number][] = []; for (let i = 0; i < N; i++) k.push([-1, i], [N, i], [i, -1], [i, N]); return k; };

function freeSquare(avoid: (r: number, c: number) => boolean) {
  for (let t = 0; t < 200; t++) { const r = ri(0, N - 1), c = ri(0, N - 1); if (!locked(r, c) && !seatAt(r, c) && !avoid(r, c)) return { r, c }; }
  return null;
}
function addWindmill(r: number, c: number) { wms.push({ r, c, upperDone: false, born: time, dir: Math.random() < 0.5 ? 1 : -1 }); pins[r][c] = true; }
function reset() {
  flip = Array.from({ length: N }, () => Array(N).fill(false)); sweeps = [];
  pins = Array.from({ length: N }, () => Array(N).fill(false));
  edge = new Map(edgeKeys().map(([r, c]) => [r + ',' + c, true]));
  seats = new Map();
  gears = []; wms = [];
  anteLeft = ANTE; queue = 0; bin = 0; credit = 0; spawned = lost = reclaims = 0;
  rowCd = { T: 0, B: 0 }; lever = { T: 0, B: 0 }; leverAnim = { T: 0, B: 0 }; holeT = 0; sweepNext = SWEEP_EVERY; sweep = null; sweepPost = '';
  spawnT = 0; score = 0; time = 0; over = won = false; flash = 0; millSpin = 0; toast = ''; toastT = 0;
  const d = { r: ri(N - 2, N - 1), c: ri(0, N - 1) }; // v9: windmill starts at the bottom
  addWindmill(d.r, d.c);
  mill = { r: ri(0, 1), c: d.c < N / 2 ? ri(N / 2, N - 1) : ri(0, N / 2 - 1) };
  pins[mill.r][mill.c] = true;
}
function say(t: string) { toast = t; toastT = 2.5; }

function releaseSeat(r: number, c: number) {
  const s = seatAt(r, c); if (!s) return; seats.delete(K(r, c));
  gears.push({ id: s.id, x: ex(c), y: ey(r), vx: rnd(-15, 15), vy: cs * 0.5, ang: s.ang, va: rnd(-3, 3), power: s.power, phase: 'fall', dir: 0, dropX: 0, stuck: 0, earned: s.earned, skip: K(r, c), skipT: 0.6 });
}
// no-overlap: a gear may only seat if no other gear body would overlap it (meshing distance ~1 cell is fine)
function seatClear(r: number, c: number, self: Gear) {
  const x = ex(c), y = ey(r);
  for (const t of seats.values()) if (Math.hypot(ex(t.c) - x, ey(t.r) - y) < cs * 0.9) return false;
  for (const w of [...wms, mill]) if (!(w.r === r && w.c === c) && Math.hypot(cx(w.c) - x, cy(w.r) - y) < cs * 0.9) return false;
  for (const g of gears) if (g !== self && !g.dead && Math.hypot(g.x - x, g.y - y) < cs * 0.84) return false;
  return true;
}
// loose gears collide with each other (rack gears that bump just drop early)
function separateLoose() {
  const m = cs * 0.84;
  const statics = [...[...seats.values()].map(t => [ex(t.c), ey(t.r)]), ...wms.map(w => [cx(w.c), cy(w.r)]), [cx(mill.c), cy(mill.r)]];
  for (let it = 0; it < 6; it++) {
  for (const g of gears) if (g.phase === 'fall') for (const [sx, sy] of statics) {
    const dx = g.x - sx, dy = g.y - sy, d = Math.hypot(dx, dy), ms = cs * 0.87;
    if (d < ms) { const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1; g.x = sx + nx * ms; g.y = sy + ny * ms; const vn = g.vx * nx + g.vy * ny; if (vn < 0) { g.vx -= vn * nx; g.vy -= vn * ny; } }
  }
  for (let i = 0; i < gears.length; i++) for (let j = i + 1; j < gears.length; j++) {
    const a = gears[i], b = gears[j]; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= m) continue;
    if (a.phase === 'rack' || b.phase === 'rack') { for (const g of [a, b]) if (g.phase === 'rack') { g.phase = 'fall'; g.vx = g.dir * cs; g.vy = 0; } }
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0, push = (m - d) / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) { const imp = -rv * 0.65; a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp; a.va = rnd(-5, 5); b.va = rnd(-5, 5); }
  }
  }
}
// row buttons: arrows in the top-left / bottom-left board corners toggle that whole border row
const ROW_CD = 1.0; let rowCd = { T: 0, B: 0 } as Record<'T' | 'B', number>;
const rowBtn = (sd: 'T' | 'B') => ({ x: ox - cs * 0.42, y: sd === 'T' ? oy - cs * 0.42 : oy + N * cs + cs * 0.42 });
let lever = { T: 0, B: 0 } as Record<'T' | 'B', number>, leverAnim = { T: 0, B: 0 } as Record<'T' | 'B', number>;
function rowToggle(sd: 'T' | 'B') {
  if (rowCd[sd] > 0) return false; rowCd[sd] = ROW_CD; lever[sd] = 1 - lever[sd];
  const r = sd === 'T' ? -1 : N; for (let c = 0; c < N; c++) setEdge(r, c, !edge.get(K(r, c)));
  return true;
}
function tap(px: number, py: number) {
  if (!playing || over) return;
  for (const sd of ['T', 'B'] as const) { const b = rowBtn(sd); if (Math.hypot(px - b.x, py - b.y) < cs * 0.62 && Math.abs(px - b.x) < cs * 0.62) { rowToggle(sd); return; } }
  const fx = (px - ox) / cs, fy = (py - oy) / cs;
  const c = Math.floor(fx), r = Math.floor(fy);
  if (inG(r, c)) { if (locked(r, c)) return; pins[r][c] = !pins[r][c]; if (!pins[r][c]) releaseSeat(r, c); return; }
  // border post: nearest edge post within ~0.6 cell
  let bestK: [number, number] | null = null, bd = cs * 0.6;
  for (const [er, ec] of edgeKeys()) { const d = Math.hypot(px - ex(ec), py - ey(er)); if (d < bd) { bd = d; bestK = [er, ec]; } }
  if (bestK) { const k = bestK.join(','); if (seatAt(bestK[0], bestK[1])) { releaseSeat(bestK[0], bestK[1]); return; } setEdge(bestK[0], bestK[1], !edge.get(k)); }
}
cv.addEventListener('pointerdown', e => { const b = cv.getBoundingClientRect(); tap(e.clientX - b.left, e.clientY - b.top); });

function spawn() {
  if (anteLeft > 0) anteLeft--; else queue--;
  const left = Math.random() < 0.5;
  gears.push({ id: nextId++, x: left ? -cs : W + cs, y: rackY, vx: 0, vy: 0, ang: 0, va: 0, power: Math.random() < 0.13, phase: 'rack', dir: left ? 1 : -1, dropX: rnd(ox + cs * 0.4, ox + cs * (N - 0.4)), stuck: 0, earned: false });
  spawned++;
}

function freePinsNear(x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  const c0 = Math.floor((x - ox) / cs), r0 = Math.floor((y - oy) / cs);
  for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
    const g = inG(r, c), isEdge = !g && edge.has(K(r, c));
    if ((g && pins[r][c] && !locked(r, c)) || (isEdge && edge.get(K(r, c)))) if (!seatAt(r, c)) out.push([r, c]);
  }
  return out;
}
// a gear can't slip off if something sits directly below it
function supported(r: number, c: number) {
  if (r >= N) return true; // bottom border posts rest on the frame
  const br = r + 1;
  if (seatAt(br, c)) return true;
  if (inG(br, c)) return raised(br, c) || locked(br, c);
  return br === N && inG(0, c) ? !!edge.get(K(N, c)) : !!edge.get(K(br, c));
}
// power graph: nodes are r,c,level. windmills and the mill exist on both levels; seated gears on their own level.
function nodeAt(r: number, c: number, l: number) { return (inG(r, c) && locked(r, c)) || seatAt(r, c)?.lvl === l; }
function bfs(starts: string[]) {
  const seen = new Set(starts), q = [...starts];
  while (q.length) { const [r, c, l] = q.shift()!.split(',').map(Number);
    for (const [dr, dc] of DIRS) { const k = `${r + dr},${c + dc},${l}`; if (!seen.has(k) && nodeAt(r + dr, c + dc, l)) { seen.add(k); q.push(k); } } }
  return seen;
}
const sideOf = (r: number, c: number) => r < 0 ? 'T' : r >= N ? 'B' : c < 0 ? 'L' : c >= N ? 'R' : '';
const sideIdx = (r: number, c: number) => (r < 0 || r >= N) ? c : r;
const sideKey = (sd: string, i: number) => sd === 'T' ? K(-1, i) : sd === 'B' ? K(N, i) : sd === 'L' ? K(i, -1) : K(i, N);
const nbrs = (k: string) => { const [r, c, l] = k.split(',').map(Number); return DIRS.map(([dr, dc]) => [r + dr, c + dc, l]).filter(([a, b, l2]) => nodeAt(a, b, l2)).map(v => v.join(',')); };
// direction solve: multi-driver BFS 2-colouring; any component with a conflict jams
function solve(drivers: Map<string, number>) {
  const dir = new Map(drivers), q = [...drivers.keys()], conflicts: [string, string][] = [];
  while (q.length) { const u = q.shift()!; for (const v of nbrs(u)) { if (!dir.has(v)) { dir.set(v, -dir.get(u)!); q.push(v); } else if (dir.get(v) === dir.get(u)) conflicts.push([u, v]); } }
  const jam = new Set<string>();
  for (const [u] of conflicts) { if (jam.has(u)) continue; const st = [u]; jam.add(u); while (st.length) { const x = st.pop()!; for (const y of nbrs(x)) if (!jam.has(y)) { jam.add(y); st.push(y); } } }
  return { dir, jam, conflicts };
}
function power() {
  const base = new Map<string, number>();
  for (const w of wms) { base.set(`${w.r},${w.c},0`, w.dir); base.set(`${w.r},${w.c},1`, w.dir); }
  // power-up hold refresh: reachable from a windmill (ignoring direction)
  const fromWm = bfs([...base.keys()]);
  for (const s of seats.values()) { s.srcConn = fromWm.has(`${s.r},${s.c},${s.lvl}`); if (s.power && s.srcConn) s.hold = POWER_HOLD;
    if (s.power && s.hold > 0 && !s.srcConn) base.set(`${s.r},${s.c},${s.lvl}`, s.dir || ((s.r + s.c) % 2 ? -1 : 1)); }
  // iterate side spin to a fixed point
  let res = solve(base); postDir = new Map(); jamSides = new Set();
  for (let it = 0; it < 4; it++) {
    const demand = new Map<string, number[]>();
    for (const s of seats.values()) { const sd = sideOf(s.r, s.c); if (!sd) continue; const k = `${s.r},${s.c},0`;
      if (res.dir.has(k) && !res.jam.has(k)) (demand.get(sd) || demand.set(sd, []).get(sd)!).push(sideIdx(s.r, s.c) * 2 + (res.dir.get(k)! > 0 ? 1 : 0)); }
    const pd = new Map<string, number>(), js = new Set<string>();
    for (const [sd, list] of demand) {
      const want = (i: number) => list.map(e => { const i0 = e >> 1, d0 = e & 1 ? 1 : -1; return d0 * ((i - i0) % 2 ? -1 : 1); });
      if (new Set(want(0)).size > 1) { js.add(sd); continue; }
      for (let i = 0; i < N; i++) pd.set(sideKey(sd, i), want(i)[0]);
    }
    const drv = new Map(base);
    for (const [k, d] of pd) if (seats.has(k)) drv.set(k + ',0', d);
    const next = solve(drv);
    for (const sd of js) for (let i = 0; i < N; i++) { const k = sideKey(sd, i) + ',0'; if (seats.has(sideKey(sd, i)) && !next.jam.has(k)) { const st = [k]; next.jam.add(k); while (st.length) { const x = st.pop()!; for (const y of nbrs(x)) if (!next.jam.has(y)) { next.jam.add(y); st.push(y); } } } }
    const same = pd.size === postDir.size && [...pd].every(([k, v]) => postDir.get(k) === v);
    res = next; postDir = pd; jamSides = js;
    if (same && it > 0) break;
  }
  jamLinks = res.conflicts;
  let n = 0, newly = 0;
  for (const s of seats.values()) { const k = `${s.r},${s.c},${s.lvl}`;
    s.jam = res.jam.has(k); s.on = res.dir.has(k) && !s.jam; if (s.on) { s.dir = res.dir.get(k)!; n++; if (!s.earned) { s.earned = true; newly++; } } }
  const hooked: Mill[] = [];
  for (const w of wms) if (!w.upperDone && DIRS.some(([dr, dc]) => { const s = seatAt(w.r + dr, w.c + dc); return s && s.lvl === 1 && s.on; })) hooked.push(w);
  const mk = [`${mill.r},${mill.c},0`, `${mill.r},${mill.c},1`];
  const millOn = mk.some(k => res.dir.has(k) && !res.jam.has(k));
  return { n, newly, hooked, millOn };
}

let paused = false, testQuiet = false;
function step(dt: number) {
  if (paused) dt = 0;
  wmAng += dt * 2; postAng += dt * 2; rowCd.T = Math.max(0, rowCd.T - dt); rowCd.B = Math.max(0, rowCd.B - dt);
  for (const sd of ['T', 'B'] as const) { const tgt = lever[sd], d = tgt - leverAnim[sd]; leverAnim[sd] += Math.sign(d) * Math.min(Math.abs(d), dt * 6); }
  for (const w of sweeps) w.t += dt; sweeps = sweeps.filter(w => w.t < 0.8);
  for (const k of sparks) { k.t -= dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vy += cs * 8 * dt; }
  sparks = sparks.filter(k => k.t > 0);
  if (dt > 0) {
    for (const [u, v] of jamLinks) { const [r1, c1] = u.split(',').map(Number), [r2, c2] = v.split(',').map(Number); if (Math.random() < dt * 40) emit((ex(c1) + ex(c2)) / 2, (ey(r1) + ey(r2)) / 2, ri(2, 4)); }
    for (const g of seats.values()) if (g.jam && Math.random() < dt * 6) { const a = rnd(0, 7); emit(ex(g.c) + Math.cos(a) * cs * 0.45, ey(g.r) + Math.sin(a) * cs * 0.45, ri(1, 3)); }
  } toastT = Math.max(0, toastT - dt);
  if (!playing) return;
  if (over) { millAng += dt * millSpin; flash = Math.max(0, flash - dt); return; }
  time += dt; flash = Math.max(0, flash - dt);
  if (holeT > 0) { holeT = Math.max(0, holeT - dt); if (holeT === 0) say('HOLE GEARS ENDED'); }
  if (!sweep && time >= sweepNext) { sweep = { k: 0, t: 0 }; say('BORDER SWEEP'); }
  if (sweep) {
    while (sweep && sweep.t <= 0) { const [r, c] = sweepOrder[sweep.k % 40]; sweepPost = K(r, c); setEdge(r, c, !edge.get(K(r, c))); sweep.k++; sweep.t += 1;
      if (sweep.k >= SWEEP_STEPS) { sweep = null; sweepPost = ''; sweepNext += SWEEP_EVERY; if (sweepNext < time) sweepNext = time; } }
    if (sweep) sweep.t -= dt;
  }
  // levels follow the raise rule; seated gears ride with their square
  for (const s of seats.values()) s.lvl = inG(s.r, s.c) && raised(s.r, s.c) ? 1 : 0;
  spawnT -= dt;
  if (spawnT <= 0 && !testQuiet) { if (anteLeft + queue > 0) { spawn(); spawnT += SPAWN; } else spawnT = 0; }
  const rollV = cs * (1.5 + pinsUpCount() * 0.08), g = cs * 9, R = cs * 0.42;
  for (const gr of gears) {
    if (gr.phase === 'rack') {
      gr.x += gr.dir * rollV * dt; gr.ang += gr.dir * rollV * dt / R;
      if ((gr.dir > 0 && gr.x >= gr.dropX) || (gr.dir < 0 && gr.x <= gr.dropX)) { gr.phase = 'fall'; gr.vx = gr.dir * rollV * 0.3; gr.vy = 0; gr.va = gr.dir * 4; }
      continue;
    }
    // substepped motion so fast gears can't tunnel through blocks
    const nSub = Math.min(8, Math.max(1, Math.ceil(Math.hypot(gr.vx, gr.vy) * dt / (cs * 0.15)))), sdt = dt / nSub;
    let caught = false, onBlock = false;
    if (gr.skipT) { gr.skipT -= dt; if (gr.skipT <= 0) gr.skip = undefined; }
    for (let sub = 0; sub < nSub && !caught; sub++) {
    gr.vy += g * sdt; gr.vx += rnd(-1, 1) * cs * 2 * sdt; gr.vx *= Math.pow(0.995, 1 / nSub);
    gr.x += gr.vx * sdt; gr.y += gr.vy * sdt; gr.ang += gr.va * sdt;
    const wl = ox - cs * 0.75 + R, wr = ox + N * cs + cs * 0.75 - R;
    if (gr.x < wl) { gr.x = wl; gr.vx = Math.abs(gr.vx) * 0.5; gr.va = rnd(-6, 6); }
    if (gr.x > wr) { gr.x = wr; gr.vx = -Math.abs(gr.vx) * 0.5; gr.va = rnd(-6, 6); }
    const c = Math.floor((gr.x - ox) / cs), r = Math.floor((gr.y - oy) / cs);
    // slot catch. Pins on raised blocks stick up out of the block, so their catch reach extends to the block edge.
    for (const [pr, pc] of freePinsNear(gr.x, gr.y)) {
      const px = ex(pc), py = ey(pr), d = Math.hypot(px - gr.x, py - gr.y);
      const reach = inG(pr, pc) && raised(pr, pc) ? R + cs * 0.56 : R + cs * 0.14;
      if (d < reach && K(pr, pc) !== gr.skip && seatClear(pr, pc, gr) && (holeT > 0 || Math.abs(angDiff(Math.atan2(py - gr.y, px - gr.x), gr.ang)) < SLOT_CATCH)) {
        seats.set(K(pr, pc), { r: pr, c: pc, age: 0, id: gr.id, power: gr.power, hold: 0, ang: gr.ang, on: false, srcConn: false, earned: gr.earned, dir: 0, jam: false, lvl: inG(pr, pc) && raised(pr, pc) ? 1 : 0 });
        gr.dead = true; caught = true; break;
      }
    }
    if (caught) break;
    // raised squares are solid rounded blocks
    for (let rr = Math.max(0, r - 1); rr <= Math.min(N - 1, r + 1); rr++) for (let cc = Math.max(0, c - 1); cc <= Math.min(N - 1, c + 1); cc++) {
      if (!raised(rr, cc)) continue;
      const rad = cs * 0.1, x0 = ox + cc * cs + 2 + rad, x1 = ox + (cc + 1) * cs - 2 - rad, y0 = oy + rr * cs + 2 + rad, y1 = oy + (rr + 1) * cs - 2 - rad;
      const qx = Math.max(x0, Math.min(x1, gr.x)), qy = Math.max(y0, Math.min(y1, gr.y));
      let dx = gr.x - qx, dy = gr.y - qy, d = Math.hypot(dx, dy), nx = 0, ny = 0;
      if (d > 1e-6) { if (d >= R + rad) continue; nx = dx / d; ny = dy / d; gr.x = qx + nx * (R + rad); gr.y = qy + ny * (R + rad); }
      else { // centre inside the block (square rose under it): eject through the nearest side that isn't another raised block
        const sides: [number, number, number, number, number][] = [[gr.x - x0, -1, 0, 0, -1], [x1 - gr.x, 1, 0, 0, 1], [gr.y - y0, 0, -1, -1, 0], [y1 - gr.y, 0, 1, 1, 0]];
        sides.sort((a, b) => a[0] - b[0]);
        const pick = sides.find(([, , , dr, dc]) => !(inG(rr + dr, cc + dc) && raised(rr + dr, cc + dc))) || sides[0];
        nx = pick[1]; ny = pick[2];
        if (nx) gr.x = (nx < 0 ? x0 : x1) + nx * (R + rad); else gr.y = (ny < 0 ? y0 : y1) + ny * (R + rad);
      }
      const vn = gr.vx * nx + gr.vy * ny;
      if (vn < 0) { const tx = -ny, ty = nx; let vt = gr.vx * tx + gr.vy * ty; const vnn = -vn * (Math.abs(vn) > cs * 1.5 ? 0.45 : 0); vt *= 0.985;
        gr.vx = nx * vnn + tx * vt; gr.vy = ny * vnn + ty * vt; gr.va = vt / R; }
      if (ny < -0.5) onBlock = true;
    }
    // corner lever housings are solid blocks
    for (const sd of ['T', 'B'] as const) {
      const rad = cs * 0.08, x0 = ox - cs * 0.75 + rad, x1 = ox - cs * 0.04 - rad;
      const y0 = (sd === 'T' ? oy - cs * 0.75 : oy + N * cs + cs * 0.04) + rad, y1 = (sd === 'T' ? oy - cs * 0.04 : oy + N * cs + cs * 0.75) - rad;
      const qx = Math.max(x0, Math.min(x1, gr.x)), qy = Math.max(y0, Math.min(y1, gr.y));
      const dx = gr.x - qx, dy = gr.y - qy, d = Math.hypot(dx, dy);
      let nx = 1, ny = 0;
      if (d > 1e-6) { if (d >= R + rad) continue; nx = dx / d; ny = dy / d; gr.x = qx + nx * (R + rad); gr.y = qy + ny * (R + rad); }
      else gr.x = x1 + R + rad;
      const vn = gr.vx * nx + gr.vy * ny;
      if (vn < 0) { const tx = -ny, ty = nx, vt = (gr.vx * tx + gr.vy * ty) * 0.985, vnn = -vn * 0.45; gr.vx = nx * vnn + tx * vt; gr.vy = ny * vnn + ty * vt; gr.va = vt / R; }
      if (ny < -0.5) onBlock = true;
    }
    const col: [number, number, number][] = [];
    for (let rr = Math.max(0, r - 1); rr <= Math.min(N - 1, r + 1); rr++) for (let cc = Math.max(0, c - 1); cc <= Math.min(N - 1, c + 1); cc++) {
      if (locked(rr, cc)) col.push([cx(cc), cy(rr), cs * 0.45]);
    }
    for (const t of seats.values()) if (Math.abs(ex(t.c) - gr.x) < cs * 1.2 && Math.abs(ey(t.r) - gr.y) < cs * 1.2) col.push([ex(t.c), ey(t.r), cs * 0.45]);
    for (const [pr, pc] of freePinsNear(gr.x, gr.y)) col.push([ex(pc), ey(pr), cs * 0.1]);
    for (const [px, py, pr] of col) {
      const dx = gr.x - px, dy = gr.y - py, d = Math.hypot(dx, dy), m = R + pr;
      if (d < m && d > 0.01) { const nx = dx / d, ny = dy / d; gr.x = px + nx * m; gr.y = py + ny * m;
        const vn = gr.vx * nx + gr.vy * ny; if (vn < 0) { gr.vx -= 1.5 * vn * nx; gr.vy -= 1.5 * vn * ny; gr.vx += rnd(-0.3, 0.3) * cs; gr.va = rnd(-6, 6); } }
    }
    }
    if (caught) continue;
    if (Math.hypot(gr.vx, gr.vy) < cs * 0.8) { gr.stuck += dt; if (gr.stuck > 0.6) { gr.vx += (Math.sign(gr.vx) || (Math.random() < 0.5 ? -1 : 1)) * cs * 3; gr.stuck = 0.3; } if (gr.stuck > (onBlock ? 6 : 3)) { gr.dead = true; lost++; bin++; continue; } }
    else gr.stuck = Math.max(0, gr.stuck - dt);
    if (gr.y > oy + N * cs + cs * 1.1) { gr.dead = true; lost++; bin++; }
  }
  gears = gears.filter(g => !g.dead);
  separateLoose();
  for (const s of seats.values()) if (s && s.power && !s.srcConn && s.hold > 0) s.hold = Math.max(0, s.hold - dt);
  const p = power();
  score += p.n * dt;
  credit += p.newly * REWARD;
  for (const w of p.hooked) {
    w.upperDone = true; reclaims++;
    const back = bin; queue += bin; bin = 0;
    const spot = freeSquare((r, c) => Math.abs(r - mill.r) + Math.abs(c - mill.c) < 2);
    if (spot) addWindmill(spot.r, spot.c);
    flash = 0.9; say(`UPPER LINK! +${back} gears reclaimed${spot ? ' · new windmill' : ''}`);
  }
  const pay = Math.min(bin, credit); if (pay > 0) { bin -= pay; credit -= pay; queue += pay; }
  for (const s of seats.values()) {
    s.age += dt;
    if (s.on) s.ang += dt * 2 * s.dir;
    else if (sideOf(s.r, s.c)) { /* locked on border post: holds still */ }
    else if (holeT === 0 && !s.jam && s.age > SETTLE_GRACE) { const d = angDiff(-Math.PI / 2, s.ang); s.ang += Math.sign(d) * Math.min(Math.abs(d), SETTLE_RATE * dt); } // heavy solid half sinks, slot swings up
  }
  for (const s of [...seats.values()]) if (holeT === 0 && !sideOf(s.r, s.c) && Math.abs(angDiff(s.ang, -Math.PI / 2)) < SLOT_UP_TOL && !supported(s.r, s.c)) { releaseSeat(s.r, s.c); detached++; }
  if (p.millOn) finish(true);
  else if (!testQuiet && anteLeft + queue === 0 && gears.length === 0 && !(credit > 0 && bin > 0)) finish(false);
}
function finish(w: boolean) {
  over = true; won = w; millSpin = w ? 6 : 0; flash = w ? 1.5 : 0;
  if (w) score += WIN_BONUS;
  const fs = Math.floor(score); if (fs > best) { best = fs; localStorage.setItem('gearmill.best', '' + best); }
  setTimeout(() => {
    document.getElementById('ot')!.textContent = w ? '⚙ MILL CONNECTED!' : 'OUT OF GEARS';
    document.getElementById('os')!.innerHTML = `Score <b>${fs}</b>${w ? ` (incl. +${WIN_BONUS} bonus)` : ''}<br>Gears dropped ${spawned} · binned ${lost}<br>Windmills ${wms.length} · reclaims ${reclaims}<br>Time ${time.toFixed(1)}s<br>Best ${best}`;
    document.getElementById('over')!.classList.remove('h');
  }, w ? 1500 : 300);
}

function gearPath(x: number, y: number, R: number, teeth: number, ang: number) {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) { const a = ang + (i / (teeth * 2)) * Math.PI * 2, a2 = ang + ((i + 1) / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? R * 0.82 : R;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); ctx.lineTo(x + Math.cos(a2) * rr, y + Math.sin(a2) * rr); }
  ctx.closePath();
}
function drawGear(x: number, y: number, ang: number, pw: boolean, on: boolean, hold = 0, upper = false, scale = 1, slot = true, jam = false) {
  const R = cs * 0.5 * scale;
  if (upper) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(x + 3, y + 4, R, 0, 7); ctx.fill(); }
  if (pw) { ctx.shadowColor = '#5fe0ff'; ctx.shadowBlur = on ? 14 : 6; }
  const gd = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
  gd.addColorStop(0, pw ? '#c8f6ff' : (upper ? '#fff6e0' : '#e8ecf0')); gd.addColorStop(1, pw ? '#1d8fb0' : (on ? (upper ? '#b07a20' : '#8a6a2a') : '#5b6370'));
  ctx.fillStyle = gd; gearPath(x, y, R, 10, ang); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = upper ? '#f0b44c' : '#111'; ctx.lineWidth = upper ? 1.5 : 1; ctx.stroke();
  if (slot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(0, 0, R * 0.8, Math.PI / 2, Math.PI * 1.5); ctx.fill(); // solid (heavy) half shading
  ctx.fillStyle = '#0b0d10'; ctx.beginPath(); ctx.moveTo(R * 1.05, -R * 0.2); ctx.lineTo(R * 0.05, -R * 0.2); ctx.arc(R * 0.05, 0, R * 0.2, -Math.PI / 2, Math.PI / 2, true); ctx.lineTo(R * 1.05, R * 0.2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f0b44c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(R * 0.95, -R * 0.2); ctx.lineTo(R * 0.05, -R * 0.2); ctx.arc(R * 0.05, 0, R * 0.2, -Math.PI / 2, Math.PI / 2, true); ctx.lineTo(R * 0.95, R * 0.2); ctx.stroke();
  ctx.restore();
  } else { ctx.fillStyle = '#20262e'; ctx.beginPath(); ctx.arc(x, y, R * 0.28, 0, 7); ctx.fill(); }
  if (jam) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, R * 1.02, 0, 7); ctx.stroke(); }
  if (hold > 0) { ctx.strokeStyle = '#5fe0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R * 1.05, -Math.PI / 2, -Math.PI / 2 + (hold / POWER_HOLD) * Math.PI * 2); ctx.stroke(); }
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f0b44c'; ctx.font = 'bold 18px system-ui'; ctx.fillText('MILL', 100, 22);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#dfe6ee';
  ctx.fillText(`Score ${Math.floor(score)}`, 10, 42); ctx.fillText(`Best ${best}`, 110, 42); ctx.fillText(`Pins ${pinsUpCount()}`, 200, 42); ctx.fillText(`${time.toFixed(0)}s`, W - 40, 22);
  ctx.fillText(`Ante ${anteLeft}`, 10, 60); ctx.fillText(`Queue ${queue}`, 90, 60); ctx.fillText(`Bin ${bin}`, 180, 60);
  ctx.fillStyle = credit > 0 ? '#7dff9a' : '#dfe6ee'; ctx.fillText(`Credit ${credit}`, 250, 60);
  if (sweep) { ctx.fillStyle = '#50dcff'; ctx.font = 'bold 12px system-ui'; ctx.fillText(`SWEEP ${sweep.k}/${SWEEP_STEPS}`, 10, 80); }
  else { ctx.fillStyle = '#6b7585'; ctx.font = '11px system-ui'; ctx.fillText(`sweep in ${Math.ceil(sweepNext - time)}s`, 10, 80); }
  const hb = document.getElementById('hole') as HTMLButtonElement | null;
  if (hb) { const can = playing && !over && holeT === 0 && queue + credit + anteLeft >= HOLE_COST; hb.disabled = !can;
    hb.textContent = holeT > 0 ? `◎ HOLE ${Math.ceil(holeT)}s` : `◎ HOLE GEARS · ${HOLE_COST}`; hb.classList.toggle('on', holeT > 0); }
  ctx.fillStyle = '#9aa4b2'; ctx.fillText(`Windmills ${wms.length}`, W - 100, 42);
  ctx.fillStyle = '#3a4250'; ctx.fillRect(0, rackY + cs * 0.42, W, 6);
  ctx.fillStyle = '#6b7585'; for (let x = 0; x < W; x += 8) ctx.fillRect(x, rackY + cs * 0.42 - 3, 4, 3);
  const bw = cs * N;
  const bg = ctx.createLinearGradient(0, oy, 0, oy + bw); bg.addColorStop(0, '#2a3038'); bg.addColorStop(1, '#14181d');
  ctx.fillStyle = bg; ctx.fillRect(ox - cs * 0.75, oy - cs * 0.75, bw + cs * 1.5, bw + cs * 1.5);
  ctx.strokeStyle = '#4a5260'; ctx.lineWidth = 2; ctx.strokeRect(ox - cs * 0.75, oy - cs * 0.75, bw + cs * 1.5, bw + cs * 1.5);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x = ox + c * cs, y = oy + r * cs, up = raised(r, c);
    if (up) { ctx.fillStyle = '#56606f'; ctx.fillRect(x + 2, y + 2, cs - 4, cs - 4); ctx.fillStyle = '#7d8aa0'; ctx.fillRect(x + 2, y + 2, cs - 4, 3); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + 2, y + cs - 5, cs - 4, 3); }
    else { ctx.fillStyle = '#101317'; ctx.fillRect(x + 3, y + 3, cs - 6, cs - 6); }
    ctx.fillStyle = pins[r][c] ? '#d8dde4' : '#2c323a'; ctx.beginPath(); ctx.arc(x + cs / 2, y + cs / 2, pins[r][c] ? cs * 0.1 : cs * 0.06, 0, 7); ctx.fill();
  }
  for (const [er, ec] of edgeKeys()) { const on = edge.get(er + ',' + ec), pd = postDir.get(K(er, ec)), x = ex(ec), y = ey(er);
    ctx.fillStyle = on ? '#c9a24a' : '#2c323a'; ctx.beginPath(); ctx.arc(x, y, on ? cs * 0.13 : cs * 0.08, 0, 7); ctx.fill();
    if (pd) { ctx.save(); ctx.translate(x, y); ctx.rotate(postAng * pd); ctx.strokeStyle = '#3a2a08'; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-cs * 0.13, 0); ctx.lineTo(cs * 0.13, 0); ctx.stroke(); } ctx.restore();
      ctx.strokeStyle = 'rgba(255,214,110,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, cs * 0.19, postAng * pd, postAng * pd + 4.5); ctx.stroke(); }
    if (jamSides.has(sideOf(er, ec))) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, cs * 0.17, 0, 7); ctx.stroke(); } }
  ctx.fillStyle = '#1c2128'; ctx.fillRect(ox, oy + bw + cs * 0.85, bw, 22); ctx.fillStyle = '#7a8494'; ctx.font = '11px system-ui'; ctx.fillText(`▼ BIN ${bin} · binned total ${lost}`, ox + 8, oy + bw + cs * 0.85 + 15);
  for (const s of seats.values()) drawGear(ex(s.c), ey(s.r), s.ang, s.power, s.on, s.power && !s.srcConn ? s.hold : 0, s.lvl === 1, 1, holeT === 0, s.jam);
  for (const [u, v] of jamLinks) { const [r1, c1] = u.split(',').map(Number), [r2, c2] = v.split(',').map(Number);
    ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex(c1), ey(r1)); ctx.lineTo(ex(c2), ey(r2)); ctx.stroke();
    ctx.fillStyle = '#ff3b3b'; ctx.font = `bold ${cs * 0.4}px system-ui`; ctx.fillText('✕', (ex(c1) + ex(c2)) / 2 - cs * 0.13, (ey(r1) + ey(r2)) / 2 + cs * 0.14); }
  for (const w of wms) {
    const x = cx(w.c), y = cy(w.r);
    drawGear(x, y, wmAng * w.dir, false, true, 0, false, 1, false);                       // floor gear
    drawGear(x - 2, y - 3, wmAng * w.dir, false, true, 0, true, 0.72, false); // upper gear (stacked, counter-spin)
    ctx.save(); ctx.translate(x - 2, y - 3); ctx.rotate(wmAng * 1.3 * w.dir); ctx.fillStyle = w.upperDone ? '#f0b44c' : '#e9e2cf';
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-cs * 0.06, -cs * 0.85, cs * 0.12, cs * 0.55); ctx.strokeStyle = '#8a7a50'; ctx.strokeRect(-cs * 0.06, -cs * 0.85, cs * 0.12, cs * 0.55); }
    ctx.restore();
  }
  const mx = cx(mill.c), my = cy(mill.r);
  drawGear(mx, my, millAng, false, won, 0, false, 1, false);
  ctx.fillStyle = won ? '#f0b44c' : '#8b5a2b'; ctx.fillRect(mx - cs * 0.22, my - cs * 0.22, cs * 0.44, cs * 0.44);
  ctx.fillStyle = '#111'; ctx.font = `bold ${cs * 0.28}px system-ui`; ctx.fillText('M', mx - cs * 0.12, my + cs * 0.1);
  for (const g of gears) drawGear(g.x, g.y, g.ang, g.power, false, 0, false, 1, holeT === 0);
  for (const k of sparks) { ctx.strokeStyle = k.col; ctx.lineWidth = 3; ctx.shadowColor = "#ffb000"; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.lineTo(k.x - k.vx * 0.05, k.y - k.vy * 0.05); ctx.stroke(); } ctx.shadowBlur = 0;
  if (sweepPost) { const [r, c] = sweepPost.split(',').map(Number); const a = 0.5 + 0.5 * Math.sin(performance.now() / 90);
    ctx.fillStyle = `rgba(80,220,255,${0.35 + 0.4 * a})`; ctx.beginPath(); ctx.arc(ex(c), ey(r), cs * 0.32, 0, 7); ctx.fill(); }
  for (const sd of ['T', 'B'] as const) {
    const b = rowBtn(sd), cd = rowCd[sd] / ROW_CD, x0 = ox - cs * 0.75, w = cs * 0.71, y0 = sd === 'T' ? oy - cs * 0.75 : oy + N * cs + cs * 0.04;
    // housing block
    const hg = ctx.createLinearGradient(0, y0, 0, y0 + w); hg.addColorStop(0, '#5a6372'); hg.addColorStop(1, '#2a3038');
    ctx.fillStyle = hg; ctx.fillRect(x0, y0, w, w); ctx.strokeStyle = '#7d8aa0'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, w - 1);
    // slot + handle: pivot near bottom, swings left (-) to right (+)
    const px = b.x, py = y0 + w * 0.78, ang = (-0.75 + 1.5 * leverAnim[sd]), L = w * 0.62;
    ctx.fillStyle = '#111'; ctx.fillRect(px - w * 0.36, py - 2, w * 0.72, 4);
    const hx = px + Math.sin(ang) * L, hy = py - Math.cos(ang) * L;
    ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = cd > 0 ? '#6b7585' : '#ff4a3a'; ctx.beginPath(); ctx.arc(hx, hy, w * 0.13, 0, 7); ctx.fill();
    ctx.fillStyle = '#20262e'; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
    if (cd > 0) { ctx.strokeStyle = '#50dcff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 + 2, y0 + w - 2); ctx.lineTo(x0 + 2 + (w - 4) * (1 - cd), y0 + w - 2); ctx.stroke(); }
  }
  // pair cue: one post of a pair down -> pulse its partner as the target
  for (const [er, ec] of edgeKeys()) if (postDown(er, ec)) { const [pr, pc] = partner(er, ec); if (!postDown(pr, pc)) {
    const a = 0.5 + 0.5 * Math.sin(performance.now() / 150);
    ctx.strokeStyle = `rgba(80,220,255,${0.4 + 0.6 * a})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ex(pc), ey(pr), cs * (0.2 + 0.08 * a), 0, 7); ctx.stroke();
    ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(80,220,255,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ex(ec), ey(er)); ctx.lineTo(ex(pc), ey(pr)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(80,220,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ex(ec), ey(er), cs * 0.16, 0, 7); ctx.stroke(); } }
  for (const w of sweeps) { const f = w.t / 0.8, gw = ctx.createLinearGradient(0, 0, 1, 0); void gw;
    ctx.fillStyle = `rgba(120,230,255,${0.5 * (1 - f)})`;
    if (w.row) { const x = ox + f * N * cs; ctx.fillRect(ox, oy + w.i * cs, x - ox, cs); ctx.fillStyle = `rgba(255,255,255,${1 - f})`; ctx.fillRect(x - 4, oy + w.i * cs, 8, cs); }
    else { const y = oy + f * N * cs; ctx.fillRect(ox + w.i * cs, oy, cs, y - oy); ctx.fillStyle = `rgba(255,255,255,${1 - f})`; ctx.fillRect(ox + w.i * cs, y - 4, cs, 8); } }
  if (toastT > 0) { ctx.globalAlpha = Math.min(1, toastT); ctx.fillStyle = '#1b2a1e'; ctx.fillRect(10, oy + bw + cs * 0.85 + 28, W - 20, 30); ctx.fillStyle = '#7dff9a'; ctx.font = 'bold 14px system-ui'; ctx.fillText(toast, 20, oy + bw + cs * 0.85 + 48); ctx.globalAlpha = 1; }
  if (flash > 0) { ctx.fillStyle = `rgba(255,220,120,${Math.min(1, flash) * 0.35})`; ctx.fillRect(0, 0, W, H); }
}
let last = performance.now();
function loop(t: number) { const dt = Math.min(0.05, (t - last) / 1000); last = t; step(dt); draw(); requestAnimationFrame(loop); }
reset(); requestAnimationFrame(loop);
const startGame = () => { document.getElementById('help')!.classList.add('h'); reset(); playing = true; };
document.getElementById('go')!.onclick = startGame; document.getElementById('hole')!.onclick = () => { buyHole(); }; document.getElementById('go2')!.onclick = startGame;
document.getElementById('again')!.onclick = () => { document.getElementById('over')!.classList.add('h'); reset(); playing = true; };
if (import.meta.env.DEV) {
  (window as any).__gm = {
    tap, raised, pinUp,
    seat(r: number, c: number, pw = false, ang = Math.PI / 2) { if (inG(r, c)) pins[r][c] = true; else edge.set(K(r, c), true); seats.set(K(r, c), { r, c, age: 0, ang, id: nextId++, power: pw, hold: 0, on: false, srcConn: false, earned: false, dir: 0, jam: false, lvl: inG(r, c) && raised(r, c) ? 1 : 0 }); },
    drop(x: number, y: number, ang: number, vx = 0, vy = 0) { gears.push({ id: nextId++, x, y, vx, vy, ang, va: 0, power: false, phase: 'fall', dir: 0, dropX: 0, stuck: 0, earned: false }); },
    pause(v: boolean) { paused = v; }, quiet(v: boolean) { testQuiet = v; }, ex, ey, supported,
    setPin(r: number, c: number, v: boolean) { if (inG(r, c)) pins[r][c] = v; else setEdge(r, c, v); },
    addBin(n: number) { bin += n; }, lever: () => ({ ...lever }), leverAnim: () => ({ ...leverAnim }), rowBtn, overlaps() { const L: string[] = []; const all = [...gears.map(g => [g.x, g.y]), ...[...seats.values()].map(t => [ex(t.c), ey(t.r)]), ...wms.map(w => [cx(w.c), cy(w.r)]), [cx(mill.c), cy(mill.r)]]; for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const d = Math.hypot(all[i][0] - all[j][0], all[i][1] - all[j][1]); if (d < cs * 0.8) L.push((d / cs).toFixed(2)); } return L; }, buyHole, setTime(t: number) { time = t; }, setHole(t: number) { holeT = t; }, setQueue(n: number) { queue = n; }, setCredit(n: number) { credit = n; }, order: sweepOrder, edgeUp(r: number, c: number) { return edge.get(K(r, c)); }, flipAt(r: number, c: number) { return flip[r][c]; }, gearsInfo() { return gears.map(g => ({ x: g.x, y: g.y, vx: g.vx, vy: g.vy, phase: g.phase })); }, flipRow(r: number) { for (let c = 0; c < N; c++) flip[r][c] = !flip[r][c]; }, flipCell(r: number, c: number) { flip[r][c] = !flip[r][c]; }, setWmDir(i: number, d: number) { wms[i].dir = d; }, addWm(r: number, c: number) { addWindmill(r, c); }, release(r: number, c: number) { releaseSeat(r, c); },
    get state() { return { flash, holeT, sweep: sweep && { ...sweep }, sweepPost, sweepNext, time, score, anteLeft, queue, bin, credit, spawned, lost, over, won, reclaims, wms: wms.map(w => ({ ...w })), mill, ox, oy, cs, detached, falling: gears.length, postDir: Object.fromEntries(postDir), jamSides: [...jamSides], jamLinks, seats: [...seats.values()].map(s => ({ r: s.r, c: s.c, lvl: s.lvl, on: s.on, ang: s.ang, dir: s.dir, jam: s.jam })) }; },
  };
}
