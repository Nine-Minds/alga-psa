import React from 'react';
import {
  Tabs,
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

export function App() {

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
  ];

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <strong style={{ fontSize: 18 }}>UI Kit Showcase</strong>
      </header>
      <main style={contentStyle}>
        <Tabs tabs={tabs} defaultActiveKey="core" />
      </main>
    </div>
  );
}
