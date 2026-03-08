'use client';

import { useEffect, useRef } from 'react';

const GitHubStarButton = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const anchor = document.createElement('a');
    anchor.className = 'github-button';
    anchor.href = 'https://github.com/Nine-Minds/alga-psa';
    anchor.setAttribute('data-color-scheme', 'no-preference: dark; light: dark; dark: dark;');
    anchor.setAttribute('data-icon', 'octicon-star');
    anchor.setAttribute('data-show-count', 'false');
    anchor.setAttribute('data-size', 'small');
    anchor.setAttribute('aria-label', 'Star Nine-Minds/alga-psa on GitHub');
    anchor.textContent = 'Star';
    container.appendChild(anchor);

    const script = document.createElement('script');
    script.src = 'https://buttons.github.io/buttons.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      container.innerHTML = '';
      script.remove();
    };
  }, []);

  return <div ref={containerRef} className="flex items-center mt-0.5" />;
};

export default GitHubStarButton;
