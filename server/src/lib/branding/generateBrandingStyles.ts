import { TenantBranding } from '@product/actions/tenant-actions/tenantBrandingActions';

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
const generateColorShades = (hex: string): Record<number, string> => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    console.error('Failed to convert hex to RGB:', hex);
    return {};
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

/**
 * Generate CSS styles for tenant branding
 * This function generates the same styles as BrandingProvider but can be used server-side
 */
export function generateBrandingStyles(branding: TenantBranding | null): string {
  if (!branding?.primaryColor && !branding?.secondaryColor) {
    return '';
  }

  const primaryColor = branding.primaryColor || '#6366F1';
  const secondaryColor = branding.secondaryColor || '#8B5CF6';

  const primaryShades = generateColorShades(primaryColor);
  const secondaryShades = generateColorShades(secondaryColor);

  return `
    :root {
      /* Override primary color CSS variables */
      --color-primary-50: ${primaryShades[50]} !important;
      --color-primary-100: ${primaryShades[100]} !important;
      --color-primary-200: ${primaryShades[200]} !important;
      --color-primary-300: ${primaryShades[300]} !important;
      --color-primary-400: ${primaryShades[400]} !important;
      --color-primary-500: ${primaryShades[500]} !important;
      --color-primary-600: ${primaryShades[600]} !important;
      --color-primary-700: ${primaryShades[700]} !important;
      --color-primary-800: ${primaryShades[800]} !important;
      --color-primary-900: ${primaryShades[900]} !important;

      /* Override secondary color CSS variables */
      --color-secondary-50: ${secondaryShades[50]} !important;
      --color-secondary-100: ${secondaryShades[100]} !important;
      --color-secondary-200: ${secondaryShades[200]} !important;
      --color-secondary-300: ${secondaryShades[300]} !important;
      --color-secondary-400: ${secondaryShades[400]} !important;
      --color-secondary-500: ${secondaryShades[500]} !important;
      --color-secondary-600: ${secondaryShades[600]} !important;
      --color-secondary-700: ${secondaryShades[700]} !important;
      --color-secondary-800: ${secondaryShades[800]} !important;
      --color-secondary-900: ${secondaryShades[900]} !important;
    }

    /* Override switch/toggle component colors */
    button[role="switch"][data-state="checked"] {
      background-color: rgb(${primaryShades[500]}) !important;
    }

    /* Override button variant classes that use CSS variables */
    .bg-\\[rgb\\(var\\(--color-primary-500\\)\\)\\] {
      background-color: rgb(${primaryShades[500]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-primary-600\\)\\)\\] {
      background-color: rgb(${primaryShades[600]}) !important;
    }

    .hover\\:bg-\\[rgb\\(var\\(--color-primary-600\\)\\)\\]:hover {
      background-color: rgb(${primaryShades[600]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-primary-100\\)\\)\\] {
      background-color: rgb(${primaryShades[100]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-primary-200\\)\\)\\] {
      background-color: rgb(${primaryShades[200]}) !important;
    }

    .hover\\:bg-\\[rgb\\(var\\(--color-primary-200\\)\\)\\]:hover {
      background-color: rgb(${primaryShades[200]}) !important;
    }

    .text-\\[rgb\\(var\\(--color-primary-500\\)\\)\\] {
      color: rgb(${primaryShades[500]}) !important;
    }

    .text-\\[rgb\\(var\\(--color-primary-700\\)\\)\\] {
      color: rgb(${primaryShades[700]}) !important;
    }

    .hover\\:text-\\[rgb\\(var\\(--color-primary-700\\)\\)\\]:hover {
      color: rgb(${primaryShades[700]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-primary-50\\)\\)\\] {
      background-color: rgb(${primaryShades[50]}) !important;
    }

    .hover\\:bg-\\[rgb\\(var\\(--color-primary-50\\)\\)\\]:hover {
      background-color: rgb(${primaryShades[50]}) !important;
    }

    .border-\\[rgb\\(var\\(--color-primary-500\\)\\)\\] {
      border-color: rgb(${primaryShades[500]}) !important;
    }

    /* Override secondary color classes */
    .bg-\\[rgb\\(var\\(--color-secondary-500\\)\\)\\] {
      background-color: rgb(${secondaryShades[500]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-secondary-600\\)\\)\\] {
      background-color: rgb(${secondaryShades[600]}) !important;
    }

    .hover\\:bg-\\[rgb\\(var\\(--color-secondary-600\\)\\)\\]:hover {
      background-color: rgb(${secondaryShades[600]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-secondary-50\\)\\)\\] {
      background-color: rgb(${secondaryShades[50]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-secondary-100\\)\\)\\] {
      background-color: rgb(${secondaryShades[100]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-secondary-200\\)\\)\\] {
      background-color: rgb(${secondaryShades[200]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-secondary-300\\)\\)\\] {
      background-color: rgb(${secondaryShades[300]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-secondary-400\\)\\)\\] {
      background-color: rgb(${secondaryShades[400]}) !important;
    }

    .text-\\[rgb\\(var\\(--color-secondary-500\\)\\)\\] {
      color: rgb(${secondaryShades[500]}) !important;
    }

    .text-\\[rgb\\(var\\(--color-secondary-700\\)\\)\\] {
      color: rgb(${secondaryShades[700]}) !important;
    }

    .border-\\[rgb\\(var\\(--color-secondary-400\\)\\)\\] {
      border-color: rgb(${secondaryShades[400]}) !important;
    }

    /* Override accent colors to use secondary */
    .bg-\\[rgb\\(var\\(--color-accent-500\\)\\)\\] {
      background-color: rgb(${secondaryShades[500]}) !important;
    }

    .bg-\\[rgb\\(var\\(--color-accent-50\\)\\)\\] {
      background-color: rgb(${secondaryShades[50]}) !important;
    }

    .text-\\[rgb\\(var\\(--color-accent-500\\)\\)\\] {
      color: rgb(${secondaryShades[500]}) !important;
    }

    .text-\\[rgb\\(var\\(--color-accent-700\\)\\)\\] {
      color: rgb(${secondaryShades[700]}) !important;
    }

    .border-\\[rgb\\(var\\(--color-accent-500\\)\\)\\] {
      border-color: rgb(${secondaryShades[500]}) !important;
    }

    /* Override navigation link hover text to use primary color */
    a[class*="hover\\:text-\\[rgb\\(var\\(--color-primary"]:hover {
      color: rgb(${primaryShades[500]}) !important;
    }

    /* Override any remaining purple/indigo classes */
    .bg-purple-600,
    .bg-purple-500,
    .bg-indigo-600,
    .bg-indigo-500 {
      background-color: rgb(${primaryShades[500]}) !important;
    }

    /* Override blue colors to use secondary */
    .text-blue-600,
    .text-blue-500 {
      color: rgb(${secondaryShades[600]}) !important;
    }

    .text-blue-700 {
      color: rgb(${secondaryShades[700]}) !important;
    }

    .text-blue-800 {
      color: rgb(${secondaryShades[800]}) !important;
    }

    /* Override hover states for blue text */
    .hover\\:text-blue-600:hover,
    .hover\\:text-blue-500:hover {
      color: rgb(${secondaryShades[600]}) !important;
    }

    .hover\\:text-blue-700:hover {
      color: rgb(${secondaryShades[700]}) !important;
    }

    .hover\\:text-blue-800:hover {
      color: rgb(${secondaryShades[800]}) !important;
    }

    .border-blue-600,
    .border-blue-500 {
      border-color: rgb(${secondaryShades[600]}) !important;
    }

    .bg-blue-600,
    .bg-blue-500 {
      background-color: rgb(${secondaryShades[600]}) !important;
    }

    .bg-blue-50 {
      background-color: rgb(${secondaryShades[50]}) !important;
    }

    .bg-blue-100 {
      background-color: rgb(${secondaryShades[100]}) !important;
    }

    .bg-blue-200 {
      background-color: rgb(${secondaryShades[200]}) !important;
    }

    /* Override border-primary for tabs */
    .border-primary {
      border-color: rgb(${primaryShades[500]}) !important;
    }

    /* Override data attribute selectors for tabs */
    [data-state="active"] {
      color: rgb(${secondaryShades[600]}) !important;
      border-color: rgb(${secondaryShades[600]}) !important;
    }

    .data-\\[state\\=active\\]\\:text-blue-600[data-state="active"] {
      color: rgb(${secondaryShades[600]}) !important;
    }

    .data-\\[state\\=active\\]\\:border-blue-600[data-state="active"] {
      border-color: rgb(${secondaryShades[600]}) !important;
    }

    .bg-purple-100,
    .bg-indigo-100 {
      background-color: rgb(${primaryShades[100]}) !important;
    }

    .text-purple-600,
    .text-purple-500,
    .text-indigo-600,
    .text-indigo-500 {
      color: rgb(${primaryShades[500]}) !important;
    }

    .border-purple-600,
    .border-purple-500,
    .border-indigo-600,
    .border-indigo-500 {
      border-color: rgb(${primaryShades[500]}) !important;
    }

    /* Hover states */
    .hover\\:bg-purple-700:hover,
    .hover\\:bg-purple-600:hover,
    .hover\\:bg-indigo-700:hover,
    .hover\\:bg-indigo-600:hover {
      background-color: rgb(${primaryShades[600]}) !important;
    }

    .hover\\:text-purple-700:hover,
    .hover\\:text-purple-600:hover,
    .hover\\:text-indigo-700:hover,
    .hover\\:text-indigo-600:hover {
      color: rgb(${primaryShades[600]}) !important;
    }

    /* Focus states and ring colors */
    .focus\\:ring-purple-500:focus,
    .focus\\:ring-indigo-500:focus {
      --tw-ring-color: rgb(${primaryShades[500]}) !important;
    }

    .focus\\:border-purple-500:focus,
    .focus\\:border-indigo-500:focus {
      border-color: rgb(${primaryShades[500]}) !important;
    }

    /* Override ring color but not width */
    *:focus-visible {
      --tw-ring-color: rgb(${primaryShades[500]}) !important;
    }

    /* Input focus states - only colors, not outline width */
    input:focus,
    textarea:focus,
    select:focus {
      border-color: rgb(${primaryShades[500]}) !important;
      --tw-ring-color: rgb(${primaryShades[500]}) !important;
    }

    /* Checkbox and radio buttons */
    input[type="checkbox"]:checked,
    input[type="radio"]:checked {
      background-color: rgb(${primaryShades[500]}) !important;
      border-color: rgb(${primaryShades[500]}) !important;
    }

    input[type="checkbox"]:focus,
    input[type="radio"]:focus {
      --tw-ring-color: rgb(${primaryShades[500]}) !important;
      border-color: rgb(${primaryShades[500]}) !important;
    }
  `;
}
