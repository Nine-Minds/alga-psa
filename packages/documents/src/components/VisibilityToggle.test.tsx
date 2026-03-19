/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VisibilityToggle from './VisibilityToggle';

afterEach(() => {
  cleanup();
});

describe('VisibilityToggle', () => {
  it('renders hidden state and toggles to visible value', () => {
    const onToggle = vi.fn();

    render(<VisibilityToggle isClientVisible={false} onToggle={onToggle} />);

    const button = screen.getByRole('button', { name: 'Hidden from clients' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('renders visible state and toggles to hidden value', () => {
    const onToggle = vi.fn();

    render(<VisibilityToggle isClientVisible={true} onToggle={onToggle} />);

    const button = screen.getAllByRole('button', { name: 'Visible to clients' }).at(-1);
    expect(button).toBeDefined();
    if (!button) {
      throw new Error('Visible visibility toggle button not found');
    }
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('does not toggle when disabled', () => {
    const onToggle = vi.fn();

    render(<VisibilityToggle isClientVisible={true} onToggle={onToggle} disabled />);

    const button = screen.getAllByRole('button', { name: 'Visible to clients' }).at(-1);
    expect(button).toBeDefined();
    if (!button) {
      throw new Error('Disabled visibility toggle button not found');
    }
    fireEvent.click(button);

    expect(onToggle).not.toHaveBeenCalled();
  });
});
