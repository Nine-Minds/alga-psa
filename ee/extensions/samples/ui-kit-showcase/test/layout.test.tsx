import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/iframe/App';
import { DemoSection } from '../src/components/DemoSection';

describe('layout', () => {
  test('header displays UI Kit Showcase title', () => {
    render(<App />);
    expect(screen.getByText('UI Kit Showcase')).toBeInTheDocument();
  });

  test('theme toggle button is visible', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
  });

  test('category tabs are displayed', () => {
    render(<App />);
    ['Core', 'Data', 'Dialogs', 'Feedback', 'Form', 'Navigation'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  test('clicking a tab switches content', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByText('DataTable')).toBeInTheDocument();
  });

  test('default tab is Core', () => {
    render(<App />);
    expect(screen.getByText('Button')).toBeInTheDocument();
  });
});

describe('DemoSection', () => {
  test('renders title text', () => {
    render(
      <DemoSection title="Sample" description="Desc">
        <div>Child</div>
      </DemoSection>
    );
    expect(screen.getByText('Sample')).toBeInTheDocument();
  });

  test('renders description text', () => {
    render(
      <DemoSection title="Sample" description="Desc">
        <div>Child</div>
      </DemoSection>
    );
    expect(screen.getByText('Desc')).toBeInTheDocument();
  });

  test('renders children in demo area', () => {
    render(
      <DemoSection title="Sample" description="Desc">
        <div>Child</div>
      </DemoSection>
    );
    expect(screen.getByText('Child')).toBeInTheDocument();
  });
});
