import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'fs';
import path from 'path';
import { App } from '../src/iframe/App';

const root = path.resolve(__dirname, '..');

const coreTitles = ['Button', 'Input', 'CustomSelect', 'Card', 'Alert', 'Text', 'Stack', 'Badge'];
const dataTitles = ['DataTable'];
const dialogTitles = ['Dialog', 'ConfirmDialog'];
const feedbackTitles = ['Spinner', 'LoadingIndicator', 'Tooltip', 'Progress', 'Skeleton'];
const formTitles = ['Checkbox', 'Switch', 'TextArea', 'Label', 'SearchInput'];
const navTitles = ['Tabs', 'Drawer', 'DropdownMenu'];

describe('integration checks', () => {
  test('extension is registered for app menu', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.ui?.hooks?.appMenu?.label).toBeTruthy();
  });

  test('iframe renders without console errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<App />)).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('all UI kit components render in iframe context', async () => {
    const user = userEvent.setup();
    render(<App />);
    coreTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Data' }));
    dataTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Dialogs' }));
    dialogTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Feedback' }));
    feedbackTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Form' }));
    formTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Navigation' }));
    navTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });
});
