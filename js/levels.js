/* Trebuchet — level definitions.
 *
 * Coordinates are world units. The ground surface is at y = 820 and "y" passed
 * to the helpers below is the height of the piece's *bottom* above the ground,
 * which makes stacking easy: a 100-tall column at y=0 has its top at y=100.
 */
window.LEVELS = (() => {
  const G = 820;
  const colW = (m) => (m === 'stone' ? 24 : 20);

  const col = (m, x, y, h = 100, w = colW(m)) => ({ t: 'block', m, shape: 'rect', x, y: G - y - h / 2, w, h });
  const beam = (m, x, y, w = 140, h = 20) => ({ t: 'block', m, shape: 'rect', x, y: G - y - h / 2, w, h });
  const box = (m, x, y, s = 50) => ({ t: 'block', m, shape: 'rect', x, y: G - y - s / 2, w: s, h: s });
  // Triangular roof; y is the height of its base line.
  const roof = (m, x, y, w = 140, h = 70) => ({ t: 'block', m, shape: 'tri', x, y: G - y, w, h });
  const foe = (k, x, y = 0) => ({ t: 'foe', k, x, y: G - y });
  // Static earthen mound; its top surface is h above the ground.
  const hill = (x, w, h) => ({ t: 'hill', x, w, h });
  // Two columns with a beam laid across. Total height is h + 20.
  const hut = (m, x, y, w = 120, h = 100) => [
    col(m, x - w / 2 + colW(m) / 2, y, h),
    col(m, x + w / 2 - colW(m) / 2, y, h),
    beam(m, x, y + h, w + 20),
  ];
  const stack = (m, x, y, n, s = 50) => Array.from({ length: n }, (_, i) => box(m, x, y + i * s, s));

  // Shared with js/levels-gen.js, which builds the later levels from the same pieces.
  window.LevelKit = { colW, col, beam, box, roof, foe, hill, hut, stack };

  return [
    {
      name: 'The Watchpost',
      width: 2000,
      rocks: ['stone', 'stone', 'stone'],
      tip: 'Drag the rock back from the trebuchet and let go to fling it.',
      items: [
        ...hut('wood', 1400, 0), foe('soldier', 1400, 0),
        ...hut('wood', 1400, 120), foe('soldier', 1400, 120),
      ],
    },
    {
      name: 'Twin Huts',
      width: 2100,
      rocks: ['stone', 'stone', 'stone', 'stone'],
      items: [
        ...hut('wood', 1300, 0),
        ...hut('wood', 1300, 120), foe('soldier', 1300, 120),
        ...hut('wood', 1620, 0, 140), foe('soldier', 1620, 0),
        box('wood', 1580, 120), box('wood', 1660, 120),
        beam('wood', 1620, 170, 150), foe('soldier', 1620, 190),
      ],
    },
    {
      name: 'The Stone Keep',
      width: 2100,
      rocks: ['stone', 'boulder', 'stone'],
      tip: 'The Boulder is heavy. Tap the screen mid-flight to send it crashing down.',
      items: [
        ...stack('wood', 1300, 0, 3),
        ...hut('stone', 1550, 0, 140, 110), foe('knight', 1550, 0),
        ...hut('wood', 1550, 130), foe('soldier', 1550, 130),
        roof('wood', 1550, 250, 150, 60),
      ],
    },
    {
      name: 'Straw Village',
      width: 2200,
      rocks: ['scatter', 'stone', 'scatter', 'stone'],
      tip: 'Scatter Shot: tap mid-flight to split it into three.',
      items: [
        box('straw', 1250, 0, 60), box('straw', 1310, 0, 60), box('straw', 1280, 60, 60), foe('soldier', 1280, 120),
        box('straw', 1500, 0, 60), box('straw', 1560, 0, 60), box('straw', 1620, 0, 60),
        beam('wood', 1560, 60, 200), foe('soldier', 1520, 80), foe('soldier', 1600, 80),
        ...stack('straw', 1820, 0, 3, 60), foe('soldier', 1820, 180),
      ],
    },
    {
      name: 'Hill Fort',
      width: 2300,
      rocks: ['stone', 'scatter', 'boulder', 'stone'],
      items: [
        hill(1650, 520, 110),
        ...hut('wood', 1500, 110), foe('soldier', 1500, 110),
        ...hut('wood', 1500, 230), foe('soldier', 1500, 230),
        ...hut('stone', 1780, 110, 140, 110), foe('knight', 1780, 110),
        box('wood', 1745, 240), box('wood', 1815, 240),
        beam('wood', 1780, 290, 140), foe('soldier', 1780, 310),
      ],
    },
    {
      name: 'The Bridge',
      width: 2300,
      rocks: ['stone', 'scatter', 'boulder', 'stone'],
      items: [
        ...stack('stone', 1350, 0, 4),
        ...stack('stone', 1550, 0, 4),
        ...stack('stone', 1750, 0, 4),
        beam('wood', 1444, 200, 208), beam('wood', 1656, 200, 208),
        foe('soldier', 1440, 220), foe('soldier', 1660, 220),
        ...hut('stone', 1900, 0, 120, 100), foe('knight', 1900, 0),
      ],
    },
    {
      name: 'The Gatehouse',
      width: 2300,
      rocks: ['boulder', 'stone', 'scatter', 'stone', 'scatter'],
      items: [
        ...hut('stone', 1400, 0, 100), foe('soldier', 1400, 0),
        ...hut('stone', 1400, 120, 100), foe('knight', 1400, 120),
        roof('wood', 1400, 240, 130, 60),
        col('wood', 1500, 0, 140), col('wood', 1600, 0, 140),
        beam('wood', 1550, 140, 140), foe('soldier', 1550, 160),
        ...hut('stone', 1700, 0, 100), foe('soldier', 1700, 0),
        ...hut('stone', 1700, 120, 100), foe('knight', 1700, 120),
        roof('wood', 1700, 240, 130, 60),
      ],
    },
    {
      name: 'Fire in the Hold',
      width: 2200,
      rocks: ['firepot', 'firepot', 'stone', 'boulder'],
      tip: 'Fire Pot: bursts on impact, or tap to set it off early.',
      items: [
        ...stack('stone', 1450, 0, 3),
        ...stack('stone', 1700, 0, 3),
        beam('stone', 1575, 150, 310, 24),
        foe('soldier', 1520, 0), foe('soldier', 1575, 0), foe('soldier', 1630, 0),
        ...hut('wood', 1575, 174), foe('knight', 1575, 174),
      ],
    },
    {
      name: 'Tower of Knights',
      width: 2300,
      rocks: ['boulder', 'scatter', 'firepot', 'stone', 'stone'],
      items: [
        ...hut('wood', 1400, 0), foe('soldier', 1400, 0),
        ...hut('stone', 1650, 0, 130), foe('soldier', 1650, 0),
        ...hut('wood', 1650, 120, 120), foe('knight', 1650, 120),
        ...hut('stone', 1650, 240, 130), foe('soldier', 1650, 240),
        ...hut('wood', 1650, 360, 120), foe('knight', 1650, 360),
        roof('wood', 1650, 480, 150, 70),
      ],
    },
    {
      name: 'The Double Wall',
      width: 2400,
      rocks: ['stone', 'boulder', 'scatter', 'firepot', 'stone'],
      items: [
        ...stack('stone', 1250, 0, 3), ...stack('stone', 1300, 0, 3), foe('soldier', 1275, 150),
        ...hut('wood', 1550, 0), foe('knight', 1550, 0),
        ...hut('wood', 1550, 120), foe('soldier', 1550, 120),
        hill(2000, 400, 130),
        ...hut('stone', 2000, 130, 140, 110), foe('knight', 2000, 130),
        ...hut('wood', 2000, 260), foe('soldier', 2000, 260),
        roof('wood', 2000, 380, 150, 70),
      ],
    },
    {
      name: 'The Citadel',
      width: 2550,
      rocks: ['boulder', 'firepot', 'scatter', 'stone', 'boulder', 'stone'],
      items: [
        col('wood', 1400, 0, 120), col('wood', 1440, 0, 120), col('wood', 1480, 0, 120),
        hill(1900, 700, 120),
        ...stack('stone', 1650, 120, 3), foe('soldier', 1650, 270),
        ...hut('stone', 1900, 120, 160, 110), foe('knight', 1900, 120),
        ...hut('stone', 1900, 250, 140, 100), foe('knight', 1900, 250),
        roof('wood', 1900, 370, 170, 70),
        ...hut('wood', 2150, 120), foe('soldier', 2150, 120),
        ...hut('wood', 2150, 240), foe('soldier', 2150, 240),
      ],
    },
    {
      name: "The King's Keep",
      width: 2550,
      rocks: ['boulder', 'firepot', 'scatter', 'boulder', 'firepot', 'stone', 'scatter'],
      tip: 'Topple the King to take the realm!',
      items: [
        ...stack('stone', 1350, 0, 2), ...stack('stone', 1400, 0, 2), foe('soldier', 1375, 100),
        hill(2000, 620, 100),
        ...hut('stone', 1800, 100, 100), foe('knight', 1800, 100),
        ...hut('wood', 1800, 220, 100), foe('soldier', 1800, 220),
        roof('wood', 1800, 340, 120, 60),
        ...hut('stone', 2000, 100, 160, 120), foe('knight', 2000, 100),
        ...hut('stone', 2000, 240, 140, 110), foe('king', 2000, 240),
        roof('wood', 2000, 370, 170, 80),
        ...hut('stone', 2200, 100, 100), foe('knight', 2200, 100),
        ...hut('wood', 2200, 220, 100), foe('soldier', 2200, 220),
        roof('wood', 2200, 340, 120, 60),
      ],
    },
  ];
})();
