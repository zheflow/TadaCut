import sharp from "sharp";
import fs from "node:fs/promises";
await fs.mkdir("build", { recursive: true });
await fs.mkdir("assets", { recursive: true });
// Porcelain white and sakura pink, matching the default light skin.
const petal = "M0 0C-13-4-15-17-5-20L0-16L5-20C15-17 13-4 0 0Z";
const blossom = (x, y, scale, turn) =>
  `<g transform="translate(${x} ${y}) rotate(${turn}) scale(${scale})">${[0, 72, 144, 216, 288].map((a) => `<path d="${petal}" transform="rotate(${a})" fill="url(#p)"/>`).join("")}<circle r="2.4" fill="#c4507c"/></g>`;
const gradients = `<linearGradient id="b" x2="0" y2="1"><stop stop-color="#fffdfe"/><stop offset="1" stop-color="#fbe2eb"/></linearGradient><linearGradient id="g" x2="1" y2="1"><stop stop-color="#ee93b3"/><stop offset="1" stop-color="#b83e6c"/></linearGradient><radialGradient id="p"><stop stop-color="#fbd3e0"/><stop offset="1" stop-color="#f29bb9"/></radialGradient>`;
const art = `<rect x="24" y="24" width="976" height="976" rx="222" fill="url(#b)" stroke="#f1c9d7" stroke-width="8"/><path d="M300 310q0-32 32-42t32 32v424q0 32-32 42t-32-32zM480 367q0-32 32-17t32 47v260q0 32-32 17t-32-47zM660 310q0-32 32-17t32 47v424q0 32-32 17t-32-47z" fill="url(#g)"/>${blossom(818, 214, 3.4, 14)}`;
// macOS draws app icons as an 824 pt tile with a soft shadow inside the 1024 canvas.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>${gradients}<filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#5a2a3c" flood-opacity="0.22"/></filter></defs><g filter="url(#s)" transform="translate(512 512) scale(0.8443) translate(-512 -512)">${art}</g></svg>`;
// Windows icons fill their square.
const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>${gradients}</defs>${art}</svg>`;
await fs.writeFile("assets/brand.svg", svg);
await sharp(Buffer.from(svg)).png().toFile("build/icon.png");
const png = await sharp(Buffer.from(fullSvg)).resize(256, 256).png().toBuffer();
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
png.copy(ico, 22);
await fs.writeFile("build/icon.ico", ico);
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="440"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#fffafb"/><stop offset="1" stop-color="#fcebf1"/></linearGradient><radialGradient id="p"><stop stop-color="#fbd3e0"/><stop offset="1" stop-color="#f29bb9"/></radialGradient></defs><rect width="660" height="440" fill="url(#b)"/><text x="330" y="62" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" fill="#b83e6c">TadaCut</text><text x="330" y="93" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#a698a1">YOUR IDEAS. YOUR MODELS. YOUR STUDIO.</text><path d="M280 236h100m-18-12 18 12-18 12" stroke="#e58fae" stroke-width="3" fill="none"/>${blossom(604, 52, 1.1, 14)}<text x="330" y="372" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#80717b">Drag TadaCut to Applications</text></svg>`,
  ),
)
  .png()
  .toFile("build/dmg-background.png");
