import { BarcodeError } from './constraints';

/**
 * The ONLY place `qrcode` and `bwip-js` are loaded. Both are imported dynamically, and this file is
 * itself reached only through a dynamic import from prepass.server.ts, so neither library can end
 * up in a client bundle.
 */

export const encodeQr = async (value: string): Promise<boolean[][]> => {
  const QRCode = (await import('qrcode')).default ?? (await import('qrcode'));
  let qr;
  try {
    // Medium error correction: keeps a URL-sized payload to a small version at label sizes.
    qr = (QRCode as typeof import('qrcode')).create(value, { errorCorrectionLevel: 'M' });
  } catch (error) {
    throw new BarcodeError(
      'too-large',
      `Value is too long to fit in a QR code (${value.length} characters): ${(error as Error).message}`
    );
  }
  const size = qr.modules.size;
  const data = qr.modules.data as ArrayLike<number>;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x += 1) row.push(Boolean(data[y * size + x]));
    rows.push(row);
  }
  return rows;
};

export const encodeCode128 = async (value: string): Promise<number[]> => {
  // bwip-js would silently UTF-8 encode other characters, which scanners then decode differently
  // from the value we were given. Printable ASCII round-trips exactly, so require it.
  if (!/^[\x20-\x7e]+$/.test(value)) {
    throw new BarcodeError('unencodable', 'Value cannot be encoded as Code 128: printable ASCII characters only');
  }
  // Explicit server subpath: the package root only matches browser/electron/react-native/node export
  // conditions, none of which bundler module resolution (tsc, webpack) selects reliably.
  const bwip = await import('bwip-js/node');
  const api = bwip.default ?? bwip;
  try {
    const result = api.raw('code128', value) as Array<{ sbs: number[] }>;
    return result[0].sbs;
  } catch (error) {
    throw new BarcodeError(
      'unencodable',
      `Value cannot be encoded as Code 128 (printable ASCII only): ${(error as Error).message}`
    );
  }
};
