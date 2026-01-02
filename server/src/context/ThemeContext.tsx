'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface ThemeContextType {
  themeStatus: string;
  setThemeStatus: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeStatus, setThemeStatus] = useState('light');

  useEffect(() => {
    // Always set to light mode, ignoring saved preferences
    setThemeStatus('light');
    document.body.className = `${document.body.className.replace(/light|dark/g, '')} light`.trim();
    localStorage.setItem('theme', 'light');
  }, []);

  const handleThemeChange = (theme: string) => {
    // Maintain light mode regardless of requested theme
    setThemeStatus('light');
    localStorage.setItem('theme', 'light');
    document.body.className = `${document.body.className.replace(/light|dark/g, '')} light`.trim();
  };

  return (
    <ThemeContext value={{ themeStatus, setThemeStatus: handleThemeChange }}>
      {children}
    </ThemeContext>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
