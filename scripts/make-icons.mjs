// Draws the PWA icons in public/ from SVG: icon-192.png and icon-512.png (from public/icon.svg, rounded) and
// icon-maskable-512.png (full-bleed background, the eye inside the central safe zone so Android's circle or
// squircle mask never cuts it). Run after changing the logo or the palette:  node scripts/make-icons.mjs
//
// Uses sharp, which Next.js already installs for image optimisation (no extra dependency in package.json).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = (f) => path.join(root, "public", f);

// Same palette as the dark theme (--bg / --primary-bg in app/globals.css, THEME_COLOR in lib/theme.ts).
const BG = "#0d0830";

// Maskable: the safe zone is a circle of radius 40% around the centre; the orb (the website's logo) sits well inside it.
const MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><radialGradient id="o" cx="0.32" cy="0.3" r="0.75"><stop offset="0.08" stop-color="#fff"/><stop offset="0.22" stop-color="#cdb8ff"/><stop offset="0.52" stop-color="#8a6cff"/><stop offset="0.78" stop-color="#4b3bd6"/></radialGradient>
<radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#8d94ff" stop-opacity="0.45"/><stop offset="1" stop-color="#8d94ff" stop-opacity="0"/></radialGradient></defs>
<rect width="64" height="64" fill="${BG}"/>
<circle cx="32" cy="32" r="22" fill="url(#g)"/>
<circle cx="32" cy="32" r="14" fill="url(#o)"/>
</svg>`;

const icon = await readFile(pub("icon.svg"));
for (const size of [192, 512]) {
  await sharp(icon, { density: 72 * (size / 64) }).resize(size, size).png().toFile(pub(`icon-${size}.png`));
}
await sharp(Buffer.from(MASKABLE), { density: 72 * 8 }).resize(512, 512).png().toFile(pub("icon-maskable-512.png"));
console.log("wrote public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png");
