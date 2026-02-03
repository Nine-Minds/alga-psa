import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(process.cwd(), "mobile");
const assetsDir = path.join(root, "assets");

const COLORS = {
  bg: "#0B1220",
  gradA: "#22C55E",
  gradB: "#06B6D4",
  white: "#FFFFFF",
};

function svgMonogram({ size, rounded = true, transparentBg = false }) {
  const corner = rounded ? Math.round(size * 0.22) : 0;
  const fontSize = Math.round(size * 0.52);
  const y = Math.round(size * 0.595);

  const background = transparentBg
    ? ""
    : `<rect width="${size}" height="${size}" rx="${corner}" fill="${COLORS.bg}" />`;

  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${COLORS.gradA}"/>
          <stop offset="100%" stop-color="${COLORS.gradB}"/>
        </linearGradient>
      </defs>
      ${background}
      <text x="${size / 2}" y="${y}" text-anchor="middle"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
        font-size="${fontSize}" font-weight="800" fill="url(#g)">A</text>
    </svg>`,
  );
}

async function writePng({ svg, outPath }) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(svg).png({ compressionLevel: 9 }).toFile(outPath);
}

async function main() {
  const iconSvg = svgMonogram({ size: 1024, rounded: true, transparentBg: false });
  const splashSvg = svgMonogram({ size: 1024, rounded: true, transparentBg: false });

  // Android adaptive icon foreground: transparent with extra padding
  const fgSize = 1024;
  const inner = 720;
  const pad = Math.floor((fgSize - inner) / 2);
  const adaptiveSvg = Buffer.from(
    `<svg width="${fgSize}" height="${fgSize}" viewBox="0 0 ${fgSize} ${fgSize}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${COLORS.gradA}"/>
          <stop offset="100%" stop-color="${COLORS.gradB}"/>
        </linearGradient>
      </defs>
      <g transform="translate(${pad}, ${pad})">
        <rect width="${inner}" height="${inner}" rx="${Math.round(inner * 0.22)}" fill="${COLORS.bg}" />
        <text x="${inner / 2}" y="${Math.round(inner * 0.6)}" text-anchor="middle"
          font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
          font-size="${Math.round(inner * 0.52)}" font-weight="800" fill="url(#g)">A</text>
      </g>
    </svg>`,
  );

  const faviconSvg = svgMonogram({ size: 48, rounded: true, transparentBg: false });

  await Promise.all([
    writePng({ svg: iconSvg, outPath: path.join(assetsDir, "icon.png") }),
    writePng({ svg: splashSvg, outPath: path.join(assetsDir, "splash-icon.png") }),
    writePng({ svg: adaptiveSvg, outPath: path.join(assetsDir, "adaptive-icon.png") }),
    writePng({ svg: faviconSvg, outPath: path.join(assetsDir, "favicon.png") }),
  ]);
}

await main();

