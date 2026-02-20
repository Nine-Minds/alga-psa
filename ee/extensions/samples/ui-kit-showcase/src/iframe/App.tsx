import React, { useCallback, useEffect, useState } from 'react';
import {
  Tabs,
  useTheme,
} from '@alga/ui-kit';
import { ButtonDemo } from '../demos/ButtonDemo';
import { InputDemo } from '../demos/InputDemo';
import { SelectDemo } from '../demos/SelectDemo';
import { CardDemo } from '../demos/CardDemo';
import { AlertDemo } from '../demos/AlertDemo';
import { TextDemo } from '../demos/TextDemo';
import { StackDemo } from '../demos/StackDemo';
import { BadgeDemo } from '../demos/BadgeDemo';
import { DataTableDemo } from '../demos/DataTableDemo';
import { DialogDemo } from '../demos/DialogDemo';
import { ConfirmDialogDemo } from '../demos/ConfirmDialogDemo';
import { SpinnerDemo } from '../demos/SpinnerDemo';
import { LoadingIndicatorDemo } from '../demos/LoadingIndicatorDemo';
import { TooltipDemo } from '../demos/TooltipDemo';
import { ProgressDemo } from '../demos/ProgressDemo';
import { SkeletonDemo } from '../demos/SkeletonDemo';
import { CheckboxDemo } from '../demos/CheckboxDemo';
import { SwitchDemo } from '../demos/SwitchDemo';
import { TextAreaDemo } from '../demos/TextAreaDemo';
import { LabelDemo } from '../demos/LabelDemo';
import { SearchInputDemo } from '../demos/SearchInputDemo';
import { TabsDemo } from '../demos/TabsDemo';
import { DrawerDemo } from '../demos/DrawerDemo';
import { DropdownMenuDemo } from '../demos/DropdownMenuDemo';
import { RadioDemo } from '../demos/RadioDemo';
import { ViewSwitcherDemo } from '../demos/ViewSwitcherDemo';
import { BreadcrumbsDemo } from '../demos/BreadcrumbsDemo';
import { PopoverDemo } from '../demos/PopoverDemo';
import { SeparatorDemo } from '../demos/SeparatorDemo';
import { ThemeDemo } from '../demos/ThemeDemo';

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--alga-bg)',
  color: 'var(--alga-fg)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid var(--alga-border)',
  position: 'sticky',
  top: 0,
  background: 'var(--alga-bg)',
  zIndex: 10,
};

const contentStyle: React.CSSProperties = {
  padding: '20px',
};

const toggleBtnStyle: React.CSSProperties = {
  background: 'var(--alga-muted)',
  border: '1px solid var(--alga-border)',
  borderRadius: 'var(--alga-radius, 6px)',
  padding: '6px 10px',
  cursor: 'pointer',
  color: 'var(--alga-fg)',
  fontSize: 16,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

// Sun SVG icon
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// Moon SVG icon
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function App() {
  const { getMode } = useTheme();
  const [isDark, setIsDark] = useState(() => getMode() === 'dark');

  // Listen for theme changes (from the host bridge or a local toggle).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode) {
        setIsDark(detail.mode === 'dark');
      }
    };
    window.addEventListener('alga-theme-change', handler);
    return () => window.removeEventListener('alga-theme-change', handler);
  }, []);

  // Dispatch alga-toggle-theme so that main.tsx can clear host inline styles
  // before switching data-theme. This lets tokens.css rules take effect.
  const toggleTheme = useCallback(() => {
    const next = isDark ? 'light' : 'dark';
    window.dispatchEvent(new CustomEvent('alga-toggle-theme', { detail: { mode: next } }));
    setIsDark(next === 'dark');
  }, [isDark]);

  const tabs = [
    {
      key: 'core',
      label: 'Core',
      content: (
        <>
          <ButtonDemo />
          <InputDemo />
          <SelectDemo />
          <CardDemo />
          <AlertDemo />
          <TextDemo />
          <StackDemo />
          <SeparatorDemo />
          <BadgeDemo />
        </>
      ),
    },
    {
      key: 'data',
      label: 'Data',
      content: <DataTableDemo />,
    },
    {
      key: 'dialogs',
      label: 'Dialogs',
      content: (
        <>
          <DialogDemo />
          <ConfirmDialogDemo />
          <PopoverDemo />
        </>
      ),
    },
    {
      key: 'feedback',
      label: 'Feedback',
      content: (
        <>
          <SpinnerDemo />
          <LoadingIndicatorDemo />
          <TooltipDemo />
          <ProgressDemo />
          <SkeletonDemo />
        </>
      ),
    },
    {
      key: 'form',
      label: 'Form',
      content: (
        <>
          <CheckboxDemo />
          <SwitchDemo />
          <TextAreaDemo />
          <LabelDemo />
          <SearchInputDemo />
          <RadioDemo />
        </>
      ),
    },
    {
      key: 'navigation',
      label: 'Navigation',
      content: (
        <>
          <BreadcrumbsDemo />
          <TabsDemo />
          <DrawerDemo />
          <DropdownMenuDemo />
          <ViewSwitcherDemo />
        </>
      ),
    },
    {
      key: 'theme',
      label: 'Theme',
      content: <ThemeDemo />,
    },
  ];

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <strong style={{ fontSize: 18 }}>UI Kit Showcase</strong>
        <button
          style={toggleBtnStyle}
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
          <span style={{ fontSize: 13 }}>{isDark ? 'Light' : 'Dark'}</span>
        </button>
      </header>
      <main style={contentStyle}>
        <Tabs tabs={tabs} defaultActiveKey="core" />
      </main>
    </div>
  );
}
