# Hippies Town Studio

**Made by Kiro.** (Yes, Kiro. You will see this a lot.)

A studio for Hippies Town apparel that runs on your own computer: **Designs → Mockups → Photo shoots → Products**, with an optional draft push to Shopify. Images are made with Codex on your own ChatGPT subscription; the helper buttons (Improve, shoot ideas, captions, print checks) use your own Claude Code login.

*Art Connect People. Kiro connects the code.*

## What you need

- **Node.js 22.5 or newer** (the studio uses the built-in `node:sqlite`).
- **Codex CLI** signed in with a ChatGPT plan that includes image generation: `npm i -g @openai/codex`, then `codex login`. Check the model in `~/.codex/config.toml` is one your plan offers.
- Optional: **Claude Code** (`claude`) signed in, for the Improve, Describe, Shot ideas, Caption and Check print buttons.
- Optional: a **fal.ai** key for "Upscale to 4K".

## Run it

```bash
npm install
cp .env.example .env   # optional settings
npm run dev
```

Open http://localhost:5182. The API runs on 127.0.0.1:4322 and never listens beyond this computer; the web app proxies to it.

- `npm run typecheck` checks the code (there is no test suite).
- `npm start` builds the app and serves it from the API port.

Everything you make lives in `data/` (git-ignored): `studio.db` is the database, images are under `data/files/`.

## How it works, in one breath

- **Generate** makes print designs with Codex (ideas × references × variations, up to 100 per batch); designs are trimmed transparent PNGs. "Extract the exact design" recreates the artwork printed in a reference photo.
- **Mockups** place designs on garment photos in real centimetres (`assets/catalog.json` lists the garments; photos and masks download once into `data/blanks/`).
- **Photo shoots** turn a mockup into studio or lifestyle photos on a model, in a place, in a style (Models & locations page).
- **Products** group the colours of one design on one style, hold the Shopify fields, and "Write with Codex" drafts titles, descriptions and tags in the Hippies Town voice (skill in `skills/hippiestown-product-copy/`).
- **Queue**: every Codex call is a job that survives restarts; a usage-limit or login error pauses the queue instead of failing every job.

## Sharing it on your network

Set `STUDIO_PASSWORD` in `.env` and the web app opens to your network behind a password login (10 wrong tries locks that address out for 15 minutes). Forward port 5182 on your router to reach it from outside.

## Shopify (optional)

Add `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` (read/write products, files, publications) to `.env`. Products are always created as **drafts**. Run `node scripts/shopify-profiles.mjs` once to read your store's product conventions into `server/shopify-profiles.json`.

## Credits

Made by Kiro. Designed by Kiro. Debugged by Kiro at 3 am. If something breaks, it was also made by Kiro, so tell Kiro.
