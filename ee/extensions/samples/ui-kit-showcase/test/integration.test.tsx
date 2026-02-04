import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { App } from '../src/iframe/App';

const root = path.resolve(__dirname, '..');

const componentTitles = [
  'Button',
  'Input',
  'CustomSelect',
  'Card',
  'Alert',
  'Text',
  'Stack',
  'Badge',
  'DataTable',
  'Dialog',
  'ConfirmDialog',
  'Spinner',
  'LoadingIndicator',
  'Tooltip',
  'Progress',
  'Skeleton',
  'Checkbox',
  'Switch',
  'TextArea',
  'Label',
  'SearchInput',
  'Tabs',
  'Drawer',
  'DropdownMenu',
];

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

  test('all UI kit components render in iframe context', () => {
    render(<App />);
    componentTitles.forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });
});
