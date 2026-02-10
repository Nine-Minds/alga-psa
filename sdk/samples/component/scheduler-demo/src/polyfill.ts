// Polyfill for TextEncoder/TextDecoder in environments that lack them (e.g. QuickJS)

class TextEncoderPolyfill {
  encode(str: string): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i += 1) {
      let codePoint = str.charCodeAt(i);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        } else {
          codePoint = 0xfffd;
        }
      } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
        codePoint = 0xfffd;
      }

      if (codePoint <= 0x7f) {
        bytes.push(codePoint);
      } else if (codePoint <= 0x7ff) {
        bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      } else if (codePoint <= 0xffff) {
        bytes.push(
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f)
        );
      } else {
        bytes.push(
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f)
        );
      }
    }
    return Uint8Array.from(bytes);
  }
}

class TextDecoderPolyfill {
  decode(bytes?: Uint8Array | null): string {
    if (!bytes || bytes.length === 0) return '';

    let result = '';
    for (let i = 0; i < bytes.length; ) {
      const byte1 = bytes[i];
      let codePoint = 0xfffd;
      if (byte1 <= 0x7f) {
        codePoint = byte1;
        i += 1;
      } else if (byte1 >= 0xc2 && byte1 <= 0xdf && i + 1 < bytes.length) {
        const byte2 = bytes[i + 1];
        if ((byte2 & 0xc0) === 0x80) {
          codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f);
          i += 2;
        } else {
          i += 1;
        }
      } else if (byte1 >= 0xe0 && byte1 <= 0xef && i + 2 < bytes.length) {
        const byte2 = bytes[i + 1];
        const byte3 = bytes[i + 2];
        if ((byte2 & 0xc0) === 0x80 && (byte3 & 0xc0) === 0x80) {
          const temp = ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
          if (temp >= 0x800 && (temp < 0xd800 || temp > 0xdfff)) {
            codePoint = temp;
            i += 3;
          } else {
            i += 1;
          }
        } else {
          i += 1;
        }
      } else if (byte1 >= 0xf0 && byte1 <= 0xf4 && i + 3 < bytes.length) {
        const byte2 = bytes[i + 1];
        const byte3 = bytes[i + 2];
        const byte4 = bytes[i + 3];
        if ((byte2 & 0xc0) === 0x80 && (byte3 & 0xc0) === 0x80 && (byte4 & 0xc0) === 0x80) {
          const temp =
            ((byte1 & 0x07) << 18) |
            ((byte2 & 0x3f) << 12) |
            ((byte3 & 0x3f) << 6) |
            (byte4 & 0x3f);
          if (temp >= 0x10000 && temp <= 0x10ffff) {
            codePoint = temp;
            i += 4;
          } else {
            i += 1;
          }
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }

      if (codePoint <= 0xffff) {
        result += String.fromCharCode(codePoint);
      } else {
        const adjusted = codePoint - 0x10000;
        result += String.fromCharCode((adjusted >> 10) + 0xd800);
        result += String.fromCharCode((adjusted & 0x3ff) + 0xdc00);
      }
    }

    return result;
  }
}

if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = TextEncoderPolyfill;
}

if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = TextDecoderPolyfill;
}

export {};

