import type { TenantBranding } from '@alga-psa/tenancy/actions';

// Helper function to convert hex to RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

// Helper function to generate color shades
const generateColorShades = (hex: string): Record<number, string> | null => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    console.error('Failed to convert hex to RGB:', hex);
    return null;
  }

  const shades: Record<number, string> = {};

  // Generate lighter shades (50-400)
  shades[50] = `${Math.min(255, Math.round(rgb.r + (255 - rgb.r) * 0.95))} ${Math.min(255, Math.round(rgb.g + (255 - rgb.g) * 0.95))} ${Math.min(255, Math.round(rgb.b + (255 - rgb.b) * 0.95))}`;
  shades[100] = `${Math.min(255, Math.round(rgb.r + (255 - rgb.r) * 0.9))} ${Math.min(255, Math.round(rgb.g + (255 - rgb.g) * 0.9))} ${Math.min(255, Math.round(rgb.b + (255 - rgb.b) * 0.9))}`;
  shades[200] = `${Math.min(255, Math.round(rgb.r + (255 - rgb.r) * 0.75))} ${Math.min(255, Math.round(rgb.g + (255 - rgb.g) * 0.75))} ${Math.min(255, Math.round(rgb.b + (255 - rgb.b) * 0.75))}`;
  shades[300] = `${Math.min(255, Math.round(rgb.r + (255 - rgb.r) * 0.6))} ${Math.min(255, Math.round(rgb.g + (255 - rgb.g) * 0.6))} ${Math.min(255, Math.round(rgb.b + (255 - rgb.b) * 0.6))}`;
  shades[400] = `${Math.min(255, Math.round(rgb.r + (255 - rgb.r) * 0.3))} ${Math.min(255, Math.round(rgb.g + (255 - rgb.g) * 0.3))} ${Math.min(255, Math.round(rgb.b + (255 - rgb.b) * 0.3))}`;

  // Base color (500)
  shades[500] = `${rgb.r} ${rgb.g} ${rgb.b}`;

  // Generate darker shades (600-900)
  shades[600] = `${Math.max(0, Math.round(rgb.r * 0.85))} ${Math.max(0, Math.round(rgb.g * 0.85))} ${Math.max(0, Math.round(rgb.b * 0.85))}`;
  shades[700] = `${Math.max(0, Math.round(rgb.r * 0.7))} ${Math.max(0, Math.round(rgb.g * 0.7))} ${Math.max(0, Math.round(rgb.b * 0.7))}`;
  shades[800] = `${Math.max(0, Math.round(rgb.r * 0.5))} ${Math.max(0, Math.round(rgb.g * 0.5))} ${Math.max(0, Math.round(rgb.b * 0.5))}`;
  shades[900] = `${Math.max(0, Math.round(rgb.r * 0.3))} ${Math.max(0, Math.round(rgb.g * 0.3))} ${Math.max(0, Math.round(rgb.b * 0.3))}`;

  return shades;
};

const invertShades = (shades: Record<number, string>): Record<number, string> => ({
  50: shades[900],
  100: shades[800],
  200: shades[700],
  300: shades[600],
  400: shades[400],
  500: shades[500],
  600: shades[300],
  700: shades[200],
  800: shades[100],
  900: shades[50],
});

const paletteVars = (name: 'primary' | 'secondary', shades: Record<number, string>): string => `
      --color-${name}-50: ${shades[50]} !important;
      --color-${name}-100: ${shades[100]} !important;
      --color-${name}-200: ${shades[200]} !important;
      --color-${name}-300: ${shades[300]} !important;
      --color-${name}-400: ${shades[400]} !important;
      --color-${name}-500: ${shades[500]} !important;
      --color-${name}-600: ${shades[600]} !important;
      --color-${name}-700: ${shades[700]} !important;
      --color-${name}-800: ${shades[800]} !important;
      --color-${name}-900: ${shades[900]} !important;`;

const primaryOverrides = `
    /* Switch/toggle */
    button[role="switch"][data-state="checked"] {
      background-color: rgb(var(--color-primary-500)) !important;
    }

    /* Button variant classes using CSS variables */
    .bg-\\[rgb\\(var\\(--color-primary-500\\)\\)\\] { background-color: rgb(var(--color-primary-500)) !important; }
    .bg-\\[rgb\\(var\\(--color-primary-600\\)\\)\\] { background-color: rgb(var(--color-primary-600)) !important; }
    .hover\\:bg-\\[rgb\\(var\\(--color-primary-600\\)\\)\\]:hover { background-color: rgb(var(--color-primary-600)) !important; }
    .bg-\\[rgb\\(var\\(--color-primary-100\\)\\)\\] { background-color: rgb(var(--color-primary-100)) !important; }
    .bg-\\[rgb\\(var\\(--color-primary-200\\)\\)\\] { background-color: rgb(var(--color-primary-200)) !important; }
    .hover\\:bg-\\[rgb\\(var\\(--color-primary-200\\)\\)\\]:hover { background-color: rgb(var(--color-primary-200)) !important; }
    .bg-\\[rgb\\(var\\(--color-primary-50\\)\\)\\] { background-color: rgb(var(--color-primary-50)) !important; }
    .hover\\:bg-\\[rgb\\(var\\(--color-primary-50\\)\\)\\]:hover { background-color: rgb(var(--color-primary-50)) !important; }
    .text-\\[rgb\\(var\\(--color-primary-500\\)\\)\\] { color: rgb(var(--color-primary-500)) !important; }
    .text-\\[rgb\\(var\\(--color-primary-700\\)\\)\\] { color: rgb(var(--color-primary-700)) !important; }
    .hover\\:text-\\[rgb\\(var\\(--color-primary-700\\)\\)\\]:hover { color: rgb(var(--color-primary-700)) !important; }
    .border-\\[rgb\\(var\\(--color-primary-500\\)\\)\\] { border-color: rgb(var(--color-primary-500)) !important; }

    /* Nav link hover text */
    a[class*="hover\\:text-\\[rgb\\(var\\(--color-primary"]:hover {
      color: rgb(var(--color-primary-500)) !important;
    }

    /* Purple/indigo Tailwind classes mapped to primary */
    .bg-purple-600, .bg-purple-500, .bg-indigo-600, .bg-indigo-500 {
      background-color: rgb(var(--color-primary-500)) !important;
    }
    .bg-purple-100, .bg-indigo-100 {
      background-color: rgb(var(--color-primary-100)) !important;
    }
    .text-purple-600, .text-purple-500, .text-indigo-600, .text-indigo-500 {
      color: rgb(var(--color-primary-500)) !important;
    }
    .border-purple-600, .border-purple-500, .border-indigo-600, .border-indigo-500 {
      border-color: rgb(var(--color-primary-500)) !important;
    }
    .hover\\:bg-purple-700:hover, .hover\\:bg-purple-600:hover,
    .hover\\:bg-indigo-700:hover, .hover\\:bg-indigo-600:hover {
      background-color: rgb(var(--color-primary-600)) !important;
    }
    .hover\\:text-purple-700:hover, .hover\\:text-purple-600:hover,
    .hover\\:text-indigo-700:hover, .hover\\:text-indigo-600:hover {
      color: rgb(var(--color-primary-600)) !important;
    }
    .focus\\:ring-purple-500:focus, .focus\\:ring-indigo-500:focus {
      --tw-ring-color: rgb(var(--color-primary-500)) !important;
    }
    .focus\\:border-purple-500:focus, .focus\\:border-indigo-500:focus {
      border-color: rgb(var(--color-primary-500)) !important;
    }

    /* Focus ring default */
    *:focus-visible {
      --tw-ring-color: rgb(var(--color-primary-500)) !important;
    }

    /* Inputs */
    input:focus, textarea:focus, select:focus {
      border-color: rgb(var(--color-primary-500)) !important;
      --tw-ring-color: rgb(var(--color-primary-500)) !important;
    }
    input[type="checkbox"]:checked, input[type="radio"]:checked {
      background-color: rgb(var(--color-primary-500)) !important;
      border-color: rgb(var(--color-primary-500)) !important;
    }
    input[type="checkbox"]:focus, input[type="radio"]:focus {
      --tw-ring-color: rgb(var(--color-primary-500)) !important;
      border-color: rgb(var(--color-primary-500)) !important;
    }

    /* Border-primary helper */
    .border-primary { border-color: rgb(var(--color-primary-500)) !important; }
`;

const secondaryOverrides = `
    /* Secondary color classes */
    .bg-\\[rgb\\(var\\(--color-secondary-500\\)\\)\\] { background-color: rgb(var(--color-secondary-500)) !important; }
    .bg-\\[rgb\\(var\\(--color-secondary-600\\)\\)\\] { background-color: rgb(var(--color-secondary-600)) !important; }
    .hover\\:bg-\\[rgb\\(var\\(--color-secondary-600\\)\\)\\]:hover { background-color: rgb(var(--color-secondary-600)) !important; }
    .bg-\\[rgb\\(var\\(--color-secondary-50\\)\\)\\] { background-color: rgb(var(--color-secondary-50)) !important; }
    .bg-\\[rgb\\(var\\(--color-secondary-100\\)\\)\\] { background-color: rgb(var(--color-secondary-100)) !important; }
    .bg-\\[rgb\\(var\\(--color-secondary-200\\)\\)\\] { background-color: rgb(var(--color-secondary-200)) !important; }
    .bg-\\[rgb\\(var\\(--color-secondary-300\\)\\)\\] { background-color: rgb(var(--color-secondary-300)) !important; }
    .bg-\\[rgb\\(var\\(--color-secondary-400\\)\\)\\] { background-color: rgb(var(--color-secondary-400)) !important; }
    .text-\\[rgb\\(var\\(--color-secondary-500\\)\\)\\] { color: rgb(var(--color-secondary-500)) !important; }
    .text-\\[rgb\\(var\\(--color-secondary-700\\)\\)\\] { color: rgb(var(--color-secondary-700)) !important; }
    .border-\\[rgb\\(var\\(--color-secondary-400\\)\\)\\] { border-color: rgb(var(--color-secondary-400)) !important; }

    /* Accent classes mapped to secondary */
    .bg-\\[rgb\\(var\\(--color-accent-500\\)\\)\\] { background-color: rgb(var(--color-secondary-500)) !important; }
    .bg-\\[rgb\\(var\\(--color-accent-50\\)\\)\\] { background-color: rgb(var(--color-secondary-50)) !important; }
    .text-\\[rgb\\(var\\(--color-accent-500\\)\\)\\] { color: rgb(var(--color-secondary-500)) !important; }
    .text-\\[rgb\\(var\\(--color-accent-700\\)\\)\\] { color: rgb(var(--color-secondary-700)) !important; }
    .border-\\[rgb\\(var\\(--color-accent-500\\)\\)\\] { border-color: rgb(var(--color-secondary-500)) !important; }

    /* Blue Tailwind classes mapped to secondary */
    .text-blue-600, .text-blue-500 { color: rgb(var(--color-secondary-600)) !important; }
    .text-blue-700 { color: rgb(var(--color-secondary-700)) !important; }
    .text-blue-800 { color: rgb(var(--color-secondary-800)) !important; }
    .hover\\:text-blue-600:hover, .hover\\:text-blue-500:hover { color: rgb(var(--color-secondary-600)) !important; }
    .hover\\:text-blue-700:hover { color: rgb(var(--color-secondary-700)) !important; }
    .hover\\:text-blue-800:hover { color: rgb(var(--color-secondary-800)) !important; }
    .border-blue-600, .border-blue-500 { border-color: rgb(var(--color-secondary-600)) !important; }
    .bg-blue-600, .bg-blue-500 { background-color: rgb(var(--color-secondary-600)) !important; }
    .bg-blue-50 { background-color: rgb(var(--color-secondary-50)) !important; }
    .bg-blue-100 { background-color: rgb(var(--color-secondary-100)) !important; }
    .bg-blue-200 { background-color: rgb(var(--color-secondary-200)) !important; }

    /* Tab active state */
    [data-state="active"] {
      color: rgb(var(--color-secondary-600)) !important;
      border-color: rgb(var(--color-secondary-600)) !important;
    }
    .data-\\[state\\=active\\]\\:text-blue-600[data-state="active"] { color: rgb(var(--color-secondary-600)) !important; }
    .data-\\[state\\=active\\]\\:border-blue-600[data-state="active"] { border-color: rgb(var(--color-secondary-600)) !important; }
`;

/**
 * Generate CSS styles for tenant branding.
 * Each color is applied independently — if only one is set, the other falls
 * back to the globals.css palette rather than a hardcoded default.
 */
export function generateBrandingStyles(branding: TenantBranding | null): string {
  const primaryShades = branding?.primaryColor ? generateColorShades(branding.primaryColor) : null;
  const secondaryShades = branding?.secondaryColor ? generateColorShades(branding.secondaryColor) : null;

  if (!primaryShades && !secondaryShades) {
    return '';
  }

  const primaryDarkShades = primaryShades ? invertShades(primaryShades) : null;
  const secondaryDarkShades = secondaryShades ? invertShades(secondaryShades) : null;

  const rootBody = [
    primaryShades ? paletteVars('primary', primaryShades) : '',
    secondaryShades ? paletteVars('secondary', secondaryShades) : '',
  ].filter(Boolean).join('\n');

  const darkBody = [
    primaryDarkShades ? paletteVars('primary', primaryDarkShades) : '',
    secondaryDarkShades ? paletteVars('secondary', secondaryDarkShades) : '',
  ].filter(Boolean).join('\n');

  return `
    :root {${rootBody}
    }

    html.dark {${darkBody}
    }
    ${primaryShades ? primaryOverrides : ''}
    ${secondaryShades ? secondaryOverrides : ''}
  `;
}
