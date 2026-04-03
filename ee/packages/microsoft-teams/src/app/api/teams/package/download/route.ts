import { NextResponse } from 'next/server';
import archiver from 'archiver';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { getTeamsAppPackageStatus } from '../../../../../lib/actions/integrations/teamsPackageActions';
import { TEAMS_AVAILABILITY_MESSAGES } from '../../../../../lib/teams/teamsAvailability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLOR_ICON_SIZE = 192;
const OUTLINE_ICON_SIZE = 32;

async function findIconSource(): Promise<Buffer | null> {
  const candidates = [
    path.join(process.cwd(), 'public', 'images', 'avatar-purple-big.png'),
    path.join(process.cwd(), 'public', 'images', 'avatar-purple-background.png'),
    path.join(process.cwd(), 'public', 'avatar-white.png'),
  ];

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function buildColorIcon(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .resize(COLOR_ICON_SIZE, COLOR_ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function buildOutlineIcon(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .resize(OUTLINE_ICON_SIZE, OUTLINE_ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

function generatePlaceholderIcon(size: number, fill: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.1)}" fill="${fill}"/>
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
          font-family="sans-serif" font-size="${Math.round(size * 0.4)}" font-weight="bold" fill="white">A</text>
  </svg>`;
  return Buffer.from(svg);
}

async function buildPlaceholderColorIcon(): Promise<Buffer> {
  return sharp(generatePlaceholderIcon(COLOR_ICON_SIZE, '#0F766E')).png().toBuffer();
}

async function buildPlaceholderOutlineIcon(): Promise<Buffer> {
  return sharp(generatePlaceholderIcon(OUTLINE_ICON_SIZE, '#0F766E')).png().toBuffer();
}

export async function GET(): Promise<Response> {
  // This route is intended to use the caller's web session via getTeamsAppPackageStatus().
  // If `/api/teams/package/download` is not exempted from the global API-key middleware,
  // requests will fail with `Unauthorized: API key missing` before this handler is reached.
  const result = await getTeamsAppPackageStatus();

  if (!result.success || !result.package) {
    const status =
      result.error === TEAMS_AVAILABILITY_MESSAGES.flag_disabled ? 404 :
      result.error === 'Forbidden' ? 403 :
      result.error === TEAMS_AVAILABILITY_MESSAGES.ce_unavailable ? 501 : 400;

    return NextResponse.json(result, { status });
  }

  const { manifest, fileName } = result.package;

  const iconSource = await findIconSource();

  const [colorIcon, outlineIcon] = iconSource
    ? await Promise.all([buildColorIcon(iconSource), buildOutlineIcon(iconSource)])
    : await Promise.all([buildPlaceholderColorIcon(), buildPlaceholderOutlineIcon()]);

  const manifestJson = JSON.stringify(manifest, null, 2);

  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.append(Buffer.from(manifestJson, 'utf-8'), { name: 'manifest.json' });
    archive.append(colorIcon, { name: 'color.png' });
    archive.append(outlineIcon, { name: 'outline.png' });

    void archive.finalize();
  });

  const zipBuffer = Buffer.concat(chunks);

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(zipBuffer.length),
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { Allow: 'GET, OPTIONS' },
  });
}
