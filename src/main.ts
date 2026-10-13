const N = 10, ANTE = 50, DROP_MS = 500, PU_HOLD = 15, PU_CHANCE = 0.12;
const cv = document.getElementById('cv') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const ov = document.getElementById('ov')!, ovc = document.getElementById('ovc')!;
let W = 0, H = 0, C = 0, OX = 0, OY = 0, RACKY = 0, DPR = 1;

type Gear = { x: number; y: number; vx: number; vy: number; a: number; va: number; pu: boolean; seat: number; puUntil: number; turning: boolean; dir: number; dead?: boolean; onRack: boolean; rdir: number; dropX: number; stuck?: number; ghost?: boolean };
let posts: boolean[][], sq: boolean[][], gears: Gear[], seatAt: Map<number, Gear>;
let drive = 0, mill = 0, remaining = 0, score = 0, t = 0, spawnT = 0, over = false, won = false, flash = 0, lost = 0, millA = 0, windA = 0, running = false;
let best = +(localStorage.getItem('gearmill_best') || 0);

const idx = (i: number, j: number) => j * N + i;
const ij = (k: number) => [k % N, Math.floor(k / N)];
const sqLocked = (k: number) => k === drive || k === mill;
const postLocked = (pi: number, pj: number) => [drive, mill].some(k => { const [i, j] = ij(k); return (pi === i || pi === i + 1) && (pj === j || pj === j + 1); });
const cellCenter = (k: number) => { const [i, j] = ij(k); return [OX + (i + .5) * C, OY + (j + .5) * C]; };
const pinsUp = () => { let n = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (sq[j][i]) n++; return n; };

function layout() {
  DPR = window.devicePixelRatio || 1; W = Math.min(innerWidth, 520); H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  C = Math.min((W - 24) / N, (H - 200) / (N + 1.6)); OX = (W - C * N) / 2; RACKY = 92; OY = RACKY + C * 1.1;
}

function reset() {
  posts = Array.from({ length: N + 1 }, () => Array(N + 1).fill(false));
  sq = Array.from({ length: N }, () => Array(N).fill(false));
  gears = []; seatAt = new Map();
  // drive windmill in lower half, mill in upper rows (opposite side)
  const di = Math.floor(Math.random() * N), dj = 6 + Math.floor(Math.random() * 4);
  let mi = Math.floor(Math.random() * N); if (Math.abs(mi - di) < 3) mi = (mi + 5) % N;
  const mj = Math.floor(Math.random() * 2);
  drive = idx(di, dj); mill = idx(mi, mj);
  for (const k of [drive, mill]) { const [i, j] = ij(k); sq[j][i] = true; posts[j][i] = posts[j][i + 1] = posts[j + 1][i] = posts[j + 1][i + 1] = true; }
  remaining = ANTE; score = 0; t = 0; spawnT = 0; over = false; won = false; flash = 0; lost = 0;
}

function canRaise(i: number, j: number) { return posts[j][i] && posts[j][i + 1] && posts[j + 1][i] && posts[j + 1][i + 1]; }
function lowerSquare(i: number, j: number) {
  sq[j][i] = false; const k = idx(i, j); const g = seatAt.get(k);
  if (g) { seatAt.delete(k); g.seat = -1; g.vy = 40; g.vx = (Math.random() - .5) * 60; g.turning = false; }
}
function tap(px: number, py: number) {
  if (over || !running) return;
  const fx = (px - OX) / C, fy = (py - OY) / C;
  if (fx < -.35 || fy < -.35 || fx > N + .35 || fy > N + .35) return;
  const pi = Math.round(fx), pj = Math.round(fy);
  if (Math.hypot(fx - pi, fy - pj) < .3) { // post
    if (postLocked(pi, pj)) return;
    posts[pj][pi] = !posts[pj][pi];
    if (!posts[pj][pi]) for (const [i, j] of [[pi - 1, pj - 1], [pi, pj - 1], [pi - 1, pj], [pi, pj]]) if (i >= 0 && j >= 0 && i < N && j < N && sq[j][i] && !sqLocked(idx(i, j))) lowerSquare(i, j);
    return;
  }
  const i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i >= N || j >= N || sqLocked(idx(i, j))) return;
  if (sq[j][i]) lowerSquare(i, j); else if (canRaise(i, j)) sq[j][i] = true; else flashBad = { i, j, t: .4 };
}
let flashBad: { i: number; j: number; t: number } | null = null;

function spawn() {
  const left = Math.random() < .5, r = C * .5;
  gears.push({ x: left ? -r : W + r, y: RACKY, vx: 0, vy: 0, a: 0, va: 0, pu: Math.random() < PU_CHANCE, seat: -1, puUntil: 0, turning: false, dir: 1, onRack: true, rdir: left ? 1 : -1, dropX: OX + r * .6 + Math.random() * (C * N - r * 1.2) });
  remaining--;
}

function power() {
  // BFS from drive + any power-up still within its 15s hold
  const on = new Set<number>(); const q: number[] = [];
  const nb = (k: number) => { const [i, j] = ij(k); return [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N).map(([a, b]) => idx(a, b)); };
  const has = (k: number) => k === drive || k === mill || seatAt.has(k);
  const bfs = (src: number[]) => { const s = new Set(src); const qq = [...src]; while (qq.length) { const k = qq.shift()!; for (const n of nb(k)) if (!s.has(n) && has(n)) { s.add(n); qq.push(n); } } return s; };
  const fromDrive = bfs([drive]);
  for (const k of fromDrive) { const g = seatAt.get(k); if (g && g.pu) g.puUntil = t + PU_HOLD; }
  const srcs = [drive]; for (const [k, g] of seatAt) if (g.pu && g.puUntil > t) srcs.push(k);
  for (const k of bfs(srcs)) on.add(k); void q;
  return { on, connected: fromDrive.has(mill) };
}

function step(dt: number) {
  windA += dt * 3; if (won) millA += dt * 6;
  if (flashBad) { flashBad.t -= dt; if (flashBad.t <= 0) flashBad = null; }
  if (flash > 0) flash -= dt;
  if (over || !running) return;
  t += dt; spawnT += dt * 1000;
  while (spawnT >= DROP_MS && remaining > 0) { spawnT -= DROP_MS; spawn(); }
  const rackSpeed = C * (1.5 + pinsUp() * .12) * 1.2;
  const g0 = C * 9, r = C * .5;
  for (const g of gears) {
    if (g.dead || g.seat >= 0) continue;
    if (g.onRack) {
      g.x += g.rdir * rackSpeed * dt; g.a += g.rdir * rackSpeed * dt / r;
      if ((g.rdir > 0 && g.x >= g.dropX) || (g.rdir < 0 && g.x <= g.dropX)) { g.onRack = false; g.vx = g.rdir * rackSpeed * .3; g.vy = 0; g.va = g.rdir * 4; }
      continue;
    }
    g.vy += g0 * dt; g.vx += (Math.random() - .5) * C * 6 * dt; g.vx *= .995;
    g.x += g.vx * dt; g.y += g.vy * dt; g.a += g.va * dt;
    if (g.x < OX + r * .5) { g.x = OX + r * .5; g.vx = Math.abs(g.vx) * .5; }
    if (g.x > OX + N * C - r * .5) { g.x = OX + N * C - r * .5; g.vx = -Math.abs(g.vx) * .5; }
    const spd = Math.hypot(g.vx, g.vy); g.stuck = spd < C * .8 ? (g.stuck || 0) + dt : 0; if (g.stuck > 2) g.ghost = true;
    if (g.y > OY - r * .3 && !g.ghost) {
      // seat check: slot snaps onto a raised, free pin
      const i = Math.floor((g.x - OX) / C), j = Math.floor((g.y - OY) / C);
      if (i >= 0 && j >= 0 && i < N && j < N) {
        const k = idx(i, j), [cx, cy] = cellCenter(k);
        if (sq[j][i] && !sqLocked(k) && !seatAt.has(k) && Math.hypot(g.x - cx, g.y - cy) < C * .28) { g.seat = k; g.x = cx; g.y = cy; seatAt.set(k, g); continue; }
      }
      // bounce off raised pins/seated gears (small obstacles) and raised posts
      for (let jj = Math.max(0, j - 1); jj <= Math.min(N - 1, j + 1); jj++) for (let ii = Math.max(0, i - 1); ii <= Math.min(N - 1, i + 1); ii++) {
        const k = idx(ii, jj); if (!sq[jj][ii]) continue;
        const occ = seatAt.has(k) || sqLocked(k); const [cx, cy] = cellCenter(k);
        const rr = occ ? C * .95 : C * .55; const dx = g.x - cx, dy = g.y - cy, d = Math.hypot(dx, dy);
        if (occ && d < rr && d > 0.01) { const nx = dx / d, ny = dy / d; g.x = cx + nx * rr; g.y = cy + ny * rr; const vn = g.vx * nx + g.vy * ny; if (vn < 0) { g.vx -= 1.6 * vn * nx; g.vy -= 1.6 * vn * ny; } g.va += (Math.random() - .5) * 8; }
      }
      for (let pj = Math.max(0, j); pj <= Math.min(N, j + 1); pj++) for (let pi = Math.max(0, i); pi <= Math.min(N, i + 1); pi++) {
        if (!posts[pj][pi]) continue; const px = OX + pi * C, py = OY + pj * C, dx = g.x - px, dy = g.y - py, d = Math.hypot(dx, dy), rr = r * .55;
        if (d < rr && d > 0.01) { const nx = dx / d, ny = dy / d; g.x = px + nx * rr; g.y = py + ny * rr; const vn = g.vx * nx + g.vy * ny; if (vn < 0) { g.vx -= 1.5 * vn * nx; g.vy -= 1.5 * vn * ny; } g.vx += (Math.random() - .5) * C; }
      }
    }
    if (g.ghost) g.vx *= .9;
    if (g.y > OY + N * C + r) { g.dead = true; lost++; }
  }
  gears = gears.filter(g => !g.dead);
  const { on, connected } = power();
  let turning = 0;
  for (const [k, g] of seatAt) { const [i, j] = ij(k); g.turning = on.has(k); g.dir = (i + j) % 2 === 0 ? 1 : -1; if (g.turning) { turning++; g.a += g.dir * dt * 2.4; } }
  score += turning * dt;
  const [di, dj] = ij(drive); void di; void dj;
  if (connected) { won = true; over = true; score += 500 + remaining * 10; flash = 1.2; end(); }
  else if (remaining <= 0 && gears.every(g => g.seat >= 0)) { over = true; end(); }
}

function end() {
  const s = Math.floor(score); if (s > best) { best = s; localStorage.setItem('gearmill_best', '' + s); }
  setTimeout(() => showOverlay(`<h2>${won ? 'MILL CONNECTED!' : 'ANTE SPENT'}</h2>
  ${won ? '<p>Drive train reached the mill. Bonus +500 and +10 per unused gear.</p>' : '<p>All 50 gears are used.</p>'}
  <p>Score: <b>${s}</b><br>Gears used: ${ANTE - remaining} / ${ANTE} (lost to bin: ${lost})<br>Time: ${t.toFixed(1)} s<br>Best: ${best}</p>
  <button id="go">Restart</button>`), won ? 1300 : 300);
}

function gearPath(x: number, y: number, r: number, a: number, teeth: number) {
  ctx.beginPath();
  for (let n = 0; n < teeth * 2; n++) { const ang = a + n * Math.PI / teeth, rr = n % 2 ? r * .82 : r; ctx.lineTo(x + Math.cos(ang - .12) * rr, y + Math.sin(ang - .12) * rr); ctx.lineTo(x + Math.cos(ang + .12) * rr, y + Math.sin(ang + .12) * rr); }
  ctx.closePath();
}
function drawGear(g: Gear) {
  ctx.globalAlpha = g.ghost ? .45 : 1;
  const r = C * .52; const grd = ctx.createRadialGradient(g.x - r * .3, g.y - r * .3, r * .1, g.x, g.y, r);
  if (g.pu) { grd.addColorStop(0, '#ffe9a0'); grd.addColorStop(1, '#c8902a'); } else { grd.addColorStop(0, '#e6e9ee'); grd.addColorStop(1, '#6b737e'); }
  gearPath(g.x, g.y, r, g.a, 10); ctx.fillStyle = grd; ctx.fill(); ctx.strokeStyle = g.turning ? (g.pu ? '#fff3b0' : '#7fd7ff') : '#2a2e34'; ctx.lineWidth = g.turning ? 2 : 1; ctx.stroke();
  ctx.fillStyle = '#1a1d22'; ctx.beginPath(); ctx.arc(g.x, g.y, r * .3, 0, 7); ctx.fill();
  // slot
  ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a); ctx.fillStyle = '#0b0d10'; ctx.fillRect(-r * .08, -r * .62, r * .16, r * .36); ctx.restore();
  ctx.fillStyle = '#9aa2ad'; ctx.beginPath(); ctx.arc(g.x, g.y, r * .12, 0, 7); ctx.fill();
  if (g.pu && g.seat >= 0 && g.puUntil > t && g.turning) { ctx.fillStyle = '#ffe9a0'; ctx.font = `bold ${C * .28}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(Math.ceil(g.puUntil - t) + '', g.x, g.y - r - 2); }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
  // HUD
  ctx.fillStyle = '#e8b04a'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'left'; ctx.fillText('GEAR MILL', 10, 24);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#ccc';
  const turning = [...seatAt.values()].filter(g => g.turning).length;
  ctx.fillText(`Score ${Math.floor(score)}   Best ${best}`, 10, 44);
  ctx.fillText(`Ante ${remaining}/${ANTE}   Turning ${turning}   Pins up ${pinsUp()}   ${t.toFixed(0)}s`, 10, 62);
  // pinion rack
  ctx.fillStyle = '#3a3f47'; ctx.fillRect(0, RACKY + C * .45, W, C * .18);
  ctx.fillStyle = '#5a616b'; for (let x = 0; x < W; x += C * .3) ctx.fillRect(x, RACKY + C * .38, C * .15, C * .1);
  // tilted board: darker at top, lighter at bottom, with slope chevrons
  const bw = C * N, g = ctx.createLinearGradient(0, OY, 0, OY + bw); g.addColorStop(0, '#14171c'); g.addColorStop(1, '#232830');
  ctx.fillStyle = g; ctx.fillRect(OX - 6, OY - 6, bw + 12, bw + 12); ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 2; ctx.strokeRect(OX - 6, OY - 6, bw + 12, bw + 12);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = OX + i * C, y = OY + j * C;
    if (sq[j][i]) { ctx.fillStyle = '#3d4450'; ctx.fillRect(x + 3, y + 3, C - 6, C - 6); ctx.fillStyle = '#566070'; ctx.fillRect(x + 3, y + 3, C - 6, 3); }
    else { ctx.fillStyle = '#101317'; ctx.fillRect(x + 4, y + 4, C - 8, C - 8); ctx.fillStyle = '#1c2026'; ctx.font = `${C * .3}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('v', x + C / 2, y + C * .62); }
    if (flashBad && flashBad.i === i && flashBad.j === j) { ctx.strokeStyle = '#e04848'; ctx.lineWidth = 2; ctx.strokeRect(x + 3, y + 3, C - 6, C - 6); }
    const k = idx(i, j);
    if (sq[j][i] && !seatAt.has(k) && !sqLocked(k)) { ctx.fillStyle = '#c9ced6'; ctx.beginPath(); ctx.arc(x + C / 2, y + C / 2, C * .09, 0, 7); ctx.fill(); }
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = OX + i * C, y = OY + j * C, up = posts[j][i];
    ctx.fillStyle = up ? (postLocked(i, j) ? '#c8902a' : '#a9b0ba') : '#2b3038'; ctx.beginPath(); ctx.arc(x, y, up ? C * .11 : C * .07, 0, 7); ctx.fill();
  }
  const { on } = (over ? { on: new Set<number>() } : power());
  // drive windmill
  { const [x, y] = cellCenter(drive); gearPath(x, y, C * .52, -windA * .5, 10); ctx.fillStyle = '#c8902a'; ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(windA); ctx.fillStyle = '#f0e6d0';
    for (let n = 0; n < 4; n++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-C * .06, -C * .75, C * .12, C * .6); ctx.fillStyle = '#d8ccb0'; }
    ctx.restore(); ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x, y, C * .1, 0, 7); ctx.fill(); }
  // mill
  { const [x, y] = cellCenter(mill); gearPath(x, y, C * .52, millA, 10); ctx.fillStyle = won ? '#7fd7ff' : '#55606e'; ctx.fill(); ctx.strokeStyle = '#7fd7ff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.translate(x, y); ctx.rotate(millA * 2); ctx.fillStyle = '#20252c'; ctx.fillRect(-C * .2, -C * .2, C * .4, C * .4); ctx.restore();
    ctx.fillStyle = '#7fd7ff'; ctx.font = `bold ${C * .26}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('MILL', x, y - C * .6); void on; }
  for (const gg of gears) drawGear(gg);
  // bin
  const by = OY + C * N + 10; ctx.fillStyle = '#1a1d22'; ctx.fillRect(OX, by, C * N, 26); ctx.strokeStyle = '#4a4f57'; ctx.strokeRect(OX, by, C * N, 26);
  ctx.fillStyle = '#888'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`collection bin · lost ${lost}`, W / 2, by + 17);
  if (flash > 0) { ctx.fillStyle = `rgba(127,215,255,${flash * .5})`; ctx.fillRect(0, 0, W, H); }
}

function showOverlay(html: string) { ovc.innerHTML = html; ov.style.display = 'flex'; running = false; document.getElementById('go')!.onclick = () => { ov.style.display = 'none'; if (over) reset(); running = true; }; }
const HELP = `<h2>GEAR MILL</h2>
<p>Link gears from the <b style="color:#e8b04a">windmill</b> to the <b style="color:#7fd7ff">MILL</b>.</p>
<p>• Tap a <b>post</b> (corner dot) to raise/lower it.<br>• Tap a <b>square</b> to raise it — only when all 4 corner posts are up. Raising a square raises its pin.<br>• Falling gears slot onto raised pins. Neighbouring gears mesh and turn when linked to the windmill.<br>• <b style="color:#e8b04a">Gold</b> power-up gears keep driving for 15 s after being cut off.<br>• More pins up = gears roll in faster.<br>• +1 point per turning gear per second. 50 gears per game. Connecting the mill ends the game with +500 bonus.</p>
<button id="go">Play</button>`;
document.getElementById('help')!.onclick = () => { if (!over) showOverlay(HELP.replace('Play', 'Resume')); };
cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top); });
addEventListener('resize', () => { layout(); });
layout(); reset(); showOverlay(HELP);
(window as any).__gm = { get state() { return { score, remaining, over, won, seated: seatAt.size }; }, tap, cellCenter: (i: number, j: number) => cellCenter(idx(i, j)), post: (i: number, j: number) => [OX + i * C, OY + j * C], drive: () => ij(drive), mill: () => ij(mill), place: (i: number, j: number, pu = false) => { const k = idx(i, j); if (seatAt.has(k) || sqLocked(k)) return; const [x, y] = cellCenter(k); posts[j][i] = posts[j][i + 1] = posts[j + 1][i] = posts[j + 1][i + 1] = true; sq[j][i] = true; const g: Gear = { x, y, vx: 0, vy: 0, a: 0, va: 0, pu, seat: k, puUntil: 0, turning: false, dir: 1, onRack: false, rdir: 1, dropX: 0 }; seatAt.set(k, g); gears.push(g); }, start: () => { ov.style.display = 'none'; running = true; } };
let last = performance.now();
function loop(now: number) { const dt = Math.min(.05, (now - last) / 1000); last = now; step(dt); draw(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
