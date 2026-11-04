/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListDetailLayout } from './ListDetailLayout';

const renderLayout = (detail: React.ReactNode | null, onBack = vi.fn()) =>
  render(
    <ListDetailLayout
      id="demo"
      list={<div>the list</div>}
      detail={detail}
      onBack={onBack}
      backLabel="Back to demo"
    />
  );

describe('ListDetailLayout', () => {
  afterEach(cleanup);

  it('renders only the list, with no Back button, when there is no detail', () => {
    const { container } = renderLayout(null);
    expect(screen.getByText('the list')).toBeTruthy();
    expect(container.querySelector('#demo-detail')).toBeNull();
    expect(screen.queryByText('Back to demo')).toBeNull();
    expect(container.querySelector('#demo-list')!.className).not.toContain('hidden');
  });

  it('renders both regions and hides the list below the breakpoint when a detail is present', () => {
    const { container } = renderLayout(<div>the detail</div>);
    expect(screen.getByText('the list')).toBeTruthy();
    expect(screen.getByText('the detail')).toBeTruthy();
    const list = container.querySelector('#demo-list')!;
    expect(list.className).toContain('hidden');
    expect(list.className).toContain('@[56rem]:flex');
    expect(container.querySelector('#demo')!.className).toContain('@container');
  });

  it('calls onBack when Back is clicked', () => {
    const onBack = vi.fn();
    renderLayout(<div>the detail</div>, onBack);
    fireEvent.click(screen.getByText('Back to demo'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('derives child ids from id', () => {
    const { container } = renderLayout(<div>the detail</div>);
    expect(container.querySelector('#demo')).not.toBeNull();
    expect(container.querySelector('#demo-list')).not.toBeNull();
    expect(container.querySelector('#demo-detail')).not.toBeNull();
    expect(container.querySelector('#demo-back')).not.toBeNull();
  });
});
