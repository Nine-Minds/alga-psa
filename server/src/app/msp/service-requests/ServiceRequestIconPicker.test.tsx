// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { ServiceRequestIconPicker } from './ServiceRequestIconPicker';

describe('ServiceRequestIconPicker', () => {
  it('updates the selected icon through button clicks', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ServiceRequestIconPicker selectedIcon="file-text" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Laptop' }));
    expect(onChange).toHaveBeenCalledWith('laptop');

    await user.click(screen.getByRole('button', { name: 'Clear icon' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
