# Trebuchet

A medieval siege physics game for the browser. Load your trebuchet, fling rocks at wooden huts and stone keeps, and knock out the soldiers, knights, and the King hiding inside.

- 12 levels with 1–3 star ratings and saved progress
- 4 kinds of ammo: **Stone**, **Scatter Shot** (tap mid-flight to split it in three), **Boulder** (tap to slam it down), and **Fire Pot** (bursts on impact, or tap to set it off)
- Wood, stone, and straw building pieces, each with its own strength
- Works with touch, mouse, and pen, in landscape or portrait
- Installable PWA that plays offline
- No build step and no dependencies to install. Physics comes from a bundled copy of [Matter.js](https://brm.io/matter-js/) (MIT), and sound effects are generated with the Web Audio API.

## Controls

| Action | How |
| --- | --- |
| Aim and fire | Drag the rock in the sling back, then let go. The dotted arc shows the path. |
| Special shot | Tap anywhere while the rock is in the air |
| Look around | Drag the background left or right |
| Pause / restart | Buttons in the top corners, or `Esc` and `R` |

## Run it locally

Any static file server will do. Service workers need `http://localhost` or HTTPS, so opening the file directly won't work.

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Host on GitHub Pages

1. Create a repository and push these files to the `main` branch:

   ```bash
   git init && git add . && git commit -m "Trebuchet"
   ```

   ```bash
   git branch -M main && git remote add origin https://github.com/<you>/trebuchet.git && git push -u origin main
   ```

2. On GitHub, go to **Settings → Pages**. Under **Source**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.
3. After a minute the game will be live at `https://<you>.github.io/trebuchet/`.

All paths are relative, so the game also works under a project subpath or a custom domain. The `.nojekyll` file stops GitHub from running Jekyll on the site.

### Shipping updates

The service worker serves the cached copy first and fetches updates in the background. When you deploy changes, bump `VERSION` in [`sw.js`](sw.js) (for example, `trebuchet-v2`). Players will get the new version on their next visit or the one after.

## Installing as an app

- **Android / Chrome / Edge:** open the site, then use the **Install Game** button on the title screen or the browser's install option.
- **iPhone / iPad:** open the site in Safari, tap **Share**, then **Add to Home Screen**.

Once installed, the game opens fullscreen in landscape.

## Project layout

```
index.html             page shell, menus, and HUD
css/style.css          UI styling (responsive, safe-area aware)
js/game.js             game loop, physics setup, rendering, input, UI
js/levels.js           level data; edit this to add or change levels
js/audio.js            synthesized sound effects
vendor/matter.min.js   Matter.js 0.20.0 physics engine
sw.js                  offline service worker
manifest.webmanifest   PWA manifest
icons/                 app icons (regenerate with tools/make_icons.py)
```

## Making levels

Each level in [`js/levels.js`](js/levels.js) is a list of pieces built with small helpers. Every `y` is measured upward from the ground, measured at the bottom of the piece:

```js
{
  name: 'My Fort',
  width: 2200,                       // world width; the trebuchet sits near x = 400
  rocks: ['stone', 'scatter', 'boulder'],
  items: [
    ...hut('wood', 1500, 0),         // two columns and a beam, 120 tall
    foe('soldier', 1500, 0),         // a soldier standing inside it
    ...hut('stone', 1500, 120),      // a second storey on top
    foe('knight', 1500, 120),
    roof('wood', 1500, 240, 150, 60),
    hill(1900, 400, 120),            // a static earthen mound, 120 high
  ],
}
```

Materials are `wood`, `stone`, and `straw`. Foes are `soldier`, `knight`, and `king`. Stars depend on how many rocks you have left when the last foe falls: 2 or more earns ★★★, 1 earns ★★, and 0 earns ★.
