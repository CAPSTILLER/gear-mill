const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const N = 10, ANTE = 50, SPAWN = 0.5, POWER_HOLD = 15;
let W = 0, H = 0, cs = 0, ox = 0, oy = 0, rackY = 0, dpr = 1;
type Seat = { power: boolean; hold: number; ang: number; on: boolean; srcConn: boolean };
type Gear = { x: number; y: number; vx: number; vy: number; ang: number; va: number; power: boolean; phase: 'rack' | 'fall'; dir: number; dropX: number; stuck?: number };
let posts: boolean[][], sq: boolean[][], seats: (Seat | null)[][], gears: Gear[];
let drive = { r: 0, c: 0 }, mill = { r: 0, c: 0 };
let spawned = 0, lost = 0, spawnT = 0, score = 0, time = 0, over = false, won = false, playing = false, flash = 0, driveAng = 0, millAng = 0, millSpin = 0;
let best = +(localStorage.getItem('gearmill.best') || 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const ri = (a: number, b: number) => Math.floor(rnd(a, b + 1));

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = Math.min(window.innerWidth, 520); H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cs = Math.min((W - 24) / N, (H - 190) / N);
  ox = (W - cs * N) / 2; rackY = 92; oy = rackY + cs * 0.9;
}
window.addEventListener('resize', resize); resize();

function reset() {
  posts = Array.from({ length: N + 1 }, () => Array(N + 1).fill(true));
  sq = Array.from({ length: N }, () => Array(N).fill(false));
  seats = Array.from({ length: N }, () => Array(N).fill(null));
  gears = []; spawned = lost = 0; spawnT = 0; score = 0; time = 0; over = won = false; flash = 0; millSpin = 0;
  drive = { r: ri(0, 1), c: ri(0, N - 1) };
  mill = { r: ri(N - 2, N - 1), c: drive.c < N / 2 ? ri(N / 2, N - 1) : ri(0, N / 2 - 1) };
  sq[drive.r][drive.c] = sq[mill.r][mill.c] = true;
}
const locked = (r: number, c: number) => (r === drive.r && c === drive.c) || (r === mill.r && c === mill.c);
const postLocked = (pr: number, pc: number) => [drive, mill].some(s => (pr === s.r || pr === s.r + 1) && (pc === s.c || pc === s.c + 1));
const pinsUp = () => sq.flat().filter(Boolean).length;
const cx = (c: number) => ox + (c + 0.5) * cs, cy = (r: number) => oy + (r + 0.5) * cs;

function releaseSeat(r: number, c: number) {
  const s = seats[r][c]; if (!s) return; seats[r][c] = null;
  gears.push({ x: cx(c), y: cy(r), vx: rnd(-20, 20), vy: 10, ang: s.ang, va: 0, power: s.power, phase: 'fall', dir: 0, dropX: 0 });
}
function tap(px: number, py: number) {
  if (!playing || over) return;
  const fx = (px - ox) / cs, fy = (py - oy) / cs;
  const pc = Math.round(fx), pr = Math.round(fy);
  if (pr >= 0 && pr <= N && pc >= 0 && pc <= N && Math.hypot(fx - pc, fy - pr) < 0.27) {
    if (postLocked(pr, pc)) return;
    posts[pr][pc] = !posts[pr][pc];
    if (!posts[pr][pc]) for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
      const r = pr + dr, c = pc + dc;
      if (r >= 0 && c >= 0 && r < N && c < N && sq[r][c]) { sq[r][c] = false; releaseSeat(r, c); }
    }
    return;
  }
  const r = Math.floor(fy), c = Math.floor(fx);
  if (r < 0 || c < 0 || r >= N || c >= N || locked(r, c)) return;
  if (sq[r][c]) { sq[r][c] = false; releaseSeat(r, c); }
  else if (posts[r][c] && posts[r][c + 1] && posts[r + 1][c] && posts[r + 1][c + 1]) sq[r][c] = true;
}
cv.addEventListener('pointerdown', e => { const b = cv.getBoundingClientRect(); tap(e.clientX - b.left, e.clientY - b.top); });

function spawn() {
  const left = Math.random() < 0.5;
  gears.push({ x: left ? -cs : W + cs, y: rackY, vx: 0, vy: 0, ang: 0, va: 0, power: Math.random() < 0.13, phase: 'rack', dir: left ? 1 : -1, dropX: rnd(ox + cs * 0.4, ox + cs * (N - 0.4)) });
  spawned++;
}

function power() {
  const node = (r: number, c: number) => (r === drive.r && c === drive.c) || (r === mill.r && c === mill.c) || !!seats[r]?.[c];
  const bfs = (starts: [number, number][]) => {
    const seen = new Set<string>(), q = [...starts]; starts.forEach(([r, c]) => seen.add(r + ',' + c));
    while (q.length) { const [r, c] = q.shift()!; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc, k = nr + ',' + nc;
      if (nr >= 0 && nc >= 0 && nr < N && nc < N && !seen.has(k) && node(nr, nc)) { seen.add(k); q.push([nr, nc]); } } }
    return seen;
  };
  const fromDrive = bfs([[drive.r, drive.c]]);
  const srcs: [number, number][] = [[drive.r, drive.c]];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (!s) continue;
    s.srcConn = fromDrive.has(r + ',' + c); if (s.power && s.srcConn) s.hold = POWER_HOLD; if (s.power && s.hold > 0) srcs.push([r, c]); }
  const live = bfs(srcs);
  let n = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (s) { s.on = live.has(r + ',' + c); if (s.on) n++; } }
  return { n, millOn: live.has(mill.r + ',' + mill.c) };
}

function step(dt: number) {
  driveAng += dt * 2;
  if (!playing) return;
  if (over) { millAng += dt * millSpin; flash = Math.max(0, flash - dt); return; }
  time += dt;
  spawnT -= dt;
  if (spawnT <= 0 && spawned < ANTE) { spawn(); spawnT += SPAWN; }
  const rollV = cs * (1.5 + pinsUp() * 0.12), g = cs * 9;
  for (const gr of gears) {
    if (gr.phase === 'rack') {
      gr.x += gr.dir * rollV * dt; gr.ang += gr.dir * rollV * dt / (cs * 0.42);
      if ((gr.dir > 0 && gr.x >= gr.dropX) || (gr.dir < 0 && gr.x <= gr.dropX)) { gr.phase = 'fall'; gr.vx = gr.dir * rollV * 0.3; gr.vy = 0; gr.va = gr.dir * 4; }
      continue;
    }
    gr.vy += g * dt; gr.vx += rnd(-1, 1) * cs * 2 * dt; gr.vx *= 0.995;
    gr.x += gr.vx * dt; gr.y += gr.vy * dt; gr.ang += gr.va * dt;
    const R = cs * 0.42;
    if (gr.x < ox + R) { gr.x = ox + R; gr.vx = Math.abs(gr.vx) * 0.5; }
    if (gr.x > ox + N * cs - R) { gr.x = ox + N * cs - R; gr.vx = -Math.abs(gr.vx) * 0.5; }
    // seat on raised free pin
    const c = Math.floor((gr.x - ox) / cs), r = Math.floor((gr.y - oy) / cs);
    if (r >= 0 && r < N && c >= 0 && c < N && sq[r][c] && !seats[r][c] && !locked(r, c) && Math.hypot(gr.x - cx(c), gr.y - cy(r)) < cs * 0.3) {
      seats[r][c] = { power: gr.power, hold: 0, ang: gr.ang, on: false, srcConn: false }; (gr as any).dead = true; continue;
    }
    // collide with raised posts and occupied pins
    const colliders: [number, number, number][] = [];
    for (let pr = Math.max(0, r - 1); pr <= Math.min(N, r + 2); pr++) for (let pc = Math.max(0, c - 1); pc <= Math.min(N, c + 2); pc++)
      if (posts[pr]?.[pc]) colliders.push([ox + pc * cs, oy + pr * cs, cs * 0.07]);
    for (let rr = Math.max(0, r - 1); rr <= Math.min(N - 1, r + 1); rr++) for (let cc = Math.max(0, c - 1); cc <= Math.min(N - 1, c + 1); cc++)
      if (seats[rr][cc] || locked(rr, cc)) colliders.push([cx(cc), cy(rr), cs * 0.45]);
    for (const [px, py, pr] of colliders) {
      const dx = gr.x - px, dy = gr.y - py, d = Math.hypot(dx, dy), m = R + pr;
      if (d < m && d > 0.01) { const nx = dx / d, ny = dy / d; gr.x = px + nx * m; gr.y = py + ny * m;
        const vn = gr.vx * nx + gr.vy * ny; if (vn < 0) { gr.vx -= 1.5 * vn * nx; gr.vy -= 1.5 * vn * ny; gr.vx += rnd(-0.3, 0.3) * cs; gr.va = rnd(-6, 6); } }
    }
    if (Math.hypot(gr.vx, gr.vy) < cs * 0.8) { gr.stuck = (gr.stuck || 0) + dt; if (gr.stuck > 0.6) { gr.vx += (Math.random() < 0.5 ? -1 : 1) * cs * 3; } if (gr.stuck > 3) { (gr as any).dead = true; lost++; continue; } } else gr.stuck = Math.max(0, (gr.stuck || 0) - dt);
    if (gr.y > oy + N * cs + cs * 0.6) { (gr as any).dead = true; lost++; }
  }
  gears = gears.filter(g => !(g as any).dead);
  for (const row of seats) for (const s of row) if (s && s.power && !s.srcConn && s.hold > 0) s.hold = Math.max(0, s.hold - dt);
  const p = power();
  score += p.n * dt;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (s?.on) s.ang += dt * 2 * ((r + c - drive.r - drive.c) % 2 ? -1 : 1); }
  if (p.millOn) finish(true);
  else if (spawned >= ANTE && gears.length === 0) finish(false);
}
function finish(w: boolean) {
  over = true; won = w; millSpin = w ? 6 : 0; flash = w ? 1.5 : 0;
  const bonus = w ? 100 + (ANTE - spawned) * 10 : 0; score += bonus;
  const fs = Math.floor(score); if (fs > best) { best = fs; localStorage.setItem('gearmill.best', '' + best); }
  setTimeout(() => {
    (document.getElementById('ot')!).textContent = w ? '⚙ MILL CONNECTED!' : 'OUT OF GEARS';
    (document.getElementById('os')!).innerHTML = `Score <b>${fs}</b>${w ? ` (incl. +${bonus} bonus)` : ''}<br>Gears used ${spawned}/${ANTE} · lost ${lost}<br>Time ${time.toFixed(1)}s<br>Best ${best}`;
    document.getElementById('over')!.classList.remove('h');
  }, w ? 1500 : 300);
}

function gearPath(x: number, y: number, R: number, teeth: number, ang: number) {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) { const a = ang + (i / (teeth * 2)) * Math.PI * 2, a2 = ang + ((i + 1) / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? R * 0.82 : R;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); ctx.lineTo(x + Math.cos(a2) * rr, y + Math.sin(a2) * rr); }
  ctx.closePath();
}
function drawGear(x: number, y: number, ang: number, pw: boolean, on: boolean, hold = 0) {
  const R = cs * 0.5;
  if (pw) { ctx.shadowColor = '#5fe0ff'; ctx.shadowBlur = on ? 14 : 6; }
  const gd = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
  gd.addColorStop(0, pw ? '#c8f6ff' : '#e8ecf0'); gd.addColorStop(1, pw ? '#1d8fb0' : (on ? '#8a6a2a' : '#5b6370'));
  ctx.fillStyle = gd; gearPath(x, y, R, 10, ang); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#20262e'; ctx.beginPath(); ctx.arc(x, y, R * 0.28, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = '#0b0d10'; ctx.fillRect(-R * 0.07, -R * 0.62, R * 0.14, R * 0.36); ctx.restore(); // slot
  if (hold > 0) { ctx.strokeStyle = '#5fe0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R * 1.05, -Math.PI / 2, -Math.PI / 2 + (hold / POWER_HOLD) * Math.PI * 2); ctx.stroke(); }
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
  // HUD
  ctx.fillStyle = '#f0b44c'; ctx.font = 'bold 18px system-ui'; ctx.fillText('⚙ GEAR MILL', 10, 24);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#dfe6ee';
  ctx.fillText(`Score ${Math.floor(score)}`, 10, 46); ctx.fillText(`Gears ${ANTE - spawned}/${ANTE}`, 100, 46);
  ctx.fillText(`Pins up ${pinsUp()}`, 200, 46); ctx.fillText(`Best ${best}`, 290, 46); ctx.fillText(`${time.toFixed(0)}s`, W - 40, 24);
  // rack / pinion
  ctx.fillStyle = '#3a4250'; ctx.fillRect(0, rackY + cs * 0.42, W, 6);
  ctx.fillStyle = '#6b7585'; for (let x = 0; x < W; x += 8) ctx.fillRect(x, rackY + cs * 0.42 - 3, 4, 3);
  // board (tilted slab): trapezoid shading
  const bw = cs * N;
  const bg = ctx.createLinearGradient(0, oy, 0, oy + bw); bg.addColorStop(0, '#2a3038'); bg.addColorStop(1, '#14181d');
  ctx.fillStyle = bg; ctx.fillRect(ox - 6, oy - 6, bw + 12, bw + 12);
  ctx.strokeStyle = '#4a5260'; ctx.lineWidth = 2; ctx.strokeRect(ox - 6, oy - 6, bw + 12, bw + 12);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x = ox + c * cs, y = oy + r * cs;
    if (sq[r][c]) { ctx.fillStyle = '#4c5563'; ctx.fillRect(x + 3, y + 3, cs - 6, cs - 6); ctx.fillStyle = '#69758a'; ctx.fillRect(x + 3, y + 3, cs - 6, 3); }
    else { ctx.fillStyle = '#101317'; ctx.fillRect(x + 3, y + 3, cs - 6, cs - 6); }
    ctx.fillStyle = sq[r][c] ? '#d8dde4' : '#2c323a'; ctx.beginPath(); ctx.arc(x + cs / 2, y + cs / 2, sq[r][c] ? cs * 0.09 : cs * 0.06, 0, 7); ctx.fill();
  }
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    ctx.fillStyle = posts[r][c] ? (postLocked(r, c) ? '#f0b44c' : '#9aa4b2') : '#262b32';
    ctx.beginPath(); ctx.arc(ox + c * cs, oy + r * cs, posts[r][c] ? cs * 0.09 : cs * 0.06, 0, 7); ctx.fill();
  }
  ctx.fillStyle = 'rgba(240,180,76,.35)'; ctx.font = '11px system-ui'; ctx.fillText('▼ slope ▼', W / 2 - 25, oy + bw + 22);
  // bin
  ctx.fillStyle = '#1c2128'; ctx.fillRect(ox, oy + bw + 28, bw, 24); ctx.fillStyle = '#7a8494'; ctx.fillText(`BIN · lost ${lost}`, ox + 8, oy + bw + 44);
  // seated
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const s = seats[r][c]; if (s) drawGear(cx(c), cy(r), s.ang, s.power, s.on, s.power && !s.srcConn ? s.hold : 0); }
  // drive windmill
  const dx = cx(drive.c), dy = cy(drive.r);
  drawGear(dx, dy, driveAng, false, true);
  ctx.save(); ctx.translate(dx, dy); ctx.rotate(driveAng); ctx.fillStyle = '#e9e2cf';
  for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-cs * 0.06, -cs * 0.85, cs * 0.12, cs * 0.6); ctx.strokeStyle = '#8a7a50'; ctx.strokeRect(-cs * 0.06, -cs * 0.85, cs * 0.12, cs * 0.6); }
  ctx.restore();
  // mill
  const mx = cx(mill.c), my = cy(mill.r);
  drawGear(mx, my, millAng, false, won);
  ctx.fillStyle = won ? '#f0b44c' : '#8b5a2b'; ctx.fillRect(mx - cs * 0.22, my - cs * 0.22, cs * 0.44, cs * 0.44);
  ctx.fillStyle = '#111'; ctx.font = `bold ${cs * 0.28}px system-ui`; ctx.fillText('M', mx - cs * 0.12, my + cs * 0.1);
  // falling
  for (const g of gears) drawGear(g.x, g.y, g.ang, g.power, false);
  if (flash > 0) { ctx.fillStyle = `rgba(255,220,120,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
}
let last = performance.now();
function loop(t: number) { const dt = Math.min(0.05, (t - last) / 1000); last = t; step(dt); draw(); requestAnimationFrame(loop); }
reset(); requestAnimationFrame(loop);
document.getElementById('go')!.onclick = () => { document.getElementById('help')!.classList.add('h'); reset(); playing = true; };
document.getElementById('again')!.onclick = () => { document.getElementById('over')!.classList.add('h'); reset(); playing = true; };
(window as any).__gm = { tap, seat(r: number, c: number, pw = false) { sq[r][c] = true; seats[r][c] = { power: pw, hold: 0, ang: 0, on: false, srcConn: false }; }, get state() { return { score, spawned, lost, over, won, drive, mill, ox, oy, cs }; } };
