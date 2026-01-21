// TODO: Consolidate with @alga-psa/ui/lib/colorUtils after circular dependency is resolved
// This is a temporary duplication to break the tags -> ui cycle

export interface ColorResult {
  background: string;
  text: string;
}

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

// Convert HSL to hex without external dependencies
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const generateEntityColor = (name: string): ColorResult => {
  const hue = hashString(name) % 360;

  return {
    background: hslToHex(hue, 85, 92),
    text: hslToHex(hue, 90, hue >= 30 && hue <= 210 ? 20 : 25),
  };
};
