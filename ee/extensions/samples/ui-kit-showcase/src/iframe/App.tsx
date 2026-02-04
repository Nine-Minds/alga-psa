import React from 'react';
import {
  Button,
  Tabs,
} from '@alga/ui-kit';
import { ThemeBridge, ThemeMode } from '../components/ThemeBridge';
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

const themeToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

export function App() {
  const [mode, setMode] = React.useState<ThemeMode>('light');

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
        </>
      ),
    },
    {
      key: 'navigation',
      label: 'Navigation',
      content: (
        <>
          <TabsDemo />
          <DrawerDemo />
          <DropdownMenuDemo />
        </>
      ),
    },
  ];

  return (
    <div style={pageStyle}>
      <ThemeBridge mode={mode} />
      <header style={headerStyle}>
        <strong style={{ fontSize: 18 }}>UI Kit Showcase</strong>
        <div style={themeToggleStyle}>
          <span style={{ color: 'var(--alga-muted-fg)' }}>{mode === 'light' ? 'Light' : 'Dark'} mode</span>
          <Button
            variant="secondary"
            onClick={() => setMode((prev) => (prev === 'light' ? 'dark' : 'light'))}
          >
            Toggle Theme
          </Button>
        </div>
      </header>
      <main style={contentStyle}>
        <Tabs tabs={tabs} defaultActiveKey="core" />
      </main>
    </div>
  );
}
