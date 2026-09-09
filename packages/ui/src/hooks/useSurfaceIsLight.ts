'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isLightSurface, surfaceLuminance } from '../lib/surfaceColor';

// The server cannot measure a colour, so it renders the dark-surface assumption
// and the client corrects it before paint.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Reads an element's own background — theme pair, light/dark mode and a
 * hand-edited side-panel colour all land in that one colour — so artwork drawn
 * on it can follow the surface instead of a hardcoded "always dark" assumption.
 *
 * `cssVariable` is read first: backgrounds usually transition, so
 * `backgroundColor` still reports the previous theme while a switch animates,
 * and nothing fires afterwards. Custom properties do not transition, so the
 * token is already correct. An unreadable colour reads as dark.
 */
export function useSurfaceIsLight(
  surfaceRef: React.RefObject<HTMLElement | null>,
  cssVariable?: string,
): boolean {
  const [isLight, setIsLight] = useState(false);
  const variableRef = useRef(cssVariable);
  variableRef.current = cssVariable;

  useBrowserLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const read = () => {
      const styles = window.getComputedStyle(surface);
      const variable = variableRef.current;
      const token = variable ? styles.getPropertyValue(variable) : '';
      setIsLight(isLightSurface(surfaceLuminance(token) !== null ? token : styles.backgroundColor));
    };

    read();
    // Mode lands as `html.light`/`html.dark`, the pair as `html[data-theme-pair]`.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme-pair'],
    });
    return () => observer.disconnect();
  }, [surfaceRef]);

  return isLight;
}
