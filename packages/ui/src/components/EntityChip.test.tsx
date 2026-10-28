/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EntityChip from './EntityChip';

const tag = (id: string, text: string, bg?: string, fg?: string) => ({
  tag_id: id, tag_text: text, background_color: bg ?? null, text_color: fg ?? null,
});

describe('EntityChip', () => {
  it('renders the name and tag badges in the given order with their colors', () => {
    render(
      <EntityChip
        kind="contact"
        id="k1"
        name="Kay One"
        tags={[tag('b', 'Billing', '#111111', '#eeeeee'), tag('a', 'VIP', '#fef3c7', '#92400e')]}
      />,
    );
    expect(screen.getByText('Kay One')).toBeTruthy();
    const badges = screen.getAllByTestId('entity-chip-tag');
    expect(badges.map((b) => b.textContent)).toEqual(['Billing', 'VIP']);
    expect((badges[1] as HTMLElement).style.backgroundColor).toBe('rgb(254, 243, 199)');
    expect((badges[1] as HTMLElement).style.color).toBe('rgb(146, 64, 14)');
  });

  it('collapses badges beyond maxBadges into +n and lists the rest', () => {
    render(
      <EntityChip
        kind="client"
        id="c1"
        name="Client One"
        maxBadges={2}
        tags={[tag('1', 'One'), tag('2', 'Two'), tag('3', 'Three'), tag('4', 'Four')]}
      />,
    );
    expect(screen.getAllByTestId('entity-chip-tag').map((b) => b.textContent)).toEqual(['One', 'Two']);
    const overflow = screen.getByTestId('entity-chip-overflow');
    expect(overflow.textContent).toBe('+2');
    expect(overflow.getAttribute('aria-label')).toContain('Three, Four');
  });

  it('shows no overflow when every tag fits, and no badges without tags', () => {
    const { rerender } = render(<EntityChip kind="client" name="A" tags={[tag('1', 'One')]} />);
    expect(screen.queryByTestId('entity-chip-overflow')).toBeNull();
    rerender(<EntityChip kind="client" name="A" tags={[]} />);
    expect(screen.queryByTestId('entity-chip-tag')).toBeNull();
  });

  it('fires click-through without letting the row click fire', () => {
    const onClick = vi.fn();
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <EntityChip kind="contact" id="k1" name="Kay One" onClick={onClick} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('renders a placeholder, not a button, when there is no entity', () => {
    render(<EntityChip kind="contact" name={null} onClick={() => undefined} emptyLabel="No contact" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('No contact')).toBeTruthy();
  });
});
