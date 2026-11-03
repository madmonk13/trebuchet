/* Trebuchet — a medieval siege physics game.
 * Physics: Matter.js. Rendering: Canvas 2D. Sound: js/audio.js. Levels: js/levels.js.
 */
(() => {
  'use strict';

  const { Engine, Bodies, Body, Bounds, Composite, Events, Sleeping } = Matter;

  // ---------------------------------------------------------------- constants
  const STEP = 1000 / 60;
  const GROUND_Y = 820;
  const TX = 400;                 // trebuchet base centre
  const PIVOT = { x: TX, y: 640 };
  const ARM_LONG = 170;
  const ARM_SHORT = 55;
  const COCKED = (135 * Math.PI) / 180;
  const RELEASE = (300 * Math.PI) / 180;
  const ANCHOR = { x: TX - 58, y: 782 }; // where the rock sits in the sling
  const LAUNCH = { x: PIVOT.x + ARM_LONG * Math.cos(RELEASE), y: PIVOT.y + ARM_LONG * Math.sin(RELEASE) };
  const MAX_PULL = 125;
  const MIN_PULL = 18;
  const MAX_SPEED = 27;
  const GRAVITY_STEP = 0.001 * STEP * STEP; // Matter's per-step gravity acceleration

  const MATERIALS = {
    wood: { density: 0.0018, hp: 70, score: 500, fill: '#a86e36', dark: '#5a3413', light: '#c99155', chip: ['#a86e36', '#7d4a1e', '#c99155'] },
    stone: { density: 0.004, hp: 220, score: 800, fill: '#8d8e93', dark: '#45464b', light: '#b4b5ba', chip: ['#8d8e93', '#6b6c70', '#a9aab0'] },
    straw: { density: 0.0009, hp: 30, score: 300, fill: '#e3c25c', dark: '#8f6a1d', light: '#f4dc8a', chip: ['#e3c25c', '#cfa23e', '#f4dc8a'] },
  };
  const FOES = {
    soldier: { r: 18, hp: 22, score: 5000 },
    knight: { r: 21, hp: 50, score: 7500 },
    king: { r: 26, hp: 90, score: 15000 },
  };
  const ROCKS = {
    stone: { r: 19, density: 0.009, name: 'Stone', hint: '' },
    scatter: { r: 17, density: 0.009, name: 'Scatter Shot', hint: 'tap mid-flight to split' },
    boulder: { r: 28, density: 0.012, name: 'Boulder', hint: 'tap mid-flight to slam down' },
    firepot: { r: 18, density: 0.006, name: 'Fire Pot', hint: 'bursts on impact — or tap' },
    shard: { r: 12, density: 0.012, name: 'Shard', hint: '' },
  };
  const ROCK_BONUS = 10000;

  // ---------------------------------------------------------------- DOM
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    hud: $('hud'), level: $('hud-level'), score: $('hud-score'), hint: $('hint'), toast: $('toast'),
    title: $('screen-title'), levels: $('screen-levels'), pause: $('screen-pause'), result: $('screen-result'),
    grid: $('level-grid'), mute: $('btn-mute'), install: $('btn-install'), iosHint: $('ios-hint'),
    resultTitle: $('result-title'), resultSub: $('result-sub'), resultScore: $('result-score'),
    resultBest: $('result-best'), resultStars: $('result-stars'), next: $('btn-next'), totalStars: $('total-stars'),
    setTabs: $('set-tabs'),
  };

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('trebuchet.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('trebuchet.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  let progress = store.get('progress', {}); // { [levelIndex]: { stars, best } }

  // ---------------------------------------------------------------- level sets
  const SETS = window.LEVEL_SETS || [{ name: 'Campaign', start: 0, count: LEVELS.length }];
  const setOf = (i) => Math.min(SETS.length - 1, Math.max(0, SETS.findIndex((s) => i >= s.start && i < s.start + s.count)));
  const levelLabel = (i) => `${setOf(i) + 1}-${i - SETS[setOf(i)].start + 1}`;
  let viewSet = 0; // the set shown on the level-select screen

  // ---------------------------------------------------------------- state
  let W = 0, H = 0, DPR = 1, scale = 1, viewW = 0, viewH = 0, camX = 0, camY = 0;
  let engine = null, world = null;
  let levelIndex = 0, levelDef = null, levelW = 2000;
  let blocks = [], foes = [], activeRocks = [], particles = [], floaters = [];
  let queue = [], loaded = null;
  let state = 'menu';
  let paused = false;
  let simTime = 0, stateTime = 0, realTime = 0;
  let score = 0, shownScore = -1, foesAlive = 0;
  let graceUntil = 0, flightStart = 0, quietTime = 0, winAt = 0, loseAt = 0, camHoldUntil = 0;
  let abilityUsed = false;
  let launchVel = null, launchFrom = null;
  let shake = 0;
  const arm = { angle: COCKED, from: COCKED, to: COCKED, t: 1, dur: 1, ease: (t) => t, next: null };
  const aim = { active: false, id: null, start: null, vec: { x: 0, y: 0 } };
  const pan = { active: false, id: null, sx: 0, cam: 0 };
  const destroyQueue = new Set();
  const explodeQueue = new Set();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  // Deterministic pseudo-random for per-body decoration.
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------------------------------------------------------------- layout
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const targetH = H < 600 ? 720 : 860;
    scale = Math.min(H / targetH, W / 900);
    viewW = W / scale;
    viewH = H / scale;
    // On tall (portrait) screens, lift the ground off the bottom edge.
    camY = GROUND_Y + 70 + Math.max(0, viewH - 900) * 0.4 - viewH;
    camX = clamp(camX, 0, camMax());
    checkOrientation();
  }
  const camMax = () => Math.max(0, levelW - viewW);
  const toWorld = (cx, cy) => ({ x: cx / scale + camX, y: cy / scale + camY });

  let orientationToastShown = false;
  function checkOrientation() {
    if (!orientationToastShown && H > W * 1.15 && state !== 'menu') {
      orientationToastShown = true;
      toast('Turn your device sideways for a wider battlefield');
    }
  }

  // ---------------------------------------------------------------- level setup
  function newEngine() {
    engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
    engine.gravity.y = 1;
    world = engine.world;
    Events.on(engine, 'beforeUpdate', () => {
      for (const b of Composite.allBodies(world)) {
        if (!b.isStatic) b.plugin.pv = { x: b.velocity.x, y: b.velocity.y };
      }
    });
    Events.on(engine, 'collisionStart', onCollision);
    Events.on(engine, 'collisionActive', onContact);
  }

  function loadLevel(i, menuMode = false) {
    levelIndex = i;
    levelDef = LEVELS[i];
    levelW = levelDef.width;
    newEngine();
    blocks = []; foes = []; activeRocks = []; particles = []; floaters = [];
    destroyQueue.clear(); explodeQueue.clear();
    score = 0; shownScore = -1; winAt = 0; loseAt = 0; abilityUsed = false; shake = 0;
    queue = levelDef.rocks.slice();
    loaded = queue.shift();
    arm.angle = COCKED; arm.t = 1; arm.next = null;
    aim.active = false; pan.active = false;

    const ground = Bodies.rectangle(levelW / 2, GROUND_Y + 150, levelW + 3000, 300, { isStatic: true, friction: 1, label: 'ground' });
    ground.plugin = { kind: 'ground' };
    Composite.add(world, ground);

    for (const it of levelDef.items) {
      if (it.t === 'hill') {
        const b = Bodies.rectangle(it.x, GROUND_Y - it.h / 2, it.w, it.h, { isStatic: true, friction: 1 });
        b.plugin = { kind: 'hill', w: it.w, h: it.h };
        Composite.add(world, b);
      } else if (it.t === 'block') {
        const mat = MATERIALS[it.m];
        const opts = { density: mat.density, friction: 0.7, frictionStatic: 0.9, restitution: 0.02 };
        const b = it.shape === 'tri'
          ? Bodies.fromVertices(it.x, it.y - it.h / 3, [[{ x: -it.w / 2, y: 0 }, { x: it.w / 2, y: 0 }, { x: 0, y: -it.h }]], opts)
          : Bodies.rectangle(it.x, it.y, it.w, it.h, opts);
        b.plugin = { kind: 'block', m: it.m, shape: it.shape, w: it.w, h: it.h, hp: mat.hp, maxHp: mat.hp, alive: true };
        blocks.push(b);
        Composite.add(world, b);
      } else if (it.t === 'foe') {
        const def = FOES[it.k];
        const b = Bodies.circle(it.x, it.y - def.r, def.r, { density: 0.0015, friction: 0.6, restitution: 0.1, frictionAir: 0.008 });
        b.plugin = { kind: 'foe', k: it.k, r: def.r, hp: def.hp, maxHp: def.hp, alive: true, flash: 0 };
        foes.push(b);
        Composite.add(world, b);
      }
    }
    foesAlive = foes.length;
    graceUntil = menuMode ? Infinity : simTime + 1600;

    ui.level.textContent = `${levelLabel(i)} · ${levelDef.name}`;
    if (menuMode) {
      setState('menu');
    } else {
      camX = camMax();
      setState(camMax() > 0 ? 'intro' : 'aim');
      if (levelDef.tip) toast(levelDef.tip, 4200);
    }
    updateHint();
  }

  function setState(s) {
    state = s;
    stateTime = 0;
    updateHint();
  }

  // ---------------------------------------------------------------- damage & collisions
  function bodyMaterial(b) {
    const p = b.plugin;
    if (p.kind === 'block') return p.m;
    if (p.kind === 'rock') return 'stone';
    if (p.kind === 'foe') return 'foe';
    return 'ground';
  }

  // Closing speed of two bodies along the contact normal, from their velocities before this step.
  function impactSpeed(a, b, n) {
    const va = a.isStatic ? { x: 0, y: 0 } : (a.plugin.pv || a.velocity);
    const vb = b.isStatic ? { x: 0, y: 0 } : (b.plugin.pv || b.velocity);
    return Math.abs((va.x - vb.x) * n.x + (va.y - vb.y) * n.y);
  }

  // Contacts that were already touching last step (collisionStart only fires for new ones). A beam
  // that is resting on a foe and gets slammed down, or a collapsing wall pressing into one, arrives
  // here, so foes still take the hit. Blocks are left alone: their strength is tuned around starts.
  function onContact(e) {
    if (state === 'menu' || simTime < graceUntil) return;
    for (const pair of e.pairs) {
      const a = pair.bodyA.parent, b = pair.bodyB.parent;
      const n = pair.collision.normal;
      for (const [f, o] of [[a, b], [b, a]]) {
        if (f.plugin.kind !== 'foe' || !f.plugin.alive || o.isStatic) continue;
        const impact = impactSpeed(a, b, n);
        if (impact >= 1.2) hurt(f, o, impact);
        // Pinned under something heavy: slow squashing never reaches the impact threshold.
        if (o.plugin.kind === 'block' && Math.abs(n.y) > 0.7 && o.position.y < f.position.y - f.plugin.r * 0.5
          && f.speed < 0.6 && o.mass > f.mass * 2) {
          damage(f, o.mass * 0.05);
        }
      }
    }
  }

  function onCollision(e) {
    for (const pair of e.pairs) {
      const a = pair.bodyA.parent, b = pair.bodyB.parent;
      const n = pair.collision.normal;
      const impact = impactSpeed(a, b, n);
      if (impact < 1.2) continue;

      if (state !== 'menu') {
        const ma = bodyMaterial(a), mb = bodyMaterial(b);
        Sfx.hit(ma === 'ground' || ma === 'foe' ? mb : ma, impact);
        if (impact > 5) dust((a.position.x + b.position.x) / 2, (a.position.y + b.position.y) / 2, 2);
      }
      for (const [s, o] of [[a, b], [b, a]]) {
        if (s.plugin.kind === 'rock') {
          s.plugin.hit = true;
          if (s.plugin.type === 'firepot' && impact > 2) explodeQueue.add(s);
        }
      }
      if (simTime < graceUntil) continue;
      hurt(a, b, impact);
      hurt(b, a, impact);
    }
  }

  function hurt(target, other, impact) {
    const p = target.plugin;
    if (!p.alive || p.hp == null) return;
    const m = other.isStatic ? 30 : Math.min(other.mass, 30);
    const dmg = (impact - 2.2) * m;
    if (dmg <= 0) return;
    damage(target, dmg);
  }

  function damage(b, dmg) {
    const p = b.plugin;
    if (!p.alive) return;
    p.hp -= dmg;
    if (p.kind === 'foe') {
      p.flash = 1;
      if (p.hp > 0) Sfx.oof(p.k);
    }
    if (p.hp <= 0) destroyQueue.add(b);
  }

  function destroy(b, silent = false) {
    const p = b.plugin;
    if (!p.alive) return;
    p.alive = false;
    Composite.remove(world, b);
    wakeAround(b);
    if (p.kind === 'block') {
      const pts = MATERIALS[p.m].score;
      score += pts;
      debris(b);
      if (!silent) { Sfx.break(p.m); floater(b.position.x, b.position.y, pts, '#fff4d6'); }
    } else if (p.kind === 'foe') {
      const pts = FOES[p.k].score;
      score += pts;
      foesAlive--;
      poof(b);
      Sfx.oof(p.k);
      floater(b.position.x, b.position.y - 20, pts, '#ffd34d', 1.4);
    }
  }

  // Matter leaves a sleeping body asleep when the body under it disappears, so whatever was resting
  // on a destroyed piece would hang in mid-air. Wake everything touching it, and whatever that
  // touches in turn, so the whole stack can fall.
  function wakeAround(src) {
    const bodies = Composite.allBodies(world).filter((o) => !o.isStatic);
    const seen = new Set();
    const todo = [src.bounds];
    while (todo.length) {
      const { min, max } = todo.pop();
      const region = { min: { x: min.x - 6, y: min.y - 6 }, max: { x: max.x + 6, y: max.y + 6 } };
      for (const o of bodies) {
        if (seen.has(o) || !Bounds.overlaps(region, o.bounds)) continue;
        seen.add(o);
        Sleeping.set(o, false);
        todo.push(o.bounds);
      }
    }
  }

  // Matter only wakes a sleeper when something collides into it. A support that is shoved or slides
  // out from underneath never does, so the piece resting on it stays asleep in mid-air. Wake any
  // sleeper that has a moving body against it.
  function wakeBesideMovers() {
    const loose = Composite.allBodies(world).filter((o) => !o.isStatic);
    const movers = loose.filter((o) => !o.isSleeping && o.speed > 0.2);
    if (!movers.length) return;
    for (const s of loose) {
      if (!s.isSleeping) continue;
      for (const m of movers) {
        const { min, max } = m.bounds;
        if (Bounds.overlaps({ min: { x: min.x - 4, y: min.y - 4 }, max: { x: max.x + 4, y: max.y + 4 } }, s.bounds)) {
          Sleeping.set(s, false);
          break;
        }
      }
    }
  }

  function explode(rock) {
    if (!rock.plugin.alive) return;
    const { x, y } = rock.position;
    removeRock(rock);
    const R = 200;
    for (const b of Composite.allBodies(world)) {
      if (b.isStatic) continue;
      const dx = b.position.x - x, dy = b.position.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) continue;
      const f = 1 - d / R;
      const kick = (20 * f) / Math.max(1, Math.sqrt(b.mass / 3));
      Sleeping.set(b, false);
      Body.setVelocity(b, { x: b.velocity.x + (dx / d) * kick, y: b.velocity.y + (dy / d) * kick - 2 * f });
      Body.setAngularVelocity(b, b.angularVelocity + rand(-0.15, 0.15) * f);
      if (b.plugin.hp != null && simTime >= graceUntil) damage(b, 170 * f);
    }
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), s = rand(2, 11);
      particles.push({ type: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: rand(25, 50), max: 50, size: rand(8, 22) });
    }
    for (let i = 0; i < 14; i++) {
      particles.push({ type: 'smoke', x: x + rand(-40, 40), y: y + rand(-40, 30), vx: rand(-1, 1), vy: rand(-1.6, -0.4), life: rand(60, 110), max: 110, size: rand(20, 40) });
    }
    particles.push({ type: 'flash', x, y, life: 10, max: 10, size: R });
    shake = 18;
    Sfx.explode();
  }

  // ---------------------------------------------------------------- rocks
  function spawnRock(type, pos, vel) {
    const def = ROCKS[type];
    const b = Bodies.circle(pos.x, pos.y, def.r, { density: def.density, friction: 0.6, frictionAir: 0, restitution: 0.25 });
    b.plugin = { kind: 'rock', type, r: def.r, alive: true, hit: false, trail: [] };
    Composite.add(world, b);
    Body.setVelocity(b, vel);
    Body.setAngularVelocity(b, 0.12);
    activeRocks.push(b);
    return b;
  }

  function removeRock(b) {
    b.plugin.alive = false;
    Composite.remove(world, b);
    wakeAround(b);
    activeRocks = activeRocks.filter((r) => r !== b);
  }

  function useAbility() {
    const r = activeRocks[0];
    if (!r || abilityUsed || r.plugin.hit) return;
    abilityUsed = true;
    const type = r.plugin.type;
    const v = r.velocity;
    if (type === 'scatter') {
      const sp = Math.hypot(v.x, v.y) * 1.05;
      const ang = Math.atan2(v.y, v.x);
      const pos = { x: r.position.x, y: r.position.y };
      removeRock(r);
      [-0.17, 0, 0.17].forEach((d, i) => {
        const a = ang + d;
        const off = (i - 1) * 16;
        spawnRock('shard', { x: pos.x - Math.sin(ang) * off, y: pos.y + Math.cos(ang) * off }, { x: Math.cos(a) * sp, y: Math.sin(a) * sp });
      });
      sparkle(pos.x, pos.y, '#fff1b8');
      Sfx.split();
    } else if (type === 'boulder') {
      Body.setVelocity(r, { x: v.x * 0.25, y: Math.max(v.y, 0) + 24 });
      sparkle(r.position.x, r.position.y, '#ffffff');
      Sfx.slam();
    } else if (type === 'firepot') {
      explodeQueue.add(r);
    } else {
      abilityUsed = false;
    }
    updateHint();
  }

  function aimVelocity() {
    const len = Math.hypot(aim.vec.x, aim.vec.y);
    if (len < MIN_PULL) return null;
    const power = Math.min(len, MAX_PULL) / MAX_PULL;
    return { x: (-aim.vec.x / len) * power * MAX_SPEED, y: (-aim.vec.y / len) * power * MAX_SPEED };
  }

  function slingRockPos() {
    if (!aim.active) return { x: ANCHOR.x, y: ANCHOR.y };
    const len = Math.hypot(aim.vec.x, aim.vec.y) || 1;
    const k = Math.min(len, MAX_PULL) / len;
    const r = ROCKS[loaded].r;
    return { x: ANCHOR.x + aim.vec.x * k, y: Math.min(GROUND_Y - r, ANCHOR.y + aim.vec.y * k) };
  }

  function fire() {
    const v = aimVelocity();
    aim.active = false;
    if (!v || !loaded) return;
    launchVel = v;
    launchFrom = (() => { aim.active = true; const p = slingRockPos(); aim.active = false; return p; })();
    armTo(RELEASE, 260, easeIn);
    setState('launching');
    Sfx.launch();
  }

  function armTo(to, dur, ease, next = null) {
    arm.from = arm.angle;
    arm.to = to;
    arm.t = 0;
    arm.dur = dur;
    arm.ease = ease;
    arm.next = next;
  }

  function updateArm(step) {
    if (arm.t >= 1) return;
    arm.t = Math.min(1, arm.t + step / arm.dur);
    arm.angle = lerp(arm.from, arm.to, arm.ease(arm.t));
    if (arm.t >= 1 && arm.next) {
      const n = arm.next;
      armTo(n.to, n.dur, n.ease, n.next || null);
    }
  }

  const armTip = (a = arm.angle) => ({ x: PIVOT.x + ARM_LONG * Math.cos(a), y: PIVOT.y + ARM_LONG * Math.sin(a) });
  const armTail = (a = arm.angle) => ({ x: PIVOT.x - ARM_SHORT * Math.cos(a), y: PIVOT.y - ARM_SHORT * Math.sin(a) });

  // ---------------------------------------------------------------- particles
  function debris(b) {
    const p = b.plugin;
    const mat = MATERIALS[p.m];
    const n = clamp(Math.round((p.w * p.h) / 260), 6, 18);
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    for (let i = 0; i < n; i++) {
      const lx = rand(-p.w / 2, p.w / 2) * (p.shape === 'tri' ? 0.6 : 1);
      const ly = rand(-p.h / 2, p.h / 2) * (p.shape === 'tri' ? 0.4 : 1);
      particles.push({
        type: 'chip', x: b.position.x + lx * c - ly * s, y: b.position.y + lx * s + ly * c,
        vx: b.velocity.x * 0.4 + rand(-4, 4), vy: b.velocity.y * 0.4 + rand(-6, 1),
        rot: rand(0, 6), vr: rand(-0.3, 0.3), life: rand(50, 90), max: 90,
        size: rand(5, 12), color: pick(mat.chip), straw: p.m === 'straw',
      });
    }
    dust(b.position.x, b.position.y, 4);
  }

  function dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      particles.push({ type: 'dust', x: x + rand(-10, 10), y: y + rand(-10, 10), vx: rand(-1.2, 1.2), vy: rand(-1.2, 0.2), life: rand(30, 55), max: 55, size: rand(10, 22) });
    }
  }

  function poof(b) {
    const { x, y } = b.position;
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), s = rand(1, 4.5);
      particles.push({ type: 'dust', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(35, 60), max: 60, size: rand(14, 26), tint: true });
    }
    // The defeated foe's helmet / crown goes flying.
    particles.push({ type: 'hat', k: b.plugin.k, x, y: y - b.plugin.r, vx: rand(-3, 3) + b.velocity.x * 0.3, vy: rand(-9, -6), rot: 0, vr: rand(-0.25, 0.25), life: 120, max: 120, size: b.plugin.r });
  }

  function sparkle(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), s = rand(2, 6);
      particles.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(15, 30), max: 30, size: rand(2, 4), color });
    }
  }

  function floater(x, y, pts, color, big = 1) {
    floaters.push({ x, y, text: pts.toLocaleString(), color, life: 70, max: 70, size: 26 * big });
  }

  function updateParticles(step) {
    const k = step / STEP;
    for (const p of particles) {
      p.life -= k;
      p.x += (p.vx || 0) * k;
      p.y += (p.vy || 0) * k;
      if (p.type === 'chip' || p.type === 'hat') {
        p.vy += 0.32 * k;
        p.rot += p.vr * k;
        if (p.y > GROUND_Y - 3 && p.vy > 0) { p.y = GROUND_Y - 3; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.6; }
      } else if (p.type === 'dust' || p.type === 'smoke') {
        p.vx *= 0.96; p.vy *= 0.96; p.size += 0.25 * k;
      } else if (p.type === 'fire') {
        p.vx *= 0.92; p.vy = p.vy * 0.92 - 0.08 * k;
      } else if (p.type === 'spark') {
        p.vy += 0.1 * k;
      }
    }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) { f.life -= k; f.y -= 0.7 * k; }
    floaters = floaters.filter((f) => f.life > 0);
  }

  // ---------------------------------------------------------------- simulation step
  function update(step) {
    simTime += step;
    stateTime += step;
    updateArm(step);

    if (state === 'launching' && arm.t >= 1) {
      spawnRock(loaded, LAUNCH, launchVel);
      loaded = null;
      abilityUsed = false;
      flightStart = simTime;
      quietTime = 0;
      armTo(RELEASE + 0.35, 170, easeOut, { to: RELEASE - 0.2, dur: 900, ease: easeInOut });
      setState('flight');
    }

    Engine.update(engine, STEP);
    wakeBesideMovers();

    for (const r of explodeQueue) explode(r);
    explodeQueue.clear();
    for (const b of destroyQueue) destroy(b);
    destroyQueue.clear();

    // Remove anything that left the battlefield.
    for (const b of Composite.allBodies(world)) {
      if (b.isStatic) continue;
      const { x, y } = b.position;
      if (y > GROUND_Y + 300 || x < -600 || x > levelW + 700) {
        if (b.plugin.kind === 'rock') removeRock(b);
        else destroy(b, true);
      }
    }

    for (const r of activeRocks) {
      const t = r.plugin.trail;
      if (!r.plugin.hit && ((simTime / STEP) | 0) % 3 === 0) t.push({ x: r.position.x, y: r.position.y });
      if (t.length > 40) t.shift();
    }
    for (const f of foes) if (f.plugin.flash > 0) f.plugin.flash = Math.max(0, f.plugin.flash - step / 250);

    updateParticles(step);
    shake *= 0.88;

    // Game flow.
    if (state === 'flight') {
      const settled = activeRocks.every((r) => r.isSleeping || r.speed < 0.35);
      quietTime = settled ? quietTime + step : 0;
      if (quietTime > 650 || simTime - flightStart > 10000) afterShot();
    } else if (state === 'reload' && arm.t >= 1) {
      setState('aim');
    } else if (state === 'waiting' && !winAt && foesAlive > 0 && simTime >= loseAt && (worldCalm() || simTime >= loseAt + 8000)) {
      // Only give up once nothing is still tumbling, and never after the last foe has fallen.
      endLevel(false);
    }
    if (foesAlive <= 0 && !winAt && (state === 'flight' || state === 'waiting' || state === 'reload' || state === 'aim' || state === 'launching')) {
      winAt = simTime + 1500;
    }
    if (winAt && simTime >= winAt && state !== 'won' && state !== 'menu') endLevel(true);

    if (score !== shownScore) { shownScore = score; ui.score.textContent = score.toLocaleString(); }
  }

  // True when every loose body (blocks, foes, spent rocks) is asleep or nearly still.
  function worldCalm() {
    return Composite.allBodies(world).every((b) => b.isStatic || b.isSleeping || (b.speed < 0.35 && Math.abs(b.angularVelocity) < 0.02));
  }

  function afterShot() {
    activeRocks = [];
    if (foesAlive <= 0) { setState('waiting'); loseAt = Infinity; return; }
    if (queue.length) {
      loaded = queue.shift();
      armTo(COCKED, 700, easeInOut);
      Sfx.creak();
      setState('reload');
    } else {
      loseAt = simTime + 2600;
      setState('waiting');
    }
  }

  function endLevel(won) {
    if (won) {
      const left = queue.length + (loaded ? 1 : 0);
      // Unused rocks count as bonus points.
      const rocksLeft = [...(loaded ? [loaded] : []), ...queue];
      rocksLeft.forEach((t, i) => {
        const pos = queuePos(i, rocksLeft);
        setTimeout(() => { floater(pos.x, pos.y - 30, ROCK_BONUS, '#ffd34d', 1.2); sparkle(pos.x, pos.y, '#ffd34d'); }, i * 250);
      });
      score += left * ROCK_BONUS;
      loaded = null; queue = [];
      const stars = left >= 2 ? 3 : left === 1 ? 2 : 1;
      const prev = progress[levelIndex] || { stars: 0, best: 0 };
      const isBest = score > prev.best;
      progress[levelIndex] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, score) };
      store.set('progress', progress);
      setState('won');
      Sfx.win();
      setTimeout(() => showResult(true, stars, isBest), 1100 + left * 250);
    } else {
      setState('lost');
      Sfx.lose();
      setTimeout(() => showResult(false, 0, false), 700);
    }
    updateHint();
  }

  // Positions of the waiting rocks lined up behind the trebuchet.
  function queuePos(i, list = queue) {
    let x = TX - 150;
    for (let j = 0; j < i; j++) x -= ROCKS[list[j]].r + ROCKS[list[j + 1]].r + 8;
    return { x, y: GROUND_Y - ROCKS[list[i]].r };
  }

  // ---------------------------------------------------------------- camera
  function updateCamera(dt) {
    const max = camMax();
    if (state === 'menu') {
      camX = max * (0.5 - 0.5 * Math.cos(realTime * 0.00018));
      return;
    }
    if (state === 'intro') {
      const t = clamp((stateTime - 1000) / 1500, 0, 1);
      camX = lerp(max, 0, easeInOut(t));
      if (t >= 1) setState('aim');
      return;
    }
    let target = camX;
    if (state === 'flight' && activeRocks.length) {
      const lead = activeRocks.reduce((a, r) => (r.position.x > a.position.x ? r : a));
      target = lead.position.x - viewW * 0.4;
    } else if (state === 'launching') {
      target = 0;
    } else if ((state === 'aim' || state === 'reload') && !pan.active && realTime > camHoldUntil) {
      target = 0;
    }
    if (!pan.active) camX += (target - camX) * (1 - Math.exp(-dt * 0.005));
    camX = clamp(camX, 0, max);
  }

  // ---------------------------------------------------------------- input
  function onDown(e) {
    Sfx.unlock();
    if (paused || state === 'menu') return;
    if (state === 'intro') { setState('aim'); camX = 0; return; }
    if (state === 'flight') { useAbility(); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (state === 'aim' && loaded && !aim.active) {
      const rp = slingRockPos();
      const d = Math.hypot(p.x - rp.x, p.y - rp.y);
      if (d < Math.max(95, 60 / scale)) {
        aim.active = true;
        aim.id = e.pointerId;
        aim.start = p;
        aim.vec = { x: 0, y: 0 };
        camHoldUntil = 0;
        capture(e.pointerId);
        return;
      }
    }
    pan.active = true;
    pan.id = e.pointerId;
    pan.sx = e.clientX;
    pan.cam = camX;
    capture(e.pointerId);
  }

  function onMove(e) {
    if (aim.active && e.pointerId === aim.id) {
      const p = toWorld(e.clientX, e.clientY);
      aim.vec = { x: p.x - aim.start.x, y: p.y - aim.start.y };
    } else if (pan.active && e.pointerId === pan.id) {
      camX = clamp(pan.cam - (e.clientX - pan.sx) / scale, 0, camMax());
    }
  }

  function onUp(e) {
    if (aim.active && e.pointerId === aim.id) {
      if (state === 'aim' && aimVelocity()) fire();
      else aim.active = false;
    } else if (pan.active && e.pointerId === pan.id) {
      pan.active = false;
      camHoldUntil = realTime + 1800;
    }
  }

  function capture(id) {
    try { canvas.setPointerCapture(id); } catch (e) { /* pointer already gone */ }
  }

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', (e) => { if (e.pointerId === aim.id) aim.active = false; if (e.pointerId === pan.id) pan.active = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (isPlaying()) togglePause();
    } else if (e.key === 'r' && isPlaying() && !paused) {
      loadLevel(levelIndex);
    } else if (e.key === ' ' && state === 'flight') {
      useAbility();
    }
  });

  const isPlaying = () => state !== 'menu' && state !== 'won' && state !== 'lost';

  // ---------------------------------------------------------------- rendering
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky();

    const sx = shake > 0.5 ? rand(-shake, shake) : 0;
    const sy = shake > 0.5 ? rand(-shake, shake) : 0;
    const k = DPR * scale;
    ctx.setTransform(k, 0, 0, k, (-camX * scale + sx) * DPR, (-camY * scale + sy) * DPR);

    drawGround();
    for (const b of Composite.allBodies(world)) if (b.plugin.kind === 'hill') drawHill(b);
    drawQueue();
    drawTrebuchet();
    for (const b of blocks) if (b.plugin.alive) drawBlock(b);
    for (const b of foes) if (b.plugin.alive) drawFoe(b);
    drawTrails();
    for (const b of Composite.allBodies(world)) if (b.plugin.kind === 'rock') drawRock(b.plugin.type, b.position.x, b.position.y, b.angle);
    drawSlingAndLoaded();
    drawParticles();
    drawTrajectory();
    drawFloaters();
  }

  // Background ------------------------------------------------------------
  const clouds = Array.from({ length: 14 }, (_, i) => ({ x: i * 340 + hash(i) * 200, y: 80 + hash(i + 9) * 260, s: 0.6 + hash(i + 3) * 0.8 }));

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4f86c6');
    g.addColorStop(0.55, '#a9c8e3');
    g.addColorStop(1, '#f3dcae');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const gy = (GROUND_Y - camY) * scale; // ground line on screen
    // sun
    const sunX = W * 0.78 - camX * scale * 0.03, sunY = gy - 560 * scale;
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 160 * scale);
    sg.addColorStop(0, 'rgba(255,244,200,0.95)');
    sg.addColorStop(0.25, 'rgba(255,236,170,0.6)');
    sg.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - 160 * scale, sunY - 160 * scale, 320 * scale, 320 * scale);
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(sunX, sunY, 42 * scale, 0, Math.PI * 2); ctx.fill();

    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of clouds) {
      const wrap = 4800;
      let x = ((c.x - camX * 0.2 + realTime * 0.006 * c.s) % wrap + wrap) % wrap - 300;
      const cx = x * scale, cy = gy - (780 - c.y) * scale, s = c.s * scale;
      if (cx < -300 * s || cx > W + 300 * s) continue;
      for (const [ox, oy, rx, ry] of [[0, 0, 70, 26], [45, -14, 48, 30], [-40, -8, 40, 22]]) {
        ctx.beginPath();
        ctx.ellipse(cx + ox * s, cy + oy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // far mountains
    layer(0.12, '#8fa7c4', (x) => 330 + 90 * Math.sin(x * 0.0031) + 50 * Math.sin(x * 0.0083 + 1.3) + 18 * Math.sin(x * 0.027));
    // distant castle on the mountains
    const castleX = (2300 - camX * 0.12) * scale, castleBase = gy - (330 + 90 * Math.sin(2300 * 0.0031) + 50 * Math.sin(2300 * 0.0083 + 1.3) - 10) * scale;
    drawCastleSilhouette(castleX, castleBase, scale * 0.9, '#7f97b5');
    // mid hills
    layer(0.35, '#7d9b62', (x) => 150 + 45 * Math.sin(x * 0.006 + 2) + 25 * Math.sin(x * 0.017));
    drawTreeLine(0.35, '#5f7d48', (x) => 150 + 45 * Math.sin(x * 0.006 + 2) + 25 * Math.sin(x * 0.017));
    // near hills
    layer(0.6, '#6a8c4a', (x) => 60 + 22 * Math.sin(x * 0.009 + 4) + 12 * Math.sin(x * 0.03));
  }

  function layer(par, color, heightFn) {
    const gy = (GROUND_Y - camY) * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let sx = 0; sx <= W + 8; sx += 8) {
      const wx = sx / scale + camX * par;
      ctx.lineTo(sx, gy - heightFn(wx) * scale);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawTreeLine(par, color, heightFn) {
    const gy = (GROUND_Y - camY) * scale;
    ctx.fillStyle = color;
    const spacing = 55;
    const start = Math.floor((camX * par) / spacing) - 1;
    const end = start + Math.ceil(viewW / spacing) + 2;
    for (let i = start; i <= end; i++) {
      if (hash(i) < 0.45) continue;
      const wx = i * spacing + hash(i + 50) * 30;
      const sx = (wx - camX * par) * scale;
      const base = gy - (heightFn(wx) - 4) * scale;
      const h = (30 + hash(i + 7) * 30) * scale;
      ctx.beginPath();
      ctx.moveTo(sx, base - h);
      ctx.lineTo(sx + h * 0.32, base);
      ctx.lineTo(sx - h * 0.32, base);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCastleSilhouette(x, base, s, color) {
    ctx.fillStyle = color;
    const r = (ax, ay, w, h) => ctx.fillRect(x + ax * s, base - (ay + h) * s, w * s, h * s);
    r(-60, 0, 120, 50);
    r(-75, 0, 26, 85); r(49, 0, 26, 85); r(-18, 0, 36, 110);
    for (const tx of [-75, 49]) for (let i = 0; i < 3; i++) r(tx + i * 10, 85, 6, 8);
    for (let i = 0; i < 4; i++) r(-18 + i * 10, 110, 6, 8);
    ctx.beginPath();
    ctx.moveTo(x, base - 145 * s); ctx.lineTo(x, base - 118 * s); ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.stroke();
    ctx.fillRect(x, base - 145 * s, 14 * s, 8 * s);
  }

  function drawGround() {
    const x0 = camX - 60, x1 = camX + viewW + 60;
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 120);
    g.addColorStop(0, '#6b4a2b');
    g.addColorStop(1, '#3d2716');
    ctx.fillStyle = g;
    ctx.fillRect(x0, GROUND_Y, x1 - x0, camY + viewH - GROUND_Y + 20);
    // pebbles
    ctx.fillStyle = 'rgba(30,18,8,0.35)';
    for (let i = Math.floor(x0 / 37); i < x1 / 37; i++) {
      const px = i * 37 + hash(i) * 20, py = GROUND_Y + 22 + hash(i + 1) * 50;
      ctx.beginPath(); ctx.ellipse(px, py, 4 + hash(i + 2) * 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    // grass
    ctx.fillStyle = '#5b8a37';
    ctx.fillRect(x0, GROUND_Y - 2, x1 - x0, 14);
    ctx.fillStyle = '#477129';
    ctx.fillRect(x0, GROUND_Y + 10, x1 - x0, 4);
    ctx.fillStyle = '#6fa443';
    for (let i = Math.floor(x0 / 14); i < x1 / 14; i++) {
      const gx = i * 14 + hash(i) * 8, h = 5 + hash(i + 3) * 8;
      ctx.beginPath(); ctx.moveTo(gx - 3, GROUND_Y); ctx.lineTo(gx, GROUND_Y - h); ctx.lineTo(gx + 3, GROUND_Y); ctx.fill();
    }
  }

  function drawHill(b) {
    const { w, h } = b.plugin;
    const x = b.position.x - w / 2, y = GROUND_Y - h;
    const g = ctx.createLinearGradient(0, y, 0, GROUND_Y);
    g.addColorStop(0, '#76532f');
    g.addColorStop(1, '#5a3d22');
    ctx.fillStyle = g;
    roundRect(x, y, w, h + 6, 18);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,18,8,0.3)';
    for (let i = 0; i < w / 40; i++) {
      ctx.beginPath(); ctx.ellipse(x + 20 + i * 40 + hash(i) * 10, y + 30 + hash(i + 4) * (h - 40), 6, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#5b8a37';
    roundRect(x - 2, y - 4, w + 4, 14, 7);
    ctx.fill();
  }

  // Trebuchet ---------------------------------------------------------------
  function drawTrebuchet() {
    const wood = '#7a4b22', woodDark = '#4f2f12', woodLight = '#a06a36';
    ctx.lineCap = 'round';
    // back frame (offset for depth)
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 11;
    line(TX - 52, 784, PIVOT.x + 6, PIVOT.y - 4);
    line(TX + 72, 784, PIVOT.x + 6, PIVOT.y - 4);
    line(TX - 22, 715, TX + 40, 715);

    // counterweight
    const tail = armTail();
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = 3;
    line(tail.x - 10, tail.y, tail.x - 14, tail.y + 18);
    line(tail.x + 10, tail.y, tail.x + 14, tail.y + 18);
    ctx.fillStyle = '#6a5a4a';
    ctx.strokeStyle = '#2e2014';
    ctx.lineWidth = 3;
    roundRect(tail.x - 25, tail.y + 16, 50, 44, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8b8c90';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      ctx.beginPath(); ctx.arc(tail.x - 14 + i * 14, tail.y + 30 + j * 16, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#2e2014';
    line(tail.x - 25, tail.y + 38, tail.x + 25, tail.y + 38);

    // arm
    const tip = armTip();
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 15;
    line(tail.x, tail.y, tip.x, tip.y);
    ctx.strokeStyle = wood;
    ctx.lineWidth = 11;
    line(tail.x, tail.y, tip.x, tip.y);
    ctx.strokeStyle = woodLight;
    ctx.lineWidth = 3;
    line(lerp(tail.x, tip.x, 0.05), lerp(tail.y, tip.y, 0.05) - 2, lerp(tail.x, tip.x, 0.9), lerp(tail.y, tip.y, 0.9) - 2);
    // iron bands on arm
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    for (const t of [0.12, 0.45, 0.8]) {
      const bx = lerp(tail.x, tip.x, t), by = lerp(tail.y, tip.y, t);
      const nx = -(tip.y - tail.y) / (ARM_LONG + ARM_SHORT), ny = (tip.x - tail.x) / (ARM_LONG + ARM_SHORT);
      line(bx - nx * 7, by - ny * 7, bx + nx * 7, by + ny * 7);
    }

    // front frame
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 14;
    line(TX - 62, 784, PIVOT.x, PIVOT.y);
    line(TX + 62, 784, PIVOT.x, PIVOT.y);
    ctx.strokeStyle = wood;
    ctx.lineWidth = 10;
    line(TX - 62, 784, PIVOT.x, PIVOT.y);
    line(TX + 62, 784, PIVOT.x, PIVOT.y);
    ctx.lineWidth = 8;
    line(TX - 34, 712, TX + 34, 712);
    // base beam
    ctx.fillStyle = wood;
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 3;
    roundRect(TX - 100, 778, 200, 16, 4);
    ctx.fill(); ctx.stroke();
    // wheels
    for (const wx of [TX - 72, TX + 72]) {
      ctx.fillStyle = '#5e3a19';
      ctx.beginPath(); ctx.arc(wx, 803, 17, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2e1c0b';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        line(wx - Math.cos(a) * 14, 803 - Math.sin(a) * 14, wx + Math.cos(a) * 14, 803 + Math.sin(a) * 14);
      }
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(wx, 803, 4, 0, Math.PI * 2); ctx.fill();
    }
    // axle
    ctx.fillStyle = '#2c2c2c';
    ctx.beginPath(); ctx.arc(PIVOT.x, PIVOT.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#777';
    ctx.beginPath(); ctx.arc(PIVOT.x - 2, PIVOT.y - 2, 3, 0, Math.PI * 2); ctx.fill();
    // banner
    const fx = TX + 2, fy = PIVOT.y - 16;
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = 3;
    line(fx, fy, fx, fy - 60);
    const wave = Math.sin(realTime * 0.004) * 4;
    ctx.fillStyle = '#9b2226';
    ctx.beginPath();
    ctx.moveTo(fx, fy - 60);
    ctx.quadraticCurveTo(fx + 20, fy - 62 + wave, fx + 40, fy - 56);
    ctx.lineTo(fx + 32, fy - 46 + wave * 0.5);
    ctx.lineTo(fx + 40, fy - 36);
    ctx.quadraticCurveTo(fx + 20, fy - 40 + wave, fx, fy - 38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e3b341';
    ctx.beginPath(); ctx.arc(fx + 16, fy - 49 + wave * 0.5, 4, 0, Math.PI * 2); ctx.fill();
  }

  function drawSlingAndLoaded() {
    const tip = armTip();
    let rp = null;
    if (state === 'launching' && launchFrom) {
      const t = easeOut(arm.t);
      rp = { x: lerp(launchFrom.x, tip.x, t), y: lerp(launchFrom.y, tip.y, t) };
    } else if (loaded && (state === 'aim' || state === 'reload' || state === 'intro' || state === 'menu')) {
      rp = slingRockPos();
      if (state === 'reload') {
        // The pouch swings back down with the arm as it is cocked.
        const t = easeInOut(arm.t);
        rp = { x: lerp(tip.x, rp.x, t), y: lerp(tip.y, rp.y, t) };
      }
    }
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = 2.5;
    if (rp) {
      const r = ROCKS[loaded || 'stone'].r;
      line(tip.x, tip.y, rp.x - r * 0.7, rp.y);
      line(tip.x, tip.y, rp.x + r * 0.7, rp.y);
      drawRock(loaded || 'stone', rp.x, rp.y, 0);
      ctx.strokeStyle = '#5a3b20';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, r + 1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    } else {
      // empty sling dangling from the tip
      const sway = Math.sin(realTime * 0.006) * 6;
      line(tip.x, tip.y, tip.x + sway, tip.y + 34);
    }
    // grab hint ring
    if (state === 'aim' && !aim.active && loaded) {
      const pulse = 0.5 + 0.5 * Math.sin(realTime * 0.006);
      ctx.strokeStyle = `rgba(255,244,214,${0.35 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(ANCHOR.x, ANCHOR.y, ROCKS[loaded].r + 14 + pulse * 6, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawQueue() {
    const list = state === 'won' ? [] : queue;
    list.forEach((t, i) => {
      const p = queuePos(i, list);
      drawRock(t, p.x, p.y, 0);
    });
  }

  function drawTrajectory() {
    if (!aim.active || state !== 'aim') return;
    const v = aimVelocity();
    if (!v) return;
    let x = LAUNCH.x, y = LAUNCH.y, vx = v.x, vy = v.y;
    const n = 30;
    for (let i = 0; i < n * 3; i++) {
      vy += GRAVITY_STEP;
      x += vx; y += vy;
      if (y > GROUND_Y) break;
      if (i % 3 === 0) {
        const a = 1 - i / (n * 3);
        ctx.fillStyle = `rgba(255,250,235,${0.9 * a})`;
        ctx.beginPath(); ctx.arc(x, y, 5 - (i / (n * 3)) * 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // power meter around the sling
    const len = Math.min(Math.hypot(aim.vec.x, aim.vec.y), MAX_PULL) / MAX_PULL;
    const rp = slingRockPos();
    ctx.strokeStyle = `hsl(${lerp(100, 0, len)}, 80%, 55%)`;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(rp.x, rp.y, ROCKS[loaded].r + 12, -Math.PI / 2, -Math.PI / 2 + len * Math.PI * 2); ctx.stroke();
  }

  function drawTrails() {
    for (const r of activeRocks) {
      const t = r.plugin.trail;
      for (let i = 0; i < t.length; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.15 + (i / t.length) * 0.45})`;
        ctx.beginPath(); ctx.arc(t[i].x, t[i].y, 2.5 + (i % 2) * 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Rocks ------------------------------------------------------------------
  function drawRock(type, x, y, angle) {
    const r = ROCKS[type].r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (type === 'firepot') {
      ctx.fillStyle = '#9c4a1f';
      ctx.strokeStyle = '#4a1f0a';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a3412';
      ctx.fillRect(-r * 0.45, -r - 4, r * 0.9, 8);
      ctx.strokeRect(-r * 0.45, -r - 4, r * 0.9, 8);
      ctx.strokeStyle = '#d9a066';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 2, r * 0.65, 0.2, Math.PI - 0.2); ctx.stroke();
      // flickering flame
      const f = 0.8 + Math.sin(realTime * 0.03 + x) * 0.2;
      ctx.fillStyle = '#ff9a1f';
      ctx.beginPath(); ctx.ellipse(0, -r - 10 * f, 5, 9 * f, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath(); ctx.ellipse(0, -r - 7 * f, 2.5, 5 * f, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    const base = type === 'boulder' ? '#6f6a63' : type === 'scatter' ? '#5e6470' : '#7d7f84';
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#c4c5c9');
    g.addColorStop(0.35, base);
    g.addColorStop(1, '#3d3e42');
    ctx.fillStyle = g;
    ctx.beginPath();
    // lumpy outline
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rr = r * (0.92 + hash(i + r) * 0.1);
      i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2f3034';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,40,45,0.45)';
    ctx.beginPath(); ctx.arc(r * 0.3, r * 0.2, r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.25, r * 0.4, r * 0.12, 0, Math.PI * 2); ctx.fill();
    if (type === 'scatter') {
      ctx.strokeStyle = 'rgba(20,20,25,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.1, 0); ctx.lineTo(-r * 0.7, r * 0.6); ctx.moveTo(r * 0.1, 0); ctx.lineTo(r * 0.85, r * 0.4); ctx.stroke();
    }
    if (type === 'boulder') {
      ctx.fillStyle = 'rgba(90,130,60,0.7)';
      ctx.beginPath(); ctx.ellipse(-r * 0.2, -r * 0.7, r * 0.45, r * 0.2, -0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Blocks -----------------------------------------------------------------
  function drawBlock(b) {
    const p = b.plugin;
    const mat = MATERIALS[p.m];
    if (p.shape === 'tri') {
      const v = b.vertices;
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.fillStyle = p.m === 'wood' ? '#9b3d2a' : mat.fill; // wooden roofs are painted red
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(60,20,10,0.45)';
      ctx.lineWidth = 2;
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      for (let y = -p.h; y < p.h; y += 12) { ctx.beginPath(); ctx.moveTo(-p.w, y); ctx.lineTo(p.w, y); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = '#4a1a10';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.stroke();
      drawCracks(b, p);
      return;
    }
    const w = p.w, h = p.h;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = mat.fill;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    const seed = b.id;
    if (p.m === 'wood') {
      ctx.strokeStyle = 'rgba(80,45,15,0.45)';
      ctx.lineWidth = 1.5;
      const horiz = w >= h;
      const L = horiz ? w : h, S = horiz ? h : w;
      for (let i = 1; i < 3; i++) {
        const o = -S / 2 + (S * i) / 3 + (hash(seed + i) - 0.5) * 4;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(-L / 2, o); ctx.bezierCurveTo(-L / 6, o + 2, L / 6, o - 2, L / 2, o); }
        else { ctx.moveTo(o, -L / 2); ctx.bezierCurveTo(o + 2, -L / 6, o - 2, L / 6, o, L / 2); }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(80,45,15,0.5)';
      const kp = (hash(seed) - 0.5) * L * 0.6;
      ctx.beginPath();
      horiz ? ctx.ellipse(kp, 0, 4, 2.5, 0, 0, Math.PI * 2) : ctx.ellipse(0, kp, 2.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // nails
      ctx.fillStyle = '#3a3a3a';
      if (w > 30 && h > 30) for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(nx * (w / 2 - 6), ny * (h / 2 - 6), 1.8, 0, Math.PI * 2); ctx.fill(); }
    } else if (p.m === 'stone') {
      ctx.strokeStyle = 'rgba(50,50,55,0.55)';
      ctx.lineWidth = 2;
      const rowH = h > 40 ? 25 : h;
      let row = 0;
      for (let y = -h / 2; y < h / 2; y += rowH, row++) {
        ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke();
        const brickW = w > 40 ? 28 : w;
        for (let x = -w / 2 + (row % 2 ? brickW / 2 : 0); x < w / 2; x += brickW) {
          if (x <= -w / 2) continue;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(-w / 2, -h / 2, w, 3);
    } else if (p.m === 'straw') {
      ctx.strokeStyle = 'rgba(140,100,30,0.55)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        const sx = -w / 2 + hash(seed + i) * w, sy = -h / 2 + hash(seed + i + 40) * h;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 9, sy + (hash(i) - 0.5) * 6); ctx.stroke();
      }
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-w / 4, -h / 2); ctx.lineTo(-w / 4, h / 2); ctx.moveTo(w / 4, -h / 2); ctx.lineTo(w / 4, h / 2); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = mat.dark;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    drawCracks(b, p);
  }

  function drawCracks(b, p) {
    const ratio = p.hp / p.maxHp;
    if (ratio > 0.7) return;
    const n = ratio > 0.4 ? 1 : 3;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.strokeStyle = p.m === 'stone' ? 'rgba(25,25,28,0.8)' : 'rgba(40,20,5,0.8)';
    ctx.lineWidth = 1.8;
    const w = p.shape === 'tri' ? p.w * 0.5 : p.w, h = p.shape === 'tri' ? p.h * 0.4 : p.h;
    for (let c = 0; c < n; c++) {
      let x = (hash(b.id + c * 3) - 0.5) * w * 0.7, y = (hash(b.id + c * 3 + 1) - 0.5) * h * 0.7;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (hash(b.id + c + s * 7) - 0.5) * w * 0.4;
        y += (hash(b.id + c + s * 11) - 0.5) * h * 0.4;
        ctx.lineTo(clamp(x, -w / 2, w / 2), clamp(y, -h / 2, h / 2));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Foes ---------------------------------------------------------------------
  function drawFoe(b) {
    const { k, r, hp, maxHp, flash } = b.plugin;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    drawFoeShape(k, r, hp / maxHp, b.id);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.7})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawFoeShape(k, r, health, id) {
    // face
    ctx.fillStyle = k === 'king' ? '#f2c79a' : '#eebb88';
    ctx.strokeStyle = '#5b3a1e';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    const blink = ((realTime + id * 977) % 3600) < 130;
    const eye = (ex, ey, er, bruised) => {
      if (bruised) {
        ctx.fillStyle = 'rgba(110,60,140,0.6)';
        ctx.beginPath(); ctx.arc(ex, ey, er * 1.5, 0, Math.PI * 2); ctx.fill();
      }
      if (blink) {
        ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex - er, ey); ctx.lineTo(ex + er, ey); ctx.stroke();
        return;
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d1208';
      ctx.beginPath(); ctx.arc(ex - er * 0.35, ey + er * 0.1, er * 0.5, 0, Math.PI * 2); ctx.fill();
    };

    if (k === 'knight') {
      // great helm covering the head
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#d8dbe0');
      g.addColorStop(1, '#7c8189');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#3c4048';
      ctx.beginPath();
      ctx.moveTo(-r * 0.92, r * 0.45);
      ctx.lineTo(-r * 0.92, -r * 0.35);
      ctx.quadraticCurveTo(-r * 0.9, -r * 1.05, 0, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.9, -r * 1.05, r * 0.92, -r * 0.35);
      ctx.lineTo(r * 0.92, r * 0.45);
      ctx.quadraticCurveTo(0, r * 0.75, -r * 0.92, r * 0.45);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1b1d22';
      ctx.fillRect(-r * 0.75, -r * 0.18, r * 1.5, r * 0.2);
      ctx.fillRect(-r * 0.08, -r * 0.18, r * 0.16, r * 0.6);
      // eyes glinting through the slit
      if (!blink) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-r * 0.55, -r * 0.14, r * 0.2, r * 0.12);
        ctx.fillRect(r * 0.15, -r * 0.14, r * 0.2, r * 0.12);
      }
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(r * 0.45, r * 0.15 + i * r * 0.15, 1.6, 0, Math.PI * 2); ctx.fill(); }
      // plume
      ctx.fillStyle = '#b3212b';
      ctx.beginPath(); ctx.ellipse(r * 0.15, -r * 1.2, r * 0.55, r * 0.22, -0.4, 0, Math.PI * 2); ctx.fill();
      if (health < 0.5) {
        ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.7); ctx.lineTo(-r * 0.3, -r * 0.45); ctx.lineTo(-r * 0.4, -r * 0.3); ctx.stroke();
      }
      return;
    }

    eye(-r * 0.38, -r * 0.08, r * 0.2, health < 0.5);
    eye(r * 0.18, -r * 0.08, r * 0.2, false);
    // nose & mouth
    ctx.fillStyle = '#d99a6c';
    ctx.beginPath(); ctx.ellipse(-r * 0.12, r * 0.17, r * 0.14, r * 0.11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5b3a1e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (health < 0.5) ctx.arc(-r * 0.1, r * 0.62, r * 0.22, 1.15 * Math.PI, 1.85 * Math.PI);
    else ctx.arc(-r * 0.1, r * 0.3, r * 0.25, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();

    if (k === 'soldier') {
      // kettle hat
      ctx.fillStyle = '#9aa1a8';
      ctx.strokeStyle = '#4b5057';
      ctx.beginPath(); ctx.ellipse(0, -r * 0.42, r * 1.25, r * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -r * 0.45, r * 0.78, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.85, r * 0.2, r * 0.08, -0.4, 0, Math.PI * 2); ctx.fill();
      // mustache
      ctx.fillStyle = '#6b3f1d';
      ctx.beginPath(); ctx.ellipse(-r * 0.28, r * 0.3, r * 0.2, r * 0.07, 0.3, 0, Math.PI * 2); ctx.ellipse(r * 0.04, r * 0.3, r * 0.2, r * 0.07, -0.3, 0, Math.PI * 2); ctx.fill();
    } else if (k === 'king') {
      // beard
      ctx.fillStyle = '#e8e2d6';
      ctx.strokeStyle = '#9b9283';
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, r * 0.25);
      ctx.quadraticCurveTo(-r * 0.6, r * 1.25, 0, r * 1.15);
      ctx.quadraticCurveTo(r * 0.6, r * 1.25, r * 0.75, r * 0.25);
      ctx.quadraticCurveTo(0, r * 0.65, -r * 0.75, r * 0.25);
      ctx.fill(); ctx.stroke();
      // crown
      ctx.fillStyle = '#f2c230';
      ctx.strokeStyle = '#8a6410';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.55);
      ctx.lineTo(-r * 0.8, -r * 1.25);
      ctx.lineTo(-r * 0.4, -r * 0.9);
      ctx.lineTo(0, -r * 1.4);
      ctx.lineTo(r * 0.4, -r * 0.9);
      ctx.lineTo(r * 0.8, -r * 1.25);
      ctx.lineTo(r * 0.7, -r * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c0262d';
      ctx.beginPath(); ctx.arc(0, -r * 0.75, r * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a6fd6';
      ctx.beginPath(); ctx.arc(-r * 0.45, -r * 0.7, r * 0.08, 0, Math.PI * 2); ctx.arc(r * 0.45, -r * 0.7, r * 0.08, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Particles ----------------------------------------------------------------
  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.type === 'chip') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.straw) ctx.fillRect(-p.size / 2, -1, p.size, 2);
        else ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
        ctx.restore();
      } else if (p.type === 'dust') {
        ctx.fillStyle = p.tint ? `rgba(250,245,235,${a * 0.8})` : `rgba(205,185,150,${a * 0.6})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'smoke') {
        ctx.fillStyle = `rgba(70,62,55,${a * 0.5})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'fire') {
        ctx.fillStyle = `hsla(${lerp(5, 45, a)}, 100%, ${lerp(40, 65, a)}%, ${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'spark') {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.type === 'flash') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `rgba(255,240,180,${a})`);
        g.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      } else if (p.type === 'hat') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        drawHat(p.k, p.size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHat(k, r) {
    ctx.lineWidth = 2;
    if (k === 'king') {
      ctx.fillStyle = '#f2c230'; ctx.strokeStyle = '#8a6410';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, r * 0.3); ctx.lineTo(-r * 0.8, -r * 0.4); ctx.lineTo(-r * 0.4, -r * 0.05); ctx.lineTo(0, -r * 0.55);
      ctx.lineTo(r * 0.4, -r * 0.05); ctx.lineTo(r * 0.8, -r * 0.4); ctx.lineTo(r * 0.7, r * 0.3); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (k === 'knight') {
      ctx.fillStyle = '#b3212b';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r * 0.22, -0.4, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#9aa1a8'; ctx.strokeStyle = '#4b5057';
      ctx.beginPath(); ctx.ellipse(0, r * 0.1, r * 1.25, r * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.78, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      const a = clamp(f.life / 25, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `800 ${f.size}px Cinzel, Georgia, serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(40,20,5,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // Helpers ----------------------------------------------------------------
  function line(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- UI
  let toastTimer = 0;
  function toast(msg, ms = 3000) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
  }

  function updateHint() {
    let text = '';
    if (state === 'aim' && loaded) {
      const d = ROCKS[loaded];
      text = d.hint ? `${d.name} — ${d.hint}` : `${d.name} — drag back & release`;
    } else if (state === 'flight' && !abilityUsed && activeRocks[0] && ROCKS[activeRocks[0].plugin.type].hint) {
      const t = activeRocks[0].plugin.type;
      text = t === 'scatter' ? 'Tap to split!' : t === 'boulder' ? 'Tap to slam!' : t === 'firepot' ? 'Tap to burst!' : '';
    }
    ui.hint.textContent = text;
    ui.hint.classList.toggle('show', !!text);
    ui.hint.classList.toggle('pulse', state === 'flight');
  }

  function show(screen) {
    for (const s of [ui.title, ui.levels, ui.pause, ui.result]) s.hidden = s !== screen;
    ui.hud.hidden = !!screen;
  }

  function startLevel(i) {
    paused = false;
    show(null);
    ui.hud.hidden = false;
    loadLevel(i);
    checkOrientation();
  }

  function goMenu(screen) {
    paused = false;
    const from = levelIndex; // the level just played decides which set the list opens on
    const last = Math.min(highestUnlocked(), LEVELS.length - 1);
    loadLevel(last, true);
    show(screen);
    if (screen === ui.levels) { viewSet = setOf(from); buildLevelGrid(); }
  }

  const highestUnlocked = () => {
    let i = 0;
    while (i < LEVELS.length - 1 && progress[i] && progress[i].stars > 0) i++;
    return i;
  };

  const starSvg = (on) => `<svg class="star ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`;

  function buildLevelGrid() {
    const unlocked = highestUnlocked();
    let total = 0;
    for (let i = 0; i < LEVELS.length; i++) total += (progress[i] || { stars: 0 }).stars;
    ui.totalStars.textContent = `${total} / ${LEVELS.length * 3}`;

    ui.setTabs.hidden = SETS.length < 2;
    ui.setTabs.innerHTML = '';
    SETS.forEach((st, si) => {
      const locked = st.start > unlocked;
      let got = 0;
      for (let i = st.start; i < st.start + st.count; i++) got += (progress[i] || { stars: 0 }).stars;
      const t = document.createElement('button');
      t.className = 'set-tab' + (si === viewSet ? ' on' : '');
      t.disabled = locked;
      t.innerHTML = `<span class="set-no">${locked ? '<svg viewBox="0 0 24 24" class="lock" aria-hidden="true"><path d="M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1h1zm2 0h6V7a3 3 0 00-6 0v3z"/></svg>' : si + 1}</span><span class="set-name">${st.name}</span><span class="set-stars">${got} / ${st.count * 3}</span>`;
      t.setAttribute('aria-label', `Set ${si + 1}: ${st.name}${locked ? ' (locked)' : ''}`);
      t.setAttribute('aria-pressed', si === viewSet ? 'true' : 'false');
      t.addEventListener('click', () => { Sfx.unlock(); Sfx.click(); viewSet = si; buildLevelGrid(); });
      ui.setTabs.appendChild(t);
    });

    const set = SETS[viewSet];
    ui.grid.innerHTML = '';
    for (let i = set.start; i < Math.min(set.start + set.count, LEVELS.length); i++) {
      const lv = LEVELS[i];
      const p = progress[i] || { stars: 0, best: 0 };
      const b = document.createElement('button');
      b.className = 'level-btn';
      b.disabled = i > unlocked;
      b.innerHTML = `<span class="num">${i > unlocked ? '<svg viewBox="0 0 24 24" class="lock" aria-hidden="true"><path d="M7 10V7a5 5 0 0110 0v3h1a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1h1zm2 0h6V7a3 3 0 00-6 0v3z"/></svg>' : i - set.start + 1}</span>
        <span class="stars">${[0, 1, 2].map((s) => starSvg(s < p.stars)).join('')}</span>`;
      b.title = lv.name;
      b.setAttribute('aria-label', `Level ${levelLabel(i)}: ${lv.name}${b.disabled ? ' (locked)' : ''}`);
      b.addEventListener('click', () => { Sfx.unlock(); Sfx.click(); startLevel(i); });
      ui.grid.appendChild(b);
    }
  }

  function showResult(won, stars, isBest) {
    const lastOfSet = levelIndex === SETS[setOf(levelIndex)].start + SETS[setOf(levelIndex)].count - 1;
    ui.resultTitle.textContent = won ? (levelIndex === LEVELS.length - 1 ? 'The Realm Is Yours!' : lastOfSet ? `${SETS[setOf(levelIndex)].name} Conquered!` : 'Victory!') : 'The Castle Stands';
    ui.resultSub.textContent = won ? levelDef.name + ' has fallen.' : 'Your rocks are spent. Try another angle!';
    ui.resultScore.textContent = score.toLocaleString();
    const best = (progress[levelIndex] || {}).best || 0;
    ui.resultBest.textContent = won && isBest ? 'New best!' : best ? `Best: ${best.toLocaleString()}` : '';
    ui.resultStars.innerHTML = [0, 1, 2].map((s) => starSvg(false)).join('');
    ui.resultStars.hidden = !won;
    ui.next.hidden = !won || levelIndex >= LEVELS.length - 1;
    show(ui.result);
    if (won) {
      [...ui.resultStars.children].forEach((el, i) => {
        if (i < stars) setTimeout(() => { el.classList.add('on', 'pop'); Sfx.star(i); }, 350 + i * 350);
      });
    }
  }

  function togglePause(force) {
    paused = force ?? !paused;
    show(paused ? ui.pause : null);
    if (!paused) ui.hud.hidden = false;
  }

  function updateMuteIcon() {
    ui.mute.classList.toggle('muted', Sfx.muted);
    ui.mute.setAttribute('aria-label', Sfx.muted ? 'Unmute' : 'Mute');
  }

  const on = (id, fn) => $(id).addEventListener('click', () => { Sfx.unlock(); Sfx.click(); fn(); });
  on('btn-play', () => { viewSet = setOf(highestUnlocked()); show(ui.levels); buildLevelGrid(); });
  on('btn-levels-back', () => show(ui.title));
  on('btn-pause', () => togglePause(true));
  on('btn-resume', () => togglePause(false));
  on('btn-pause-restart', () => startLevel(levelIndex));
  on('btn-pause-levels', () => goMenu(ui.levels));
  on('btn-restart', () => startLevel(levelIndex));
  on('btn-retry', () => startLevel(levelIndex));
  on('btn-result-levels', () => goMenu(ui.levels));
  on('btn-next', () => startLevel(Math.min(levelIndex + 1, LEVELS.length - 1)));
  ui.mute.addEventListener('click', () => { Sfx.unlock(); Sfx.setMuted(!Sfx.muted); updateMuteIcon(); Sfx.click(); });
  updateMuteIcon();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isPlaying() && !paused) togglePause(true);
  });

  // PWA install affordances.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    ui.install.hidden = false;
  });
  ui.install.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    ui.install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { ui.install.hidden = true; });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone) ui.iosHint.hidden = false;

  // ---------------------------------------------------------------- main loop
  let lastFrame = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    realTime += dt;
    if (!paused) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) { update(STEP); acc -= STEP; steps++; }
      if (steps === 5) acc = 0;
      updateCamera(dt);
    }
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  goMenu(ui.title);
  requestAnimationFrame(frame);

  // Exposed for debugging in the console.
  window.trebuchet = { loadLevel: (i) => startLevel(i),
    // Test hooks: shoot(angleRad, power 0..1) fires from the aim state; tap() uses the rock's special.
    shoot: (angle, power) => { if (state !== 'aim' || !loaded) return false; aim.vec = { x: -Math.cos(angle) * MAX_PULL * power, y: Math.sin(angle) * MAX_PULL * power }; fire(); return true; },
    tap: () => useAbility(),
    get rocksLeft() { return queue.length + (loaded ? 1 : 0); }, get state() { return state; }, get foes() { return foesAlive; },
    get foePositions() { return foes.filter((f) => f.plugin.alive).map((f) => ({ x: Math.round(f.position.x), y: Math.round(f.position.y) })); } };
})();
