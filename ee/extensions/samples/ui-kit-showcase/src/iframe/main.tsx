import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Theme Bridge - Receives theme from host app and applies CSS variables
// ============================================================================

/**
 * Detect whether a hex color is "dark" by computing relative luminance.
 * Returns true when the background is dark enough to warrant dark-mode tokens.
 */
function isDarkColor(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return false;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  // sRGB luminance
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.5;
}

/**
 * Clear host-injected inline style overrides from the document root.
 * The --alga-* CSS variables remain defined by the extension's own
 * tokens.css — this only removes the inline layer so the extension
 * can switch between its own light/dark token sets independently.
 */
function clearInlineTheme() {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  for (let i = style.length - 1; i >= 0; i--) {
    const prop = style[i];
    if (prop.startsWith('--alga-')) {
      style.removeProperty(prop);
    }
  }
}

/**
 * Apply theme variables to the document root and set data-theme attribute.
 */
function applyTheme(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // Detect dark mode from the background color and set data-theme so that
  // tokens.css dark overrides activate as a fallback.
  const bg = vars['--alga-bg'];
  if (bg) {
    const mode = isDarkColor(bg) ? 'dark' : 'light';
    root.setAttribute('data-theme', mode);
    // Dispatch a custom event so React components (e.g. theme toggle) can react.
    // source: 'host' tells listeners this came from the host, not a local toggle.
    window.dispatchEvent(new CustomEvent('alga-theme-change', { detail: { mode, source: 'host' } }));
  }
}

/**
 * Get the parent origin for postMessage
 */
function getParentOrigin(): string {
  const params = new URLSearchParams(window.location.search);
  const parentOrigin = params.get('parentOrigin');
  if (parentOrigin) return parentOrigin;

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      // Invalid referrer
    }
  }
  return '*';
}

/**
 * Send ready message to parent and set up theme listener
 */
function initializeThemeBridge() {
  const parentOrigin = getParentOrigin();

  // Listen for theme messages from parent
  const handleMessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    // Check for Alga envelope format with theme message
    if (data.alga === true && data.version === '1' && data.type === 'theme') {
      applyTheme(data.payload || {});
    }
  };

  window.addEventListener('message', handleMessage);

  // Listen for local toggle requests from the App component.
  // When the user clicks the theme toggle, we clear all host-injected inline
  // styles and let tokens.css dark/light rules take over.
  window.addEventListener('alga-toggle-theme', ((e: CustomEvent) => {
    const mode = e.detail?.mode;
    if (!mode) return;
    clearInlineTheme();
    document.documentElement.setAttribute('data-theme', mode);
    window.dispatchEvent(new CustomEvent('alga-theme-change', { detail: { mode, source: 'toggle' } }));
  }) as EventListener);

  // Send ready message to parent so it knows to send theme
  window.parent.postMessage(
    { alga: true, version: '1', type: 'ready' },
    parentOrigin
  );
}

// Initialize theme bridge on load
if (typeof window !== 'undefined') {
  initializeThemeBridge();
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
