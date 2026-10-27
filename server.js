const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// ---- Game constants ----
const W = 1600, H = 1000;
const TICK = 60, SEND_RATE = 30;
const TURN = 4.2, THRUST = 520, REVERSE = 300, DRAG = 0.985, MAX_SPEED = 520;
const BULLET_SPEED = 900, BULLET_LIFE = 1.1, FIRE_COOLDOWN = 0.22;
const SHIP_R = 16, MAX_HP = 3, RESPAWN_TIME = 2.5, SPAWN_SHIELD = 2;
const COLORS = ['#00f0ff', '#ff2bd6', '#7cff4f', '#ffb000', '#9d7bff', '#ff4f5e', '#4fffc4', '#fff04f'];

const players = {};
let bullets = [];
let bulletId = 0, colorIdx = 0;

function wrap(o) {
  if (o.x < 0) o.x += W; else if (o.x >= W) o.x -= W;
  if (o.y < 0) o.y += H; else if (o.y >= H) o.y -= H;
}
function wrapDist2(a, b) {
  let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  if (dx > W / 2) dx = W - dx;
  if (dy > H / 2) dy = H - dy;
  return dx * dx + dy * dy;
}
function spawn(p) {
  p.x = Math.random() * W; p.y = Math.random() * H;
  p.a = Math.random() * Math.PI * 2;
  p.vx = 0; p.vy = 0; p.hp = MAX_HP;
  p.alive = true; p.shield = SPAWN_SHIELD;
}

io.on('connection', (socket) => {
  const p = {
    id: socket.id,
    name: 'PILOT-' + Math.random().toString(16).slice(2, 6).toUpperCase(),
    color: COLORS[colorIdx++ % COLORS.length],
    score: 0, deaths: 0, cooldown: 0, respawn: 0,
    input: { up: false, down: false, left: false, right: false, fire: false },
  };
  spawn(p);
  players[socket.id] = p;
  socket.emit('welcome', { id: socket.id, w: W, h: H });

  socket.on('input', (inp) => {
    if (!inp || typeof inp !== 'object') return;
    for (const k of ['up', 'down', 'left', 'right', 'fire']) p.input[k] = !!inp[k];
  });
  socket.on('disconnect', () => { delete players[socket.id]; });
});

let events = [];
function step(dt) {
  for (const id in players) {
    const p = players[id];
    if (!p.alive) {
      p.respawn -= dt;
      if (p.respawn <= 0) { spawn(p); events.push({ t: 'spawn', id }); }
      continue;
    }
    const i = p.input;
    if (i.left) p.a -= TURN * dt;
    if (i.right) p.a += TURN * dt;
    const fx = Math.cos(p.a), fy = Math.sin(p.a);
    if (i.up) { p.vx += fx * THRUST * dt; p.vy += fy * THRUST * dt; }
    if (i.down) { p.vx -= fx * REVERSE * dt; p.vy -= fy * REVERSE * dt; }
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > MAX_SPEED) { p.vx *= MAX_SPEED / sp; p.vy *= MAX_SPEED / sp; }
    const drag = Math.pow(DRAG, dt * 60);
    p.vx *= drag; p.vy *= drag;
    p.x += p.vx * dt; p.y += p.vy * dt; wrap(p);
    if (p.shield > 0) p.shield -= dt;

    p.cooldown -= dt;
    if (i.fire && p.cooldown <= 0) {
      p.cooldown = FIRE_COOLDOWN;
      bullets.push({
        id: bulletId++, owner: id, color: p.color,
        x: p.x + fx * (SHIP_R + 4), y: p.y + fy * (SHIP_R + 4),
        vx: fx * BULLET_SPEED + p.vx * 0.5, vy: fy * BULLET_SPEED + p.vy * 0.5,
        life: BULLET_LIFE,
      });
    }
  }

  const survivors = [];
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; wrap(b); b.life -= dt;
    let hit = false;
    for (const id in players) {
      const p = players[id];
      if (id === b.owner || !p.alive || p.shield > 0) continue;
      if (wrapDist2(b, p) < SHIP_R * SHIP_R) {
        hit = true; p.hp--;
        events.push({ t: 'hit', x: b.x, y: b.y, color: p.color });
        if (p.hp <= 0) {
          p.alive = false; p.respawn = RESPAWN_TIME; p.deaths++;
          const killer = players[b.owner];
          if (killer) killer.score++;
          events.push({ t: 'kill', x: p.x, y: p.y, color: p.color,
            victim: p.name, killer: killer ? killer.name : '???' });
        }
        break;
      }
    }
    if (!hit && b.life > 0) survivors.push(b);
  }
  bullets = survivors;
}

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  step(Math.min((now - last) / 1000, 0.05));
  last = now;
}, 1000 / TICK);

setInterval(() => {
  const ps = Object.values(players).map(p => ({
    id: p.id, name: p.name, color: p.color,
    x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
    a: Math.round(p.a * 1000) / 1000, hp: p.hp, alive: p.alive,
    shield: p.shield > 0, thrust: p.alive && p.input.up,
    score: p.score, deaths: p.deaths,
  }));
  const bs = bullets.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), c: b.color }));
  io.emit('state', { p: ps, b: bs, e: events });
  events = [];
}, 1000 / SEND_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Neon Arena running on port ' + PORT));
