/* Trebuchet — generated levels.
 *
 * Levels 1–12 in js/levels.js are hand-built. This file adds 12 more to finish the first set of 24,
 * then three further sets of 24. Each level is built from a fixed seed with the same pieces
 * (huts, towers, bridges…), so every player gets the same levels every time. Difficulty rises
 * across a set and from set to set: more foes, tougher foes, stone instead of wood, taller
 * towers, and more special ammunition.
 *
 * window.LEVEL_SETS lists the sets as { name, start, count } ranges into window.LEVELS.
 */
(() => {
  'use strict';

  const { col, beam, box, roof, foe, hill, hut, stack } = window.LevelKit;
  const SET_SIZE = 24;
  const SETS = [
    { name: 'The Campaign', blurb: '' },
    { name: 'Marcher Lords', blurb: 'Set 2 — the borderlands are better defended.' },
    { name: 'The Iron Marches', blurb: 'Set 3 — stone walls, hardened knights.' },
    { name: 'The Last Crown', blurb: 'Set 4 — the final sieges. Kings hold every hill.' },
  ];
  const HAND_MADE = window.LEVELS.length; // 12

  const mulberry = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const between = (c, a, b) => a + Math.floor(c.rng() * (b - a + 1)); // integer in [a, b]
  const choose = (c, arr) => arr[Math.floor(c.rng() * arr.length)];
  const weighted = (c, table) => {
    let r = c.rng() * table.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of table) { if ((r -= w) < 0) return v; }
    return table[table.length - 1][0];
  };

  // ---- per-level knobs, all derived from difficulty d in 0..1
  const material = (c, stoneBias = 0) => {
    const r = c.rng();
    if (r < c.stoneP + stoneBias) return 'stone';
    if (r > 1 - c.strawP) return 'straw';
    return 'wood';
  };
  const foeKind = (c, bump = 0) => (c.rng() < c.knightP + bump ? 'knight' : 'soldier');
  const foeAt = (c, x, y, bump) => foe(foeKind(c, bump), x, y);

  // ---- structures. Each is built around x = 0 and shifted into place by the layout.
  // tower: stacked huts, each usually holding a foe, topped by a roof or a foe on the last beam.
  function tower(c, x, y0 = 0, o = {}) {
    const tiers = o.tiers || 1 + Math.floor(c.rng() * (1 + 3 * c.d));
    let w = o.w || between(c, 100, 140);
    const items = [];
    let y = y0, placed = 0, below = null;
    for (let i = 0; i < tiers; i++) {
      let m = o.stone ? 'stone' : material(c);
      // Straw is far too light to carry stone; the base would be crushed before anyone fires.
      if (below === 'straw' && m === 'stone') m = 'wood';
      below = m;
      const h = m === 'stone' ? 110 : 100;
      items.push(...hut(m, x, y, w, h));
      const kingHere = o.king && i === Math.min(1, tiers - 1);
      if (kingHere) { items.push(foe('king', x, y)); placed++; }
      else if (c.rng() < 0.75 || (i === tiers - 1 && !placed)) { items.push(foeAt(c, x, y)); placed++; }
      y += h + 20;
      w = Math.max(90, w - between(c, 0, 10));
    }
    if (c.rng() < 0.6) items.push(roof('wood', x, y, w + 30, 60));
    else items.push(foeAt(c, x, y));
    return { items, hw: (w + 20) / 2 + 20 + (tiers > 1 ? 10 : 0) };
  }

  // wall: a stack of boxes, sometimes doubled, sometimes with a foe on top.
  function wall(c, x) {
    const n = between(c, 2, 3 + Math.round(c.d * 2));
    const m = material(c, 0.1);
    const items = stack(m, x, 0, n);
    if (c.rng() < 0.4) items.push(...stack(m, x + 50, 0, n));
    if (c.rng() < 0.55) items.push(foeAt(c, x, n * 50));
    return { items, hw: 60 };
  }

  // palisade: a row of tall wooden posts with a foe sheltering behind.
  function palisade(c, x) {
    const n = between(c, 3, 5), h = between(c, 100, 140), items = [];
    for (let i = 0; i < n; i++) items.push(col('wood', x + i * 30, 0, h));
    items.push(foeAt(c, x + n * 30 + 20, 0));
    return { items, hw: n * 15 + 40 };
  }

  // pyramid: boxes stacked in shrinking rows with a foe on the point.
  function pyramid(c, x) {
    const n = between(c, 2, 3 + (c.d > 0.5 ? 1 : 0));
    const m = c.rng() < c.strawP + 0.35 ? 'straw' : material(c);
    const s = m === 'straw' ? 60 : 50, items = [];
    for (let i = 0; i < n; i++) {
      const cnt = n - i;
      for (let j = 0; j < cnt; j++) items.push(box(m, x + (j - (cnt - 1) / 2) * s, i * s, s));
    }
    items.push(foeAt(c, x, n * s));
    return { items, hw: (n * s) / 2 + 30 };
  }

  // bridge: two stacks joined by a beam, with foes on top and (usually) underneath.
  function bridge(c, x) {
    const n = between(c, 2, 4), dist = between(c, 180, 250);
    const m = material(c, 0.1);
    let bm = c.rng() < c.stoneP ? 'stone' : 'wood';
    if (m === 'straw' && bm === 'stone') bm = 'wood'; // same reason as in tower()
    const items = [...stack(m, x - dist / 2, 0, n), ...stack(m, x + dist / 2, 0, n)];
    items.push(beam(bm, x, n * 50, dist + 44));
    if (c.rng() < 0.45) items.push(foeAt(c, x - 36, n * 50 + 20), foeAt(c, x + 36, n * 50 + 20));
    else items.push(foeAt(c, x, n * 50 + 20));
    if (c.rng() < 0.7) items.push(foeAt(c, x, 0, 0.1));
    return { items, hw: dist / 2 + 50 };
  }

  // cradle: a stone slab on two stacks, foes sheltering under it and a hut on top.
  function cradle(c, x) {
    const n = between(c, 2, 3), dist = between(c, 220, 280), items = [];
    items.push(...stack('stone', x - dist / 2, 0, n), ...stack('stone', x + dist / 2, 0, n));
    items.push(beam('stone', x, n * 50, dist + 60, 24));
    const under = between(c, 2, 3);
    for (let i = 0; i < under; i++) items.push(foeAt(c, x + (i - (under - 1) / 2) * 55, 0));
    const top = tower(c, x, n * 50 + 24, { tiers: 1, w: 110 });
    items.push(...top.items);
    return { items, hw: dist / 2 + 80 };
  }

  // gate: a tall hut (taller columns than a tower tier) with a foe inside and one on top.
  function gate(c, x) {
    const h = between(c, 120, 160), w = between(c, 100, 130), m = material(c, 0.15);
    const items = [...hut(m, x, 0, w, h), foeAt(c, x, 0, 0.1), foeAt(c, x, h + 20)];
    return { items, hw: (w + 20) / 2 + 30 };
  }

  // hill fort: a static mound carrying one or two towers.
  function hillFort(c, x) {
    const hh = between(c, 80, 130), n = c.d > 0.45 && c.rng() < 0.6 ? 2 : 1;
    const w = n === 2 ? between(c, 480, 540) : between(c, 340, 420);
    const items = [hill(x, w, hh)];
    for (let i = 0; i < n; i++) {
      const tx = n === 1 ? x : x + (i ? 1 : -1) * w * 0.24;
      items.push(...tower(c, tx, hh, { tiers: between(c, 1, 2 + (c.d > 0.6 ? 1 : 0)) }).items);
    }
    return { items, hw: w / 2 };
  }

  // keep: the boss castle. A king in the middle tower, flanked by two smaller towers, on a hill.
  function keep(c, x) {
    const hh = between(c, 90, 120), w = 660;
    const items = [hill(x, w, hh)];
    items.push(...tower(c, x, hh, { tiers: between(c, 2, 3), king: true, stone: true, w: 150 }).items);
    items.push(...tower(c, x - 215, hh, { tiers: 2 }).items, ...tower(c, x + 215, hh, { tiers: 2 }).items);
    return { items, hw: w / 2 };
  }

  const countFoes = (items) => items.filter((it) => it.t === 'foe').length;
  const shift = (items, dx) => items.map((it) => ({ ...it, x: it.x + dx }));

  // ---- level assembly
  function buildItems(c, boss) {
    const target = clamp(Math.round(2.5 + 7 * c.d + (c.rng() * 2 - 1)) + (boss ? 1 : 0), 2, 12);
    const out = [];
    let x = 1180 + c.rng() * 100, foes = 0, parts = 0, fillers = 0;
    const place = (s, gap = 0) => {
      const cx = x + s.hw + gap;
      out.push(...shift(s.items, cx));
      x = cx + s.hw + between(c, 50, 130);
      foes += countFoes(s.items);
      parts++;
    };
    if (boss) place(keep(c, 0));
    else if (c.rng() < 0.4) { place(c.rng() < 0.5 ? wall(c, 0) : palisade(c, 0)); fillers++; }

    const table = [
      [tower, 3], [bridge, 2], [gate, 1.5], [pyramid, Math.max(0.2, 1.4 - 1.6 * c.d)],
      [cradle, 0.2 + 1.6 * c.d], [hillFort, 0.3 + 1.4 * c.d], [wall, fillers ? 0 : 0.6],
    ];
    let guard = 0;
    while (foes < target && parts < 5 && guard++ < 30) {
      const build = weighted(c, table);
      const s = build(c, 0);
      if (x + 2 * s.hw > 2420 && parts) break;
      place(s);
    }
    return { items: out, foes, right: x };
  }

  function rockList(c, foes, set) {
    const n = clamp(Math.round(foes * 0.75 + 1.8), 3, 8);
    const table = [['stone', Math.max(2, 5 - set)], ['scatter', 2.2], ['boulder', 1.2 + 0.4 * set], ['firepot', 1.2 + 0.4 * set]];
    const list = [c.rng() < 0.6 ? 'stone' : 'scatter'];
    while (list.length < n) list.push(weighted(c, table));
    return list;
  }

  const ADJ = ['Crooked', 'Grey', 'Iron', 'Hollow', 'Raven', 'Ember', 'Thorn', 'Wolf', 'Ashen', 'Gilded', 'Black', 'Silent',
    'Bleak', 'Stormy', 'Mossy', 'Broken', 'Lonely', 'Proud', 'Frozen', 'Crimson', 'Pale', 'Sunken', 'Windy', 'Old', 'Briar', 'Saltmarsh'];
  const NOUN = ['Gate', 'Watch', 'Hold', 'Spire', 'Bastion', 'Barbican', 'Ford', 'Rampart', 'Cairn', 'Mill', 'Garrison', 'Redoubt',
    'Outpost', 'Palisade', 'Moat', 'Tower', 'Keep', 'Bridge', 'Hall', 'Abbey', 'Fen', 'Bulwark', 'Crag', 'Parapet', 'Chapel', 'Ridge'];

  function makeLevel(index) {
    const set = Math.floor(index / SET_SIZE), k = index % SET_SIZE;
    const rng = mulberry(7919 * (index + 1) + 104729);
    const d = clamp(0.15 + 0.2 * set + 0.55 * (k / (SET_SIZE - 1)), 0, 1);
    const c = { rng, d, set, k, stoneP: 0.1 + 0.6 * d, strawP: Math.max(0.03, 0.3 - 0.35 * d), knightP: 0.05 + 0.45 * d };
    const boss = k === SET_SIZE - 1 || (set >= 1 && k === 11) || (set >= 2 && k % 6 === 5);
    const built = buildItems(c, boss);
    // The name draws from its own stream so tweaking the layout code does not rename levels.
    const nr = mulberry(31 * index + 17);
    const name = `${ADJ[Math.floor(nr() * ADJ.length)]} ${NOUN[Math.floor(nr() * NOUN.length)]}`;
    const level = {
      name,
      width: Math.max(2000, Math.ceil((built.right + 250) / 50) * 50),
      rocks: rockList(c, built.foes, set),
      items: built.items,
    };
    if (k === 0 && SETS[set].blurb) level.tip = SETS[set].blurb;
    if (boss && k === SET_SIZE - 1) level.tip = 'A king holds this castle. Topple him!';
    return level;
  }

  // Make names unique across the whole game by appending a numeral to repeats.
  const seen = new Set(window.LEVELS.map((l) => l.name));
  for (let i = HAND_MADE; i < SETS.length * SET_SIZE; i++) {
    const lv = makeLevel(i);
    let n = lv.name, roman = 1;
    while (seen.has(n)) n = `${lv.name} ${['II', 'III', 'IV', 'V', 'VI'][roman++ - 1] || roman}`;
    lv.name = n;
    seen.add(n);
    window.LEVELS.push(lv);
  }

  window.LEVEL_SETS = SETS.map((s, i) => ({ name: s.name, start: i * SET_SIZE, count: SET_SIZE }));
})();
