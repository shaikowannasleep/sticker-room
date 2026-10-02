# Sticker Room 🧸

[![Deploy to GitHub Pages](https://github.com/shaikowannasleep/sticker-room/actions/workflows/deploy.yml/badge.svg)](https://github.com/shaikowannasleep/sticker-room/actions/workflows/deploy.yml)

> 🎮 **Live Demo**: [https://shaikowannasleep.github.io/sticker-room/](https://shaikowannasleep.github.io/sticker-room/)

A cute 3D "unbox & decorate" sticker puzzle for web and mobile, built with **Three.js** and **Jolt Physics** (WASM).

Inspired by the unpacking/decorating genre (e.g. *Fantasy Room*): tap the box, stickers pop out with real
physics, drag each one onto its silhouette in a cozy diorama room, earn combos, coins and 3 stars.

## Run
```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from your phone on the LAN)
npm run build      # static site in dist/ — host anywhere (Netlify, GitHub Pages, S3…)
```

## Game
- 4 rooms × 3 stages (12 levels); each stage adds new stickers on top of the previous ones.
- Items are Jolt rigid bodies: ballistic pop-out, springy carry with sway, bounces, weeble self-righting.
- Placed stickers become static colliders, so loose items can rest on them.
- Hints (first per level free), combos, coins, stars, saved progress (localStorage), PWA manifest.

## Why it stays cool on phones
- One custom toon shader, no shadow maps, no post-processing; analytic blob shadows.
- Static room merged into a handful of draw calls (~36 draw calls, ~75k tris per frame).
- Render-on-demand: 60 fps only while something moves (capped at 60 even on 120 Hz screens), 20 fps ambient when idle, nothing when the tab is hidden.
- Adaptive resolution governor (`src/quality.js`) lowers pixel ratio if frames get slow; DPR capped at 1.5 on mobile.
- Jolt: single thread, fixed 60 Hz step with max 2 sub-steps, sleeping bodies, reused scratch vectors.
- Optional Battery saver (30 fps) in Settings. Audio is synthesized (no asset downloads).

## Layout
`src/game.js` game loop & logic · `src/physics.js` Jolt wrapper · `src/items.js` procedural stickers ·
`src/rooms.js` rooms & levels · `src/fx.js` particles · `src/materials.js` shader · `src/audio.js` WebAudio.
Add a sticker in `ITEM_DEFS`, add a level by adding slots to a room's `stages`.
