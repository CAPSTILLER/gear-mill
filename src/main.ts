/// <reference types="vite/client" />
const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const N = 10, ANTE = 50, SPAWN = 0.5, POWER_HOLD = 15, REWARD = 10, WIN_BONUS = 100;
let W = 0, H = 0, cs = 0, ox = 0, oy = 0, rackY = 0, dpr = 1;
type Seat = { id: number; power: boolean; hold: number; ang: number; on: boolean; srcConn: boolean; earned: boolean; lvl: number };
type Gear = { id: number; x: number; y: number; vx: number; vy: number; ang: number; va: number; power: boolean; phase: 'rack' | 'fall'; dir: number; dropX: number; stuck: number; earned: boolean; dead?: boolean };
type Mill = { r: number; c: number; upperDone: boolean; born: number };
let pins: boolean[][], edge: Map<string, boolean>, seats: (Seat | null)[][], gears: Gear[], wms: Mill[];
let mill = { r: 0, c: 0 };
let anteLeft = 0, queue = 0, bin = 0, credit = 0, spawned = 0, lost = 0, reclaims = 0, nextId = 1;
let spawnT = 0, score = 0, time = 0, over = false, won = false, playing = false, flash = 0, wmAng = 0, millAng = 0, millSpin = 0, toast = '', toastT = 0;
let best = +(localStorage.getItem('gearmill.best') || 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ri = (a: number, b: number) => Math.floor(rnd(a, b + 1));
const inG = (r: number, c: number) => r >= 0 && c >= 0 && r < N && c < N;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
const raised = (r: number, c: number) => DIRS.every(([dr, dc]) => pinUp(r + dr, c + dc));
const pinsUpCount = () => pins.flat().filter(Boolean).length + [...edge.values()].filter(Boolean).length;
const cx = (c: number) => ox + (c + 0.5) * cs, cy = (r: number) => oy + (r + 0.5) * cs;
// edge posts sit just outside the grid, at the virtual neighbour position (half a cell out so they fit on screen)
const ex = (c: number) => c < 0 ? ox - cs * 0.42 : c >= N ? ox + N * cs + cs * 0.42 : cx(c);
const ey = (r: number) => r < 0 ? oy - cs * 0.42 : r >= N ? oy + N * cs + cs * 0.42 : cy(r);
const edgeKeys = () => { const k: [number, number][] = []; for (let i = 0; i < N; i++) k.push([-1, i], [N, i], [i, -1], [i, N]); return k; };

function freeSquare(avoid: (r: number, c: number) => boolean) {
  for (let t = 0; t < 200; t++) { const r = ri(0, N - 1), c = ri(0, N - 1); if (!locked(r, c) && !seats[r][c] && !avoid(r, c)) return { r, c }; }
  return null;
}
function addWindmill(r: number, c: number) { wms.push({ r, c, upperDone: false, born: time }); pins[r][c] = true; }
function reset() {
  pins = Array.from({ length: N }, () => Array(N).fill(false));
  edge = new Map(edgeKeys().map(([r, c]) => [r + ',' + c, true]));
  seats = Array.from({ length: N }, () => Array(N).fill(null));
  gears = []; wms = [];
  anteLeft = ANTE; queue = 0; bin = 0; credit = 0; spawned = lost = reclaims = 0;
  spawnT = 0; score = 0; time = 0; over = won = false; flash = 0; millSpin = 0; toast = ''; toastT = 0;
  const d = { r: ri(0, 1), c: ri(0, N - 1) };
  addWindmill(d.r, d.c);
  mill = { r: ri(N - 2, N - 1), c: d.c < N / 2 ? ri(N / 2, N - 1) : ri(0, N / 2 - 1) };
  pins[mill.r][mill.c] = true;
}
function say(t: string) { toast = t; toastT = 2.5; }

function releaseSeat(r: number, c: number) {
  const s = seats[r][c]; if (!s) return; seats[r][c] = null;
  gears.push({ id: s.id, x: cx(c), y: cy(r), vx: rnd(-20, 20), vy: 10, ang: s.ang, va: 0, power: s.power, phase: 'fall', dir: 0, dropX: 0, stuck: 0, earned: s.earned });
}
function tap(px: number, py: number) {
  if (!playing || over) return;
  const fx = (px - ox) / cs, fy = (py - oy) / cs;
  const c = Math.floor(fx), r = Math.floor(fy);
  if (inG(r, c)) { if (locked(r, c)) return; pins[r][c] = !pins[r][c]; if (!pins[r][c]) releaseSeat(r, c); return; }
  // border post: nearest edge post within ~0.6 cell
  let bestK: [number, number] | null = null, bd = cs * 0.6;
  for (const [er, ec] of edgeKeys()) { const d = Math.hypot(px - ex(ec), py - ey(er)); if (d < bd) { bd = d; bestK = [er, ec]; } }
  if (bestK) { const k = bestK.join(','); edge.set(k, !edge.get(k)); }
}
cv.addEventListener('pointerdown', e => { const b = cv.getBoundingClientRect(); tap(e.clientX - b.left, e.clientY - b.top); });

function spawn() {
  if (anteLeft > 0) anteLeft--; else queue--;
  const left = Math.random() < 0.5;
  gears.push({ id: nextId++, x: left ? -cs : W + cs, y: rackY, vx: 0, vy: 0, ang: 0, va: 0, power: Math.random() < 0.13, phase: 'rack', dir: left ? 1 : -1, dropX: rnd(ox + cs * 0.4, ox + cs * (N - 0.4)), stuck: 0, earned: false });
  spawned++;
}

// power graph: nodes are r,c,level. windmills and the mill exist on both levels; seated gears on their own level.
function nodeAt(r: number, c: number, l: number) { return inG(r, c) && (locked(r, c) || (seats[r][c]?.lvl === l)); }
function bfs(starts: string[]) {
  const seen = new Set(starts), q = [...starts];
  while (q.length) { const [r, c, l] = q.shift()!.split(',').map(Number);
    for (const [dr, dc] of DIRS) { const k = `${r + dr},${c + dc},${l}`; if (!seen.has(k) && nodeAt(r + dr, c + dc, l)) { seen.add(k); q.push(k); } } }
  return seen;
}
function power() {
  const wmStarts = wms.flatMap(w => [`${w.r},${w.c},0`, `${w.r},${w.c},1`]);
  const fromWm = bfs(wmStarts);
  const srcs = [...wmStarts];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (!s) continue;
    s.srcConn = fromWm.has(`${r},${c},${s.lvl}`); if (s.power && s.srcConn) s.hold = POWER_HOLD; if (s.power && s.hold > 0) srcs.push(`${r},${c},${s.lvl}`); }
  const live = bfs(srcs);
  let n = 0, newly = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (!s) continue;
    s.on = live.has(`${r},${c},${s.lvl}`); if (s.on) { n++; if (!s.earned) { s.earned = true; newly++; } } }
  // upper windmill hookup: a turning upper-level gear meshed directly to a windmill's upper gear
  const hooked: Mill[] = [];
  for (const w of wms) if (!w.upperDone && DIRS.some(([dr, dc]) => { const s = seats[w.r + dr]?.[w.c + dc]; return s && s.lvl === 1 && s.on; })) hooked.push(w);
  const millOn = live.has(`${mill.r},${mill.c},0`) || live.has(`${mill.r},${mill.c},1`);
  return { n, newly, hooked, millOn };
}

function step(dt: number) {
  wmAng += dt * 2; toastT = Math.max(0, toastT - dt);
  if (!playing) return;
  if (over) { millAng += dt * millSpin; flash = Math.max(0, flash - dt); return; }
  time += dt;
  // levels follow the raise rule; seated gears ride with their square
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (s) s.lvl = raised(r, c) ? 1 : 0; }
  spawnT -= dt;
  if (spawnT <= 0) { if (anteLeft + queue > 0) { spawn(); spawnT += SPAWN; } else spawnT = 0; }
  const rollV = cs * (1.5 + pinsUpCount() * 0.08), g = cs * 9, R = cs * 0.42;
  for (const gr of gears) {
    if (gr.phase === 'rack') {
      gr.x += gr.dir * rollV * dt; gr.ang += gr.dir * rollV * dt / R;
      if ((gr.dir > 0 && gr.x >= gr.dropX) || (gr.dir < 0 && gr.x <= gr.dropX)) { gr.phase = 'fall'; gr.vx = gr.dir * rollV * 0.3; gr.vy = 0; gr.va = gr.dir * 4; }
      continue;
    }
    gr.vy += g * dt; gr.vx += rnd(-1, 1) * cs * 2 * dt; gr.vx *= 0.995;
    gr.x += gr.vx * dt; gr.y += gr.vy * dt; gr.ang += gr.va * dt;
    if (gr.x < ox + R) { gr.x = ox + R; gr.vx = Math.abs(gr.vx) * 0.5; }
    if (gr.x > ox + N * cs - R) { gr.x = ox + N * cs - R; gr.vx = -Math.abs(gr.vx) * 0.5; }
    const c = Math.floor((gr.x - ox) / cs), r = Math.floor((gr.y - oy) / cs);
    if (inG(r, c) && pins[r][c] && !seats[r][c] && !locked(r, c) && Math.hypot(gr.x - cx(c), gr.y - cy(r)) < cs * 0.3) {
      seats[r][c] = { id: gr.id, power: gr.power, hold: 0, ang: gr.ang, on: false, srcConn: false, earned: gr.earned, lvl: raised(r, c) ? 1 : 0 }; gr.dead = true; continue;
    }
    const col: [number, number, number][] = [];
    for (let rr = Math.max(0, r - 1); rr <= Math.min(N - 1, r + 1); rr++) for (let cc = Math.max(0, c - 1); cc <= Math.min(N - 1, c + 1); cc++) {
      if (seats[rr][cc] || locked(rr, cc)) col.push([cx(cc), cy(rr), cs * 0.45]);
      else if (pins[rr][cc]) col.push([cx(cc), cy(rr), cs * 0.07]);
    }
    for (const [px, py, pr] of col) {
      const dx = gr.x - px, dy = gr.y - py, d = Math.hypot(dx, dy), m = R + pr;
      if (d < m && d > 0.01) { const nx = dx / d, ny = dy / d; gr.x = px + nx * m; gr.y = py + ny * m;
        const vn = gr.vx * nx + gr.vy * ny; if (vn < 0) { gr.vx -= 1.5 * vn * nx; gr.vy -= 1.5 * vn * ny; gr.vx += rnd(-0.3, 0.3) * cs; gr.va = rnd(-6, 6); } }
    }
    if (Math.hypot(gr.vx, gr.vy) < cs * 0.8) { gr.stuck += dt; if (gr.stuck > 0.6) gr.vx += (Math.random() < 0.5 ? -1 : 1) * cs * 3; if (gr.stuck > 3) { gr.dead = true; lost++; bin++; continue; } }
    else gr.stuck = Math.max(0, gr.stuck - dt);
    if (gr.y > oy + N * cs + cs * 0.9) { gr.dead = true; lost++; bin++; }
  }
  gears = gears.filter(g => !g.dead);
  for (const row of seats) for (const s of row) if (s && s.power && !s.srcConn && s.hold > 0) s.hold = Math.max(0, s.hold - dt);
  const p = power();
  score += p.n * dt;
  credit += p.newly * REWARD;
  for (const w of p.hooked) {
    w.upperDone = true; reclaims++;
    const back = bin; queue += bin; bin = 0;
    const spot = freeSquare((r, c) => Math.abs(r - mill.r) + Math.abs(c - mill.c) < 2);
    if (spot) addWindmill(spot.r, spot.c);
    flash = 0.6; say(`UPPER LINK! +${back} gears reclaimed${spot ? ' · new windmill' : ''}`);
  }
  const pay = Math.min(bin, credit); if (pay > 0) { bin -= pay; credit -= pay; queue += pay; }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (s?.on) s.ang += dt * 2 * ((r + c) % 2 ? -1 : 1); }
  if (p.millOn) finish(true);
  else if (anteLeft + queue === 0 && gears.length === 0 && !(credit > 0 && bin > 0)) finish(false);
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
function drawGear(x: number, y: number, ang: number, pw: boolean, on: boolean, hold = 0, upper = false, scale = 1) {
  const R = cs * 0.5 * scale;
  if (upper) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(x + 3, y + 4, R, 0, 7); ctx.fill(); }
  if (pw) { ctx.shadowColor = '#5fe0ff'; ctx.shadowBlur = on ? 14 : 6; }
  const gd = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
  gd.addColorStop(0, pw ? '#c8f6ff' : (upper ? '#fff6e0' : '#e8ecf0')); gd.addColorStop(1, pw ? '#1d8fb0' : (on ? (upper ? '#b07a20' : '#8a6a2a') : '#5b6370'));
  ctx.fillStyle = gd; gearPath(x, y, R, 10, ang); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = upper ? '#f0b44c' : '#111'; ctx.lineWidth = upper ? 1.5 : 1; ctx.stroke();
  ctx.fillStyle = '#20262e'; ctx.beginPath(); ctx.arc(x, y, R * 0.28, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = '#0b0d10'; ctx.fillRect(-R * 0.07, -R * 0.62, R * 0.14, R * 0.36); ctx.restore();
  if (hold > 0) { ctx.strokeStyle = '#5fe0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R * 1.05, -Math.PI / 2, -Math.PI / 2 + (hold / POWER_HOLD) * Math.PI * 2); ctx.stroke(); }
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f0b44c'; ctx.font = 'bold 18px system-ui'; ctx.fillText('⚙ GEAR MILL', 10, 22);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#dfe6ee';
  ctx.fillText(`Score ${Math.floor(score)}`, 10, 42); ctx.fillText(`Best ${best}`, 110, 42); ctx.fillText(`Pins ${pinsUpCount()}`, 200, 42); ctx.fillText(`${time.toFixed(0)}s`, W - 40, 22);
  ctx.fillText(`Ante ${anteLeft}`, 10, 60); ctx.fillText(`Queue ${queue}`, 90, 60); ctx.fillText(`Bin ${bin}`, 180, 60);
  ctx.fillStyle = credit > 0 ? '#7dff9a' : '#dfe6ee'; ctx.fillText(`Credit ${credit}`, 250, 60);
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
  for (const [er, ec] of edgeKeys()) { const on = edge.get(er + ',' + ec); ctx.fillStyle = on ? '#c9a24a' : '#2c323a'; ctx.beginPath(); ctx.arc(ex(ec), ey(er), on ? cs * 0.13 : cs * 0.08, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#1c2128'; ctx.fillRect(ox, oy + bw + cs * 0.85, bw, 22); ctx.fillStyle = '#7a8494'; ctx.font = '11px system-ui'; ctx.fillText(`▼ BIN ${bin} · binned total ${lost}`, ox + 8, oy + bw + cs * 0.85 + 15);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (s) drawGear(cx(c), cy(r), s.ang, s.power, s.on, s.power && !s.srcConn ? s.hold : 0, s.lvl === 1); }
  for (const w of wms) {
    const x = cx(w.c), y = cy(w.r);
    drawGear(x, y, wmAng, false, true);                       // floor gear
    drawGear(x - 2, y - 3, -wmAng, false, true, 0, true, 0.72); // upper gear (stacked, counter-spin)
    ctx.save(); ctx.translate(x - 2, y - 3); ctx.rotate(wmAng * 1.3); ctx.fillStyle = w.upperDone ? '#f0b44c' : '#e9e2cf';
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-cs * 0.06, -cs * 0.85, cs * 0.12, cs * 0.55); ctx.strokeStyle = '#8a7a50'; ctx.strokeRect(-cs * 0.06, -cs * 0.85, cs * 0.12, cs * 0.55); }
    ctx.restore();
  }
  const mx = cx(mill.c), my = cy(mill.r);
  drawGear(mx, my, millAng, false, won);
  ctx.fillStyle = won ? '#f0b44c' : '#8b5a2b'; ctx.fillRect(mx - cs * 0.22, my - cs * 0.22, cs * 0.44, cs * 0.44);
  ctx.fillStyle = '#111'; ctx.font = `bold ${cs * 0.28}px system-ui`; ctx.fillText('M', mx - cs * 0.12, my + cs * 0.1);
  for (const g of gears) drawGear(g.x, g.y, g.ang, g.power, false);
  if (toastT > 0) { ctx.globalAlpha = Math.min(1, toastT); ctx.fillStyle = '#1b2a1e'; ctx.fillRect(10, oy + bw / 2 - 18, W - 20, 30); ctx.fillStyle = '#7dff9a'; ctx.font = 'bold 14px system-ui'; ctx.fillText(toast, 20, oy + bw / 2 + 2); ctx.globalAlpha = 1; }
  if (flash > 0) { ctx.fillStyle = `rgba(255,220,120,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
}
let last = performance.now();
function loop(t: number) { const dt = Math.min(0.05, (t - last) / 1000); last = t; step(dt); draw(); requestAnimationFrame(loop); }
reset(); requestAnimationFrame(loop);
document.getElementById('go')!.onclick = () => { document.getElementById('help')!.classList.add('h'); reset(); playing = true; };
document.getElementById('again')!.onclick = () => { document.getElementById('over')!.classList.add('h'); reset(); playing = true; };
if (import.meta.env.DEV) {
  (window as any).__gm = {
    tap, raised, pinUp,
    seat(r: number, c: number, pw = false) { pins[r][c] = true; seats[r][c] = { id: nextId++, power: pw, hold: 0, ang: 0, on: false, srcConn: false, earned: false, lvl: raised(r, c) ? 1 : 0 }; },
    setPin(r: number, c: number, v: boolean) { if (inG(r, c)) pins[r][c] = v; else edge.set(r + ',' + c, v); },
    addBin(n: number) { bin += n; },
    get state() { return { score, anteLeft, queue, bin, credit, spawned, lost, over, won, reclaims, wms: wms.map(w => ({ ...w })), mill, ox, oy, cs, seats: seats.flatMap((row, r) => row.map((s, c) => s && { r, c, lvl: s.lvl, on: s.on })).filter(Boolean) }; },
  };
}
