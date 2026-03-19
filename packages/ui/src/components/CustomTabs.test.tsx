/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomTabs, type TabGroup, type TabContent } from './CustomTabs';

const baseTabs: TabContent[] = [
  { id: 'general', label: 'General', content: <div>General panel</div> },
  { id: 'billing', label: 'Billing', content: <div>Billing panel</div> },
];

afterEach(() => {
  document.body.innerHTML = '';
});

function activateTab(label: string): void {
  const tab = screen.getByRole('tab', { name: label });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
}

describe('CustomTabs', () => {
  it('renders labels for display while using ids for internal values', () => {
    render(<CustomTabs tabs={baseTabs} defaultTab="general" />);

    const generalTab = screen.getByRole('tab', { name: 'General' });
    const billingTab = screen.getByRole('tab', { name: 'Billing' });

    expect(generalTab.getAttribute('data-state')).toBe('active');
    expect(generalTab.getAttribute('aria-controls')).toContain('general');
    expect(billingTab.getAttribute('aria-controls')).toContain('billing');
    expect(screen.getByText('General panel')).toBeTruthy();
  });

  it('fires onTabChange with the tab id when a tab is clicked', () => {
    const onTabChange = vi.fn();

    render(<CustomTabs tabs={baseTabs} defaultTab="general" onTabChange={onTabChange} />);

    activateTab('Billing');

    expect(onTabChange).toHaveBeenCalledWith('billing');
    expect(screen.getByRole('tab', { name: 'Billing' }).getAttribute('data-state')).toBe('active');
  });

  it('uses the controlled value prop with tab ids', () => {
    const ControlledTabs = () => {
      const [value, setValue] = React.useState('billing');

      return (
        <CustomTabs
          tabs={baseTabs}
          value={value}
          onTabChange={setValue}
        />
      );
    };

    render(<ControlledTabs />);

    expect(screen.getByRole('tab', { name: 'Billing' }).getAttribute('data-state')).toBe('active');
    activateTab('General');
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('data-state')).toBe('active');
  });

  it('passes tab ids to beforeTabChange and can prevent navigation', () => {
    const beforeTabChange = vi.fn(() => false);
    const onTabChange = vi.fn();

    render(
      <CustomTabs
        tabs={baseTabs}
        defaultTab="general"
        beforeTabChange={beforeTabChange}
        onTabChange={onTabChange}
      />
    );

    activateTab('Billing');

    expect(beforeTabChange).toHaveBeenCalledWith('billing', 'general');
    expect(onTabChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('data-state')).toBe('active');
  });

  it('falls back to the first tab id when no defaultTab is provided', () => {
    render(<CustomTabs tabs={baseTabs} />);

    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByText('General panel')).toBeTruthy();
  });

  it('supports non-ASCII labels while preserving stable ASCII ids', () => {
    const tabs: TabContent[] = [
      { id: 'overview', label: 'Översikt', content: <div>Översikt panel</div> },
      { id: 'settings', label: 'Настройки', content: <div>Настройки panel</div> },
    ];

    render(<CustomTabs tabs={tabs} defaultTab="overview" />);

    expect(screen.getByRole('tab', { name: 'Översikt' }).getAttribute('aria-controls')).toContain('overview');
    expect(screen.getByRole('tab', { name: 'Настройки' }).getAttribute('aria-controls')).toContain('settings');
  });

  it('matches tabs by id even when labels are duplicated', () => {
    const duplicateLabelTabs: TabContent[] = [
      { id: 'first-general', label: 'General', content: <div>First panel</div> },
      { id: 'second-general', label: 'General', content: <div>Second panel</div> },
    ];

    render(<CustomTabs tabs={duplicateLabelTabs} defaultTab="second-general" />);

    expect(screen.getByText('Second panel')).toBeTruthy();
    expect(screen.getAllByRole('tab', { name: 'General' })).toHaveLength(2);
  });

  it('keeps grouped tabs accessible when defaultTab matches a tab id', () => {
    const groups: TabGroup[] = [
      {
        title: 'Primary',
        tabs: [{ id: 'overview', label: 'Overview', content: <div>Overview content</div> }],
      },
      {
        title: 'Advanced',
        tabs: [{ id: 'advanced', label: 'Advanced', content: <div>Advanced content</div> }],
      },
    ];
    
    render(<CustomTabs groups={groups} defaultTab="advanced" orientation="vertical" />);

    expect(screen.getByRole('tab', { name: 'Advanced' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByText('Advanced content')).toBeTruthy();
  });

  it('keeps grouped tabs accessible when controlled value matches a tab id', () => {
    const groups: TabGroup[] = [
      {
        title: 'General',
        tabs: [{ id: 'general', label: 'General', content: <div>General content</div> }],
      },
      {
        title: 'Integrations',
        tabs: [{ id: 'integrations', label: 'Integrations', content: <div>Integrations content</div> }],
      },
    ];
    
    render(<CustomTabs groups={groups} value="integrations" orientation="vertical" />);

    expect(screen.getByRole('tab', { name: 'Integrations' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByText('Integrations content')).toBeTruthy();
  });
});
