/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Input } from './Input';

afterEach(() => cleanup());

describe('Input label association', () => {
  it('A6: label names its input when the caller passes an id', () => {
    render(<Input label="Name" id="name-input" />);
    const input = screen.getByLabelText('Name');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('id', 'name-input');
  });

  it('A6: label names its input when no id is passed, and the id is stable across re-render', () => {
    const { rerender } = render(<Input label="Name" value="a" onChange={() => {}} />);
    const first = screen.getByLabelText('Name');
    const firstId = first.getAttribute('id');
    expect(firstId).toBeTruthy();

    rerender(<Input label="Name" value="b" onChange={() => {}} />);
    const second = screen.getByLabelText('Name');
    expect(second).toBe(first);
    expect(second.getAttribute('id')).toBe(firstId);
  });
});
