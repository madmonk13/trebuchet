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
  // Foes are upright figures; one knocked flat and left lying is out of the fight.
  const FOES = {
    soldier: { w: 22, h: 44, hp: 22, score: 5000 },
    knight: { w: 24, h: 50, hp: 50, score: 7500 },
    king: { w: 28, h: 56, hp: 90, score: 15000 },
  };
  const TOPPLE_ANGLE = 1.15;  // radians from upright
  const TOPPLE_TIME = 900;    // ms lying down before the foe counts as defeated
  const CANVAS_SERIF = "'IM Fell English', Georgia, serif";
  const CANVAS_BLACKLETTER = "'UnifrakturMaguntia', 'IM Fell English', Georgia, serif";
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
  const aim = { active: false, id: null, start: null, vec: { x: 0, y: 0 }, notch: 0 };
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
        const b = Bodies.rectangle(it.x, it.y - def.h / 2, def.w, def.h, { chamfer: { radius: 4 }, density: 0.0016, friction: 0.8, frictionStatic: 1, restitution: 0.05, frictionAir: 0.008 });
        b.plugin = { kind: 'foe', k: it.k, w: def.w, h: def.h, r: def.h / 2, hr: def.w * 0.34, hp: def.hp, maxHp: def.hp, alive: true, flash: 0, down: 0 };
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
      if (!silent) { Sfx.break(p.m); floater(b.position.x, b.position.y, pts, '#2a1d14'); }
    } else if (p.kind === 'foe') {
      const pts = FOES[p.k].score;
      score += pts;
      foesAlive--;
      poof(b);
      Sfx.oof(p.k);
      floater(b.position.x, b.position.y - 20, pts, '#a8322d', 1.4);
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
      sparkle(pos.x, pos.y, '#2a1d14');
      Sfx.split();
    } else if (type === 'boulder') {
      Body.setVelocity(r, { x: v.x * 0.25, y: Math.max(v.y, 0) + 24 });
      sparkle(r.position.x, r.position.y, '#2a1d14');
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

  // The rock rides in the sling below the arm tip. Aiming winches the arm further down rather
  // than stretching anything, so the rock only shifts a little with the arm.
  const SLING_OFFSET = { x: ANCHOR.x - (PIVOT.x + ARM_LONG * Math.cos(COCKED)), y: ANCHOR.y - (PIVOT.y + ARM_LONG * Math.sin(COCKED)) };
  const WINCH = 0.3; // extra arm travel (radians) at full power

  function slingRockPos() {
    if (!aim.active) return { x: ANCHOR.x, y: ANCHOR.y };
    const tip = armTip();
    const r = ROCKS[loaded].r;
    return { x: tip.x + SLING_OFFSET.x, y: Math.min(GROUND_Y - r - 2, tip.y + SLING_OFFSET.y) };
  }

  const aimPower = () => Math.min(Math.hypot(aim.vec.x, aim.vec.y), MAX_PULL) / MAX_PULL;

  function fire() {
    const v = aimVelocity();
    aim.active = false;
    if (!v || !loaded) return;
    launchVel = v;
    launchFrom = (() => { aim.active = true; const p = slingRockPos(); aim.active = false; return p; })();
    aim.notch = 0;
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
    const up = { x: Math.sin(b.angle), y: -Math.cos(b.angle) };
    const head = b.plugin.r - b.plugin.hr;
    particles.push({ type: 'hat', k: b.plugin.k, x: x + up.x * head, y: y + up.y * head, vx: rand(-3, 3) + b.velocity.x * 0.3, vy: rand(-9, -6), rot: b.angle, vr: rand(-0.25, 0.25), life: 120, max: 120, size: b.plugin.hr });
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
    for (const f of foes) {
      const p = f.plugin;
      if (p.flash > 0) p.flash = Math.max(0, p.flash - step / 250);
      if (!p.alive) continue;
      // Knocked flat and lying still: out of the fight.
      const tilt = Math.abs(Math.atan2(Math.sin(f.angle), Math.cos(f.angle)));
      p.down = tilt > TOPPLE_ANGLE && f.speed < 1.5 && simTime >= graceUntil ? p.down + step : 0;
      if (p.down > TOPPLE_TIME) destroyQueue.add(f);
    }

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
        setTimeout(() => { floater(pos.x, pos.y - 30, ROCK_BONUS, '#a8322d', 1.2); sparkle(pos.x, pos.y, '#d9a93b'); }, i * 250);
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
      if (d < Math.max(130, 60 / scale)) {
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
      const power = aimPower();
      arm.angle = COCKED - power * WINCH;
      // the winch ratchets with a click every fifth of full power
      const notch = Math.floor(power * 5);
      if (notch !== aim.notch) { if (notch > aim.notch) Sfx.click(); aim.notch = notch; }
    } else if (pan.active && e.pointerId === pan.id) {
      camX = clamp(pan.cam - (e.clientX - pan.sx) / scale, 0, camMax());
    }
  }

  function onUp(e) {
    if (aim.active && e.pointerId === aim.id) {
      if (state === 'aim' && aimVelocity()) fire();
      else { aim.active = false; aim.notch = 0; armTo(COCKED, 200, easeOut); }
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
  window.addEventListener('pointercancel', (e) => {
    if (aim.active && e.pointerId === aim.id) { aim.active = false; aim.notch = 0; armTo(COCKED, 200, easeOut); }
    if (e.pointerId === pan.id) pan.active = false;
  });
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
    drawFrame();
  }

  // Art direction: an illuminated manuscript / embroidered tapestry. Flat medieval pigments on
  // parchment, every shape outlined in ink, hatching instead of gradients.
  const INK = '#2a1d14';
  const PAL = {
    parch: '#efe2c2', parchDark: '#dcc89c', madder: '#a8322d', madderDark: '#7a1f1b', woad: '#34557f',
    verdigris: '#4f8a6e', leaf: '#6f9a55', leafDark: '#557c40', ochre: '#c8952e', gold: '#d9a93b',
    flesh: '#f0d2a8', iron: '#8d9196', ermine: '#f6f1e4', earth: '#7a4a2b',
  };
  const OUTLINE = 2.5;

  // Paper grain, rendered once and tiled over the sky.
  const grain = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${hash(i) < 0.5 ? '90,60,30' : '255,250,235'},${0.04 + hash(i + 1) * 0.06})`;
      g.fillRect(hash(i + 2) * 256, hash(i + 3) * 256, 1 + hash(i + 4) * 2, 1);
    }
    g.strokeStyle = 'rgba(110,80,40,0.08)';
    for (let i = 0; i < 40; i++) {
      const x = hash(i + 9) * 256, y = hash(i + 19) * 256;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y + 3, x + 6 + hash(i) * 20, y + hash(i + 5) * 8); g.stroke();
    }
    return ctx.createPattern(c, 'repeat');
  })();

  // Fill with a pigment, then outline in ink.
  function inked(fill, lw = OUTLINE) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // A thick timber: ink stroke under a pigment stroke.
  function timber(x0, y0, x1, y1, w, fill) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = w + OUTLINE * 2; line(x0, y0, x1, y1);
    ctx.strokeStyle = fill; ctx.lineWidth = w; line(x0, y0, x1, y1);
  }

  // Background ------------------------------------------------------------
  const clouds = Array.from({ length: 12 }, (_, i) => ({ x: i * 400 + hash(i) * 220, y: 90 + hash(i + 9) * 240, s: 0.7 + hash(i + 3) * 0.6, n: 3 + ((hash(i + 5) * 3) | 0) }));

  function drawSky() {
    ctx.fillStyle = PAL.parch;
    ctx.fillRect(0, 0, W, H);
    // a faint woad wash across the top of the page
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    g.addColorStop(0, 'rgba(52,85,127,0.22)');
    g.addColorStop(1, 'rgba(52,85,127,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, W, H);

    const gy = (GROUND_Y - camY) * scale; // ground line on screen
    const s = scale;
    // gilded sun with alternating rays
    const sunX = W * 0.8 - camX * s * 0.03, sunY = gy - 560 * s;
    ctx.save();
    ctx.translate(sunX, sunY);
    ctx.rotate(realTime * 0.00008);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, L = i % 2 ? 62 : 80;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.12) * 40 * s, Math.sin(a - 0.12) * 40 * s);
      ctx.lineTo(Math.cos(a) * L * s, Math.sin(a) * L * s);
      ctx.lineTo(Math.cos(a + 0.12) * 40 * s, Math.sin(a + 0.12) * 40 * s);
      ctx.closePath();
      inked(i % 2 ? PAL.madder : PAL.gold, 1.5 * s);
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(sunX, sunY, 42 * s, 0, Math.PI * 2);
    inked(PAL.gold, 2 * s);
    ctx.beginPath(); ctx.arc(sunX, sunY, 32 * s, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(42,29,20,0.35)'; ctx.lineWidth = 1.2 * s; ctx.stroke();

    // stylised curling clouds
    for (const c of clouds) {
      const wrap = 4800;
      const x = ((c.x - camX * 0.2 + realTime * 0.005 * c.s) % wrap + wrap) % wrap - 300;
      const cx = x * s, cy = gy - (780 - c.y) * s, k = c.s * s;
      const lobe = 26 * k, w = c.n * lobe * 1.5;
      if (cx + w < 0 || cx - w > W) continue;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy);
      for (let i = 0; i < c.n; i++) {
        const lx = cx - w / 2 + (i + 0.5) * (w / c.n);
        ctx.arc(lx, cy - (i % 2 ? 6 : 12) * k, w / c.n / 2 + 4 * k, Math.PI, 0);
      }
      ctx.lineTo(cx + w / 2, cy);
      ctx.bezierCurveTo(cx + w / 4, cy + 10 * k, cx - w / 4, cy + 10 * k, cx - w / 2, cy);
      inked('#e9eef0', 2 * s);
      // little interior curls
      ctx.strokeStyle = 'rgba(52,85,127,0.55)';
      ctx.lineWidth = 1.4 * s;
      for (let i = 0; i < c.n - 1; i++) {
        const lx = cx - w / 2 + (i + 1) * (w / c.n);
        ctx.beginPath(); ctx.arc(lx, cy - 6 * k, 6 * k, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke();
      }
    }

    const far = (x) => 330 + 90 * Math.sin(x * 0.0031) + 50 * Math.sin(x * 0.0083 + 1.3) + 18 * Math.sin(x * 0.027);
    const mid = (x) => 150 + 45 * Math.sin(x * 0.006 + 2) + 25 * Math.sin(x * 0.017);
    const near = (x) => 60 + 22 * Math.sin(x * 0.009 + 4) + 12 * Math.sin(x * 0.03);
    layer(0.12, '#c3c9bf', far, true);
    const castleX = (2300 - camX * 0.12) * s;
    drawCastleOutline(castleX, gy - (far(2300) - 8) * s, s * 0.9);
    layer(0.35, '#b2c08f', mid, true);
    drawTreeLine(0.35, mid);
    layer(0.6, '#97ad72', near, false);
  }

  // A distant range of hills with an inked crest and hatching beneath it.
  function layer(par, color, heightFn, hatch) {
    const gy = (GROUND_Y - camY) * scale;
    const pts = [];
    for (let sx = -8; sx <= W + 8; sx += 8) pts.push([sx, gy - heightFn(sx / scale + camX * par) * scale]);
    ctx.beginPath();
    ctx.moveTo(-8, H);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(W + 8, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8 * scale;
    ctx.stroke();
    if (!hatch) return;
    ctx.strokeStyle = 'rgba(42,29,20,0.22)';
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    const off = (camX * par * scale) % 16;
    for (let sx = -off; sx < W; sx += 16) {
      const y = gy - heightFn(sx / scale + camX * par) * scale;
      ctx.moveTo(sx, y + 6 * scale);
      ctx.lineTo(sx - 5 * scale, y + 20 * scale);
    }
    ctx.stroke();
  }

  // Manuscript "lollipop" trees.
  function drawTreeLine(par, heightFn) {
    const gy = (GROUND_Y - camY) * scale;
    const spacing = 70;
    const start = Math.floor((camX * par) / spacing) - 1;
    const end = start + Math.ceil(viewW / spacing) + 2;
    for (let i = start; i <= end; i++) {
      if (hash(i) < 0.5) continue;
      const wx = i * spacing + hash(i + 50) * 30;
      const sx = (wx - camX * par) * scale;
      const base = gy - (heightFn(wx) - 2) * scale;
      const h = (34 + hash(i + 7) * 22) * scale, r = (11 + hash(i + 8) * 6) * scale;
      ctx.strokeStyle = INK; ctx.lineWidth = 3 * scale;
      line(sx, base, sx, base - h + r);
      ctx.beginPath();
      if (hash(i + 2) < 0.5) {
        ctx.arc(sx, base - h, r, 0, Math.PI * 2);
      } else { // trefoil canopy
        ctx.arc(sx - r * 0.55, base - h + r * 0.2, r * 0.7, Math.PI * 0.5, Math.PI * 1.6);
        ctx.arc(sx, base - h - r * 0.4, r * 0.7, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(sx + r * 0.55, base - h + r * 0.2, r * 0.7, Math.PI * 1.4, Math.PI * 0.5);
        ctx.closePath();
      }
      inked(PAL.verdigris, 1.6 * scale);
      ctx.fillStyle = 'rgba(42,29,20,0.35)';
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(sx + (hash(i + j) - 0.5) * r, base - h + (hash(i + j + 3) - 0.5) * r, 1.4 * scale, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function drawCastleOutline(x, base, s) {
    ctx.beginPath();
    const P = [[-75, 0], [-75, 85], [-69, 85], [-69, 93], [-62, 93], [-62, 85], [-56, 85], [-56, 93], [-49, 93], [-49, 50],
      [-18, 50], [-18, 110], [-12, 110], [-12, 118], [-5, 118], [-5, 110], [5, 110], [5, 118], [12, 118], [12, 110], [18, 110], [18, 50],
      [49, 50], [49, 93], [56, 93], [56, 85], [62, 85], [62, 93], [69, 93], [69, 85], [75, 85], [75, 0]];
    P.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * s, base - py * s) : ctx.moveTo(x + px * s, base - py * s)));
    ctx.closePath();
    inked('#d6d2c2', 1.6 * s);
    ctx.beginPath(); ctx.arc(x, base, 10 * s, Math.PI, 0); inked('#6b6458', 1.4 * s);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4 * s;
    line(x, base - 118 * s, x, base - 142 * s);
    ctx.beginPath(); ctx.moveTo(x, base - 142 * s); ctx.lineTo(x + 16 * s, base - 137 * s); ctx.lineTo(x, base - 132 * s); ctx.closePath();
    inked(PAL.madder, 1.2 * s);
  }

  // The ground is a strip of stitched meadow over an embroidered border band.
  function drawGround() {
    const x0 = camX - 80, x1 = camX + viewW + 80;
    const bottom = camY + viewH + 20;
    ctx.fillStyle = PAL.earth;
    ctx.fillRect(x0, GROUND_Y, x1 - x0, bottom - GROUND_Y);
    // border band of lozenges
    const top = GROUND_Y + 22, bh = 46;
    ctx.fillStyle = PAL.madderDark;
    ctx.fillRect(x0, top, x1 - x0, bh);
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    line(x0, top, x1, top); line(x0, top + bh, x1, top + bh);
    for (let i = Math.floor(x0 / 60); i < x1 / 60; i++) {
      const cx = i * 60 + 30, cy = top + bh / 2;
      ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx, cy - 16); ctx.lineTo(cx + 20, cy); ctx.lineTo(cx, cy + 16); ctx.closePath();
      inked(i % 2 ? PAL.ochre : PAL.woad, 1.8);
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); inked(PAL.parch, 1.2);
      // cross-stitches between motifs
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1.5;
      line(cx + 26, cy - 4, cx + 34, cy + 4); line(cx + 26, cy + 4, cx + 34, cy - 4);
    }
    // stitched dashes below
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(239,226,194,0.35)'; ctx.lineWidth = 2;
    line(x0, top + bh + 14, x1, top + bh + 14);
    ctx.setLineDash([]);
    // meadow
    ctx.fillStyle = PAL.leaf;
    ctx.fillRect(x0, GROUND_Y - 2, x1 - x0, 24);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    line(x0, GROUND_Y - 2, x1, GROUND_Y - 2);
    ctx.strokeStyle = PAL.leafDark; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = Math.floor(x0 / 12); i < x1 / 12; i++) {
      const gx = i * 12 + hash(i) * 5;
      ctx.moveTo(gx, GROUND_Y + 16); ctx.lineTo(gx + 3, GROUND_Y + 4);
    }
    ctx.stroke();
    // tiny flowers
    for (let i = Math.floor(x0 / 45); i < x1 / 45; i++) {
      if (hash(i + 77) < 0.55) continue;
      const fx = i * 45 + hash(i) * 20, fy = GROUND_Y + 8 + hash(i + 1) * 8;
      ctx.fillStyle = hash(i + 2) < 0.5 ? PAL.madder : PAL.parch;
      for (let p = 0; p < 3; p++) { ctx.beginPath(); ctx.arc(fx + Math.cos(p * 2.1) * 2.4, fy + Math.sin(p * 2.1) * 2.4, 2, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function drawHill(b) {
    const { w, h } = b.plugin;
    const x = b.position.x - w / 2, y = GROUND_Y - h;
    roundRect(x, y, w, h + 4, 22);
    inked('#a9804f', 2.5);
    // scale pattern, the medieval shorthand for rock
    ctx.save();
    roundRect(x, y, w, h + 4, 22);
    ctx.clip();
    ctx.strokeStyle = 'rgba(42,29,20,0.35)';
    ctx.lineWidth = 1.5;
    for (let row = 0, yy = y + 26; yy < GROUND_Y + 10; row++, yy += 18) {
      ctx.beginPath();
      for (let xx = x + (row % 2 ? 11 : 0); xx < x + w + 22; xx += 22) { ctx.moveTo(xx + 11, yy); ctx.arc(xx, yy, 11, 0, Math.PI); }
      ctx.stroke();
    }
    ctx.restore();
    roundRect(x - 3, y - 5, w + 6, 16, 8);
    inked(PAL.leaf, 2.5);
  }

  // Trebuchet ---------------------------------------------------------------
  function drawTrebuchet() {
    const wood = '#b07a3e', woodBack = '#8a5a2c';
    // back frame (offset for depth)
    timber(TX - 52, 784, PIVOT.x + 6, PIVOT.y - 4, 9, woodBack);
    timber(TX + 72, 784, PIVOT.x + 6, PIVOT.y - 4, 9, woodBack);
    timber(TX - 22, 715, TX + 40, 715, 6, woodBack);

    // counterweight: a timber box of stones
    const tail = armTail();
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    line(tail.x - 10, tail.y, tail.x - 14, tail.y + 18);
    line(tail.x + 10, tail.y, tail.x + 14, tail.y + 18);
    ctx.beginPath(); ctx.rect(tail.x - 25, tail.y + 16, 50, 44); inked('#9c6a35');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      ctx.beginPath(); ctx.arc(tail.x - 14 + i * 14, tail.y + 29 + j * 17, 6, 0, Math.PI * 2); inked('#b9b4a6', 1.5);
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    line(tail.x - 25, tail.y + 38, tail.x + 25, tail.y + 38);

    // arm
    const tip = armTip();
    timber(tail.x, tail.y, tip.x, tip.y, 10, wood);
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    for (const t of [0.12, 0.45, 0.8]) {
      const bx = lerp(tail.x, tip.x, t), by = lerp(tail.y, tip.y, t);
      const nx = -(tip.y - tail.y) / (ARM_LONG + ARM_SHORT), ny = (tip.x - tail.x) / (ARM_LONG + ARM_SHORT);
      line(bx - nx * 7, by - ny * 7, bx + nx * 7, by + ny * 7);
    }

    // front frame
    timber(TX - 62, 784, PIVOT.x, PIVOT.y, 10, wood);
    timber(TX + 62, 784, PIVOT.x, PIVOT.y, 10, wood);
    timber(TX - 34, 712, TX + 34, 712, 7, wood);
    ctx.beginPath(); ctx.rect(TX - 100, 778, 200, 16); inked(wood);
    ctx.strokeStyle = 'rgba(42,29,20,0.5)'; ctx.lineWidth = 1.2;
    line(TX - 94, 786, TX + 94, 786);
    // wheels
    for (const wx of [TX - 72, TX + 72]) {
      ctx.beginPath(); ctx.arc(wx, 803, 17, 0, Math.PI * 2); inked(PAL.ochre, 3);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        line(wx - Math.cos(a) * 15, 803 - Math.sin(a) * 15, wx + Math.cos(a) * 15, 803 + Math.sin(a) * 15);
      }
      ctx.beginPath(); ctx.arc(wx, 803, 4, 0, Math.PI * 2); inked(INK, 1);
    }
    ctx.beginPath(); ctx.arc(PIVOT.x, PIVOT.y, 8, 0, Math.PI * 2); inked(PAL.iron);
    ctx.beginPath(); ctx.arc(PIVOT.x, PIVOT.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    // pennant with a gold cross
    const fx = TX + 2, fy = PIVOT.y - 16;
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    line(fx, fy, fx, fy - 62);
    const wave = Math.sin(realTime * 0.004) * 4;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 62);
    ctx.quadraticCurveTo(fx + 24, fy - 62 + wave, fx + 50, fy - 52 + wave * 0.6);
    ctx.quadraticCurveTo(fx + 24, fy - 44 + wave, fx, fy - 38);
    ctx.closePath();
    inked(PAL.madder, 2);
    ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2.5;
    line(fx + 9, fy - 50 + wave * 0.4, fx + 23, fy - 50 + wave * 0.6);
    line(fx + 16, fy - 57 + wave * 0.5, fx + 16, fy - 43 + wave * 0.5);
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
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    if (rp) {
      const r = ROCKS[loaded || 'stone'].r;
      line(tip.x, tip.y, rp.x - r * 0.7, rp.y);
      line(tip.x, tip.y, rp.x + r * 0.7, rp.y);
      drawRock(loaded || 'stone', rp.x, rp.y, 0);
      ctx.strokeStyle = INK; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, r + 1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      ctx.strokeStyle = '#9c6a35'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, r + 1, 0.17 * Math.PI, 0.83 * Math.PI); ctx.stroke();
    } else {
      const sway = Math.sin(realTime * 0.006) * 6;
      line(tip.x, tip.y, tip.x + sway, tip.y + 34);
    }
    // grab hint: a pointing manicule-style ring of ink ticks
    if (state === 'aim' && !aim.active && loaded) {
      const pulse = 0.5 + 0.5 * Math.sin(realTime * 0.006);
      const R = ROCKS[loaded].r + 14 + pulse * 5;
      ctx.strokeStyle = `rgba(168,50,45,${0.45 + pulse * 0.45})`;
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + realTime * 0.0008;
        line(ANCHOR.x + Math.cos(a) * R, ANCHOR.y + Math.sin(a) * R, ANCHOR.x + Math.cos(a) * (R + 8), ANCHOR.y + Math.sin(a) * (R + 8));
      }
    }
  }

  function drawQueue() {
    const list = state === 'won' ? [] : queue;
    list.forEach((t, i) => {
      const p = queuePos(i, list);
      drawRock(t, p.x, p.y, 0);
    });
  }

  // While aiming: an inked flight line with an arrowhead, and a brass quadrant showing the angle.
  function drawTrajectory() {
    if (!aim.active || state !== 'aim') return;
    const v = aimVelocity();
    if (!v) return;
    let x = LAUNCH.x, y = LAUNCH.y, vx = v.x, vy = v.y;
    const pts = [[x, y]];
    for (let i = 0; i < 90; i++) {
      vy += GRAVITY_STEP;
      x += vx; y += vy;
      if (y > GROUND_Y) break;
      if (i % 2 === 1) pts.push([x, y]);
    }
    ctx.lineCap = 'round';
    ctx.setLineDash([10, 9]);
    for (let i = 1; i < pts.length; i++) {
      ctx.strokeStyle = `rgba(42,29,20,${0.85 * (1 - i / pts.length)})`;
      ctx.lineWidth = 3;
      line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    }
    ctx.setLineDash([]);
    if (pts.length > 2) {
      const [ax, ay] = pts[pts.length - 1], [bx, by] = pts[pts.length - 2];
      const a = Math.atan2(ay - by, ax - bx);
      ctx.fillStyle = `rgba(168,50,45,0.6)`;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(a) * 10, ay + Math.sin(a) * 10);
      ctx.lineTo(ax + Math.cos(a + 2.5) * 10, ay + Math.sin(a + 2.5) * 10);
      ctx.lineTo(ax + Math.cos(a - 2.5) * 10, ay + Math.sin(a - 2.5) * 10);
      ctx.fill();
    }

    // quadrant
    const len = Math.min(Math.hypot(aim.vec.x, aim.vec.y), MAX_PULL) / MAX_PULL;
    const deg = clamp(Math.round((-Math.atan2(v.y, v.x) * 180) / Math.PI), -30, 90);
    const qx = TX + 150, qy = 778, R = 84;
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.arc(qx, qy, R, -Math.PI / 2, 0); ctx.closePath();
    inked(PAL.gold, 2.5);
    ctx.beginPath(); ctx.arc(qx, qy, R - 12, -Math.PI / 2, 0); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
    for (let d = 0; d <= 90; d += 15) {
      const a = (-d * Math.PI) / 180;
      ctx.lineWidth = d % 45 ? 1.2 : 2.2;
      line(qx + Math.cos(a) * (R - (d % 45 ? 8 : 12)), qy + Math.sin(a) * (R - (d % 45 ? 8 : 12)), qx + Math.cos(a) * R, qy + Math.sin(a) * R);
    }
    // power fills the quadrant's inner band
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.arc(qx, qy, (R - 14) * len, -Math.PI / 2, 0); ctx.closePath();
    ctx.fillStyle = 'rgba(168,50,45,0.35)'; ctx.fill();
    const na = (-Math.max(0, deg) * Math.PI) / 180;
    ctx.strokeStyle = PAL.madder; ctx.lineWidth = 3.5;
    line(qx, qy, qx + Math.cos(na) * (R + 6), qy + Math.sin(na) * (R + 6));
    ctx.beginPath(); ctx.arc(qx, qy, 5, 0, Math.PI * 2); inked(PAL.madder, 1.5);
    ctx.font = `24px ${CANVAS_SERIF}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.fillText(`${deg}°`, qx + 8, qy - 8);
  }

  // Ink motion strokes behind a rock in flight.
  function drawTrails() {
    ctx.lineCap = 'round';
    for (const r of activeRocks) {
      const t = r.plugin.trail;
      for (let i = 1; i < t.length; i += 2) {
        ctx.strokeStyle = `rgba(42,29,20,${0.1 + (i / t.length) * 0.45})`;
        ctx.lineWidth = 2;
        line(t[i - 1].x, t[i - 1].y, lerp(t[i - 1].x, t[i].x, 0.6), lerp(t[i - 1].y, t[i].y, 0.6));
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
      ctx.beginPath(); ctx.arc(0, 2, r, 0, Math.PI * 2); inked('#b5562b');
      ctx.beginPath(); ctx.rect(-r * 0.45, -r - 4, r * 0.9, 8); inked('#8a3a18', 2);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 2, r * 0.62, 0.15, Math.PI - 0.15); ctx.stroke();
      ctx.strokeStyle = PAL.ochre; ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) line(i * r * 0.28, -r * 0.35, i * r * 0.28 + 3, -r * 0.1);
      // a flame in three curling tongues
      const f = 0.85 + Math.sin(realTime * 0.03 + x) * 0.15;
      ctx.beginPath();
      ctx.moveTo(-7, -r - 3);
      ctx.quadraticCurveTo(-10, -r - 14 * f, -3, -r - 24 * f);
      ctx.quadraticCurveTo(-2, -r - 14 * f, 0, -r - 12 * f);
      ctx.quadraticCurveTo(2, -r - 20 * f, 6, -r - 28 * f);
      ctx.quadraticCurveTo(10, -r - 12 * f, 7, -r - 3);
      ctx.closePath();
      inked(PAL.madder, 1.5);
      ctx.beginPath(); ctx.ellipse(0, -r - 9 * f, 3, 6 * f, 0, 0, Math.PI * 2); ctx.fillStyle = PAL.gold; ctx.fill();
      ctx.restore();
      return;
    }
    const fill = type === 'boulder' ? '#8f897c' : type === 'scatter' ? '#7d8088' : '#a39e92';
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rr = r * (0.9 + hash(i + r) * 0.12);
      i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    inked(fill);
    // hatching on the shadow side
    ctx.strokeStyle = 'rgba(42,29,20,0.55)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const o = r * (0.15 + i * 0.17);
      line(o, r * 0.75 - i * 1.5, o + r * 0.25, r * 0.35 - i * 2);
    }
    ctx.fillStyle = 'rgba(42,29,20,0.5)';
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.25, r * 0.08, 0, Math.PI * 2); ctx.fill();
    if (type === 'scatter') {
      ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(r * 0.1, 0); ctx.lineTo(-r * 0.7, r * 0.6); ctx.moveTo(r * 0.1, 0); ctx.lineTo(r * 0.85, r * 0.4); ctx.stroke();
    }
    if (type === 'boulder') {
      for (const [lx, ly] of [[-0.35, -0.55], [0.1, -0.7], [-0.6, -0.1]]) {
        ctx.beginPath(); ctx.arc(lx * r, ly * r, r * 0.12, 0, Math.PI * 2); inked(PAL.verdigris, 1);
      }
    }
    ctx.restore();
  }

  // Blocks -----------------------------------------------------------------
  const BLOCK_FILL = { wood: '#c08a4c', stone: '#bdb6a5', straw: '#e0b852' };

  function drawBlock(b) {
    const p = b.plugin;
    if (p.shape === 'tri') {
      const v = b.vertices;
      const path = () => { ctx.beginPath(); ctx.moveTo(v[0].x, v[0].y); for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y); ctx.closePath(); };
      path();
      ctx.fillStyle = p.m === 'wood' ? PAL.madder : p.m === 'stone' ? '#6f7a86' : BLOCK_FILL[p.m];
      ctx.fill();
      // rows of scalloped roof tiles
      ctx.save();
      path();
      ctx.clip();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      ctx.strokeStyle = 'rgba(42,29,20,0.6)';
      ctx.lineWidth = 1.5;
      for (let row = 0, y = -p.h; y < p.h; row++, y += 11) {
        ctx.beginPath();
        for (let x = -p.w + (row % 2 ? 7 : 0); x < p.w; x += 14) { ctx.moveTo(x + 7, y); ctx.arc(x, y, 7, 0, Math.PI); }
        ctx.stroke();
      }
      ctx.restore();
      path();
      inked(null);
      drawCracks(b, p);
      return;
    }
    const w = p.w, h = p.h;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = BLOCK_FILL[p.m];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    const seed = b.id;
    if (p.m === 'wood') {
      ctx.strokeStyle = 'rgba(42,29,20,0.55)';
      ctx.lineWidth = 1.3;
      const horiz = w >= h;
      const L = horiz ? w : h, S = horiz ? h : w;
      const n = Math.max(2, Math.round(S / 8));
      for (let i = 1; i < n; i++) {
        const o = -S / 2 + (S * i) / n;
        const gap = (hash(seed + i) - 0.5) * L * 0.6;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(-L / 2, o); ctx.lineTo(gap - 6, o); ctx.moveTo(gap + 6, o); ctx.lineTo(L / 2, o); }
        else { ctx.moveTo(o, -L / 2); ctx.lineTo(o, gap - 6); ctx.moveTo(o, gap + 6); ctx.lineTo(o, L / 2); }
        ctx.stroke();
      }
      // a knot
      const kp = (hash(seed) - 0.5) * L * 0.5;
      ctx.beginPath();
      horiz ? ctx.ellipse(kp, 0, 5, 3, 0, 0, Math.PI * 2) : ctx.ellipse(0, kp, 3, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = INK;
      if (w > 30 && h > 30) for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(nx * (w / 2 - 6), ny * (h / 2 - 6), 1.8, 0, Math.PI * 2); ctx.fill(); }
    } else if (p.m === 'stone') {
      ctx.strokeStyle = 'rgba(42,29,20,0.7)';
      ctx.lineWidth = 1.6;
      const rowH = h > 40 ? 25 : h;
      let row = 0;
      for (let y = -h / 2; y < h / 2; y += rowH, row++) {
        line(-w / 2, y, w / 2, y);
        const brickW = w > 40 ? 28 : w;
        for (let x = -w / 2 + (row % 2 ? brickW / 2 : 0); x < w / 2; x += brickW) {
          if (x > -w / 2) line(x, y, x, y + rowH);
        }
      }
      ctx.fillStyle = 'rgba(42,29,20,0.35)';
      for (let i = 0; i < Math.max(2, (w * h) / 500); i++) {
        ctx.beginPath(); ctx.arc(-w / 2 + hash(seed + i) * w, -h / 2 + hash(seed + i + 30) * h, 1.1, 0, Math.PI * 2); ctx.fill();
      }
    } else if (p.m === 'straw') {
      ctx.strokeStyle = 'rgba(42,29,20,0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let y = -h / 2 + 4; y < h / 2; y += 6) {
        for (let x = -w / 2 + ((y / 6) % 2 ? 0 : 4); x < w / 2; x += 9) { ctx.moveTo(x, y); ctx.lineTo(x + 5, y - 2); }
      }
      ctx.stroke();
      ctx.strokeStyle = PAL.madderDark;
      ctx.lineWidth = 3;
      line(-w / 4, -h / 2, -w / 4, h / 2);
      line(w / 4, -h / 2, w / 4, h / 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    inked(null);
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
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
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
  // Upright figures in the manner of the Bayeux Tapestry, seen in profile and facing the trebuchet.
  const HERALDRY = [[PAL.madder, PAL.gold], [PAL.woad, PAL.parch], [PAL.verdigris, PAL.gold], [PAL.ochre, PAL.madderDark]];

  function drawFoe(b) {
    const p = b.plugin;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    drawFigure(p.k, p.w, p.h, p.hp / p.maxHp, b.id);
    if (p.flash > 0) {
      ctx.fillStyle = `rgba(239,226,194,${p.flash * 0.75})`;
      ctx.fillRect(-p.w / 2 - 4, -p.h / 2 - 8, p.w + 8, p.h + 10);
    }
    ctx.restore();
  }

  function drawFigure(k, w, h, health, id) {
    const [field, charge] = HERALDRY[id % HERALDRY.length];
    const hr = w * 0.34;              // head radius
    const headY = -h / 2 + hr * 1.3;
    const shoulderY = headY + hr * 1.15;
    const hipY = h * 0.2;
    const blink = ((realTime + id * 977) % 3600) < 130;
    ctx.lineCap = 'round';

    if (k === 'king') {
      // long robe to the ground with an ermine hem
      ctx.beginPath();
      ctx.moveTo(-w * 0.32, shoulderY); ctx.lineTo(w * 0.32, shoulderY);
      ctx.lineTo(w * 0.52, h / 2); ctx.lineTo(-w * 0.52, h / 2); ctx.closePath();
      inked(PAL.madder);
      ctx.beginPath(); ctx.rect(-w * 0.52, h / 2 - 8, w * 1.04, 8); inked(PAL.ermine, 1.5);
      ctx.fillStyle = INK;
      for (let i = 0; i < 4; i++) ctx.fillRect(-w * 0.42 + i * w * 0.27, h / 2 - 6, 1.6, 4);
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 3; line(-w * 0.38, hipY - 4, w * 0.38, hipY - 4);
      // sceptre
      ctx.strokeStyle = INK; ctx.lineWidth = 4.5; line(-w * 0.55, -h * 0.05, -w * 0.55, -h * 0.5);
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2.5; line(-w * 0.55, -h * 0.05, -w * 0.55, -h * 0.5);
      ctx.beginPath(); ctx.arc(-w * 0.55, -h * 0.5 - 3, 4, 0, Math.PI * 2); inked(PAL.gold, 1.5);
    } else {
      // legs in coloured hose
      ctx.strokeStyle = INK; ctx.lineWidth = 6;
      line(-w * 0.18, hipY, -w * 0.24, h / 2 - 2); line(w * 0.18, hipY, w * 0.22, h / 2 - 2);
      ctx.strokeStyle = k === 'knight' ? PAL.iron : PAL.madderDark; ctx.lineWidth = 3.5;
      line(-w * 0.18, hipY, -w * 0.24, h / 2 - 2); line(w * 0.18, hipY, w * 0.22, h / 2 - 2);
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      line(-w * 0.24, h / 2 - 1, -w * 0.42, h / 2 - 1); line(w * 0.22, h / 2 - 1, w * 0.04, h / 2 - 1);
      // tunic or mail hauberk
      ctx.beginPath();
      ctx.moveTo(-w * 0.34, shoulderY); ctx.lineTo(w * 0.34, shoulderY);
      ctx.lineTo(w * 0.48, hipY + 6); ctx.lineTo(-w * 0.48, hipY + 6); ctx.closePath();
      if (k === 'knight') {
        inked('#a7abb0');
        ctx.fillStyle = 'rgba(42,29,20,0.45)';
        for (let yy = shoulderY + 4; yy < hipY + 4; yy += 4) for (let xx = -w * 0.4 + ((yy / 4) % 2) * 2; xx < w * 0.4; xx += 4) ctx.fillRect(xx, yy, 1.2, 1.2);
      } else {
        inked(field);
        ctx.strokeStyle = charge; ctx.lineWidth = 2; line(-w * 0.44, hipY + 2, w * 0.44, hipY + 2);
      }
      // spear (soldier) or sword (knight), held upright behind
      if (k === 'soldier') {
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5; line(w * 0.42, h / 2, w * 0.42, -h * 0.62);
        ctx.beginPath(); ctx.moveTo(w * 0.42, -h * 0.62 - 10); ctx.lineTo(w * 0.42 + 3.5, -h * 0.62); ctx.lineTo(w * 0.42, -h * 0.62 + 3); ctx.lineTo(w * 0.42 - 3.5, -h * 0.62); ctx.closePath();
        inked(PAL.iron, 1.5);
      } else {
        ctx.strokeStyle = INK; ctx.lineWidth = 4; line(w * 0.44, shoulderY + 8, w * 0.44, -h * 0.62);
        ctx.strokeStyle = '#d8dadc'; ctx.lineWidth = 2; line(w * 0.44, shoulderY + 4, w * 0.44, -h * 0.6);
        ctx.strokeStyle = INK; ctx.lineWidth = 3; line(w * 0.3, shoulderY + 6, w * 0.58, shoulderY + 6);
      }
    }

    // head in profile
    ctx.beginPath(); ctx.arc(0, headY, hr, 0, Math.PI * 2); inked(PAL.flesh, 2);
    const ex = -hr * 0.45, ey = headY - hr * 0.05;
    ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    if (health < 0.5) { line(ex - 2, ey - 2, ex + 2, ey + 2); line(ex - 2, ey + 2, ex + 2, ey - 2); }
    else if (blink) line(ex - 2, ey, ex + 2, ey);
    else { ctx.beginPath(); ctx.arc(ex, ey, 1.4, 0, Math.PI * 2); ctx.fill(); }
    line(-hr * 0.95, headY + hr * 0.1, -hr * 1.15, headY + hr * 0.35); // nose
    line(-hr * 1.15, headY + hr * 0.35, -hr * 0.85, headY + hr * 0.4);

    if (k === 'soldier') {
      // conical helm with a nasal guard
      ctx.beginPath();
      ctx.moveTo(-hr * 1.1, headY - hr * 0.15); ctx.lineTo(0, headY - hr * 2.0); ctx.lineTo(hr * 1.1, headY - hr * 0.15); ctx.closePath();
      inked(PAL.iron, 2);
      ctx.strokeStyle = INK; ctx.lineWidth = 3; line(-hr * 0.75, headY - hr * 0.3, -hr * 0.8, headY + hr * 0.45);
    } else if (k === 'knight') {
      // flat-topped great helm and a plume
      ctx.beginPath(); ctx.rect(-hr * 1.15, headY - hr * 1.2, hr * 2.3, hr * 2.3); inked(PAL.iron, 2);
      ctx.fillStyle = INK; ctx.fillRect(-hr * 1.15, headY - hr * 0.2, hr * 1.3, hr * 0.28);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; line(-hr * 0.3, headY + hr * 0.25, -hr * 0.3, headY + hr * 0.9);
      ctx.beginPath(); ctx.ellipse(hr * 0.5, headY - hr * 1.5, hr * 0.9, hr * 0.38, -0.5, 0, Math.PI * 2); inked(field, 1.5);
    } else {
      // beard and crown
      ctx.beginPath(); ctx.moveTo(-hr * 0.9, headY + hr * 0.4); ctx.quadraticCurveTo(-hr * 0.5, headY + hr * 1.9, hr * 0.5, headY + hr * 0.7); ctx.lineTo(hr * 0.2, headY + hr * 0.3); ctx.closePath();
      inked(PAL.ermine, 1.5);
      ctx.beginPath();
      ctx.moveTo(-hr, headY - hr * 0.55); ctx.lineTo(-hr * 1.05, headY - hr * 1.5); ctx.lineTo(-hr * 0.5, headY - hr * 1.0);
      ctx.lineTo(0, headY - hr * 1.75); ctx.lineTo(hr * 0.5, headY - hr * 1.0); ctx.lineTo(hr * 1.05, headY - hr * 1.5); ctx.lineTo(hr, headY - hr * 0.55); ctx.closePath();
      inked(PAL.gold, 1.6);
      ctx.beginPath(); ctx.arc(0, headY - hr * 0.85, hr * 0.16, 0, Math.PI * 2); ctx.fillStyle = PAL.madder; ctx.fill();
    }

    if (k !== 'king') {
      // shield carried in front: a kite shield for soldiers, a heater for knights
      const sx = -w * 0.46, sy = shoulderY + 2, sw = w * 0.62;
      ctx.beginPath();
      if (k === 'soldier') {
        ctx.moveTo(sx - sw / 2, sy + 4);
        ctx.quadraticCurveTo(sx, sy - 6, sx + sw / 2, sy + 4);
        ctx.lineTo(sx, sy + h * 0.5);
      } else {
        ctx.moveTo(sx - sw / 2, sy); ctx.lineTo(sx + sw / 2, sy);
        ctx.quadraticCurveTo(sx + sw / 2, sy + h * 0.28, sx, sy + h * 0.38);
        ctx.quadraticCurveTo(sx - sw / 2, sy + h * 0.28, sx - sw / 2, sy);
      }
      ctx.closePath();
      inked(field, 2);
      ctx.strokeStyle = charge; ctx.lineWidth = 2.5;
      if (k === 'soldier') {
        ctx.beginPath(); ctx.arc(sx, sy + h * 0.13, 3, 0, Math.PI * 2); ctx.fillStyle = charge; ctx.fill();
        line(sx, sy + 2, sx, sy + h * 0.42);
      } else {
        ctx.beginPath(); ctx.moveTo(sx - sw * 0.38, sy + h * 0.2); ctx.lineTo(sx, sy + h * 0.08); ctx.lineTo(sx + sw * 0.38, sy + h * 0.2); ctx.stroke();
      }
      if (health < 0.5) { ctx.strokeStyle = INK; ctx.lineWidth = 1.5; line(sx - sw * 0.2, sy + 3, sx + sw * 0.1, sy + h * 0.18); }
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
        ctx.beginPath();
        if (p.straw) ctx.rect(-p.size / 2, -1, p.size, 2);
        else ctx.rect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
        inked(p.color, 1.2);
        ctx.restore();
      } else if (p.type === 'dust' || p.type === 'smoke') {
        // puffs drawn as inked curls
        ctx.globalAlpha = a * (p.type === 'smoke' ? 0.8 : 0.9);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
        inked(p.type === 'smoke' ? '#8e877a' : p.tint ? PAL.parch : '#d9c79f', 1.4);
        ctx.strokeStyle = INK; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.3, 0.5, Math.PI * 1.6); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'fire') {
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.5), 0, Math.PI * 2);
        inked(a > 0.6 ? PAL.gold : PAL.madder, 1.2);
        ctx.globalAlpha = 1;
      } else if (p.type === 'spark') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        line(p.x - p.vx, p.y - p.vy, p.x, p.y);
        ctx.globalAlpha = 1;
      } else if (p.type === 'flash') {
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = PAL.madder; ctx.lineWidth = 5;
        const R = p.size * (1.2 - a);
        for (let i = 0; i < 14; i++) {
          const an = (i / 14) * Math.PI * 2;
          line(p.x + Math.cos(an) * R * 0.4, p.y + Math.sin(an) * R * 0.4, p.x + Math.cos(an) * R * 0.75, p.y + Math.sin(an) * R * 0.75);
        }
        ctx.globalAlpha = 1;
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

  // The headgear knocked off a defeated foe; r is the head radius.
  function drawHat(k, r) {
    ctx.beginPath();
    if (k === 'king') {
      ctx.moveTo(-r, r * 0.4); ctx.lineTo(-r * 1.05, -r * 0.55); ctx.lineTo(-r * 0.5, -r * 0.05); ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(r * 0.5, -r * 0.05); ctx.lineTo(r * 1.05, -r * 0.55); ctx.lineTo(r, r * 0.4); ctx.closePath();
      inked(PAL.gold, 1.6);
    } else if (k === 'knight') {
      ctx.rect(-r * 1.15, -r * 1.15, r * 2.3, r * 2.3);
      inked(PAL.iron, 2);
      ctx.fillStyle = INK; ctx.fillRect(-r * 1.15, -r * 0.15, r * 1.3, r * 0.28);
    } else {
      ctx.moveTo(-r * 1.1, r * 0.6); ctx.lineTo(0, -r * 1.2); ctx.lineTo(r * 1.1, r * 0.6); ctx.closePath();
      inked(PAL.iron, 2);
    }
  }

  // Plunder tallies, lettered in red rubric.
  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life / 25, 0, 1);
      ctx.font = `${f.size}px ${CANVAS_BLACKLETTER}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = PAL.parch;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // A double ink rule around the page.
  function drawFrame() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, W - 20, H - 20);
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
      text = d.hint ? `${d.name} — ${d.hint}` : `${d.name} — draw back the sling & let fly`;
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

  // Wax seals stand in for ratings: a blobby red disc stamped with a castle tower.
  const SEAL_EDGE = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2, r = i % 2 ? 10.6 : 11.6;
    return `${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`;
  }).join(' L');
  const sealSvg = (on) => `<svg class="seal ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path class="wax" d="M${SEAL_EDGE}Z"/><circle class="rim" cx="12" cy="12" r="7.6"/><path class="tower" d="M8.5 16.5v-6h1.2v1.2h1.1v-1.2h2.4v1.2h1.1v-1.2h1.2v6zM11 16.5v-2a1 1 0 012 0v2z"/></svg>`;

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
        <span class="stars">${[0, 1, 2].map((s) => sealSvg(s < p.stars)).join('')}</span>`;
      b.title = lv.name;
      b.setAttribute('aria-label', `Level ${levelLabel(i)}: ${lv.name}${b.disabled ? ' (locked)' : ''}`);
      b.addEventListener('click', () => { Sfx.unlock(); Sfx.click(); startLevel(i); });
      ui.grid.appendChild(b);
    }
  }

  function showResult(won, stars, isBest) {
    const lastOfSet = levelIndex === SETS[setOf(levelIndex)].start + SETS[setOf(levelIndex)].count - 1;
    ui.resultTitle.textContent = won ? (levelIndex === LEVELS.length - 1 ? 'The Realm Is Yours!' : lastOfSet ? `${SETS[setOf(levelIndex)].name} Conquered!` : 'Victory!') : 'The Castle Stands';
    ui.resultSub.textContent = won ? levelDef.name + ' has fallen.' : 'Thy stones are spent. Try another angle!';
    ui.resultScore.textContent = score.toLocaleString();
    const best = (progress[levelIndex] || {}).best || 0;
    ui.resultBest.textContent = won && isBest ? 'New best!' : best ? `Best: ${best.toLocaleString()}` : '';
    ui.resultStars.innerHTML = [0, 1, 2].map((s) => sealSvg(false)).join('');
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
