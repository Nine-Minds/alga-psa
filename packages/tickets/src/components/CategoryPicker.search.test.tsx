import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CategoryPicker } from './CategoryPicker';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key,
  }),
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('CategoryPicker search', () => {
  it('filters the category tree by a matching subcategory and keeps it selectable', async () => {
    const onSelect = vi.fn();

    render(
      <CategoryPicker
        id="ticket-category-picker"
        categories={[
          { category_id: 'hardware', category_name: 'Hardware' },
          { category_id: 'laptops', category_name: 'Laptops', parent_category: 'hardware' },
          { category_id: 'network', category_name: 'Network' },
        ]}
        selectedCategories={[]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('combobox'));

    const searchInput = await screen.findByPlaceholderText('Search categories...');
    expect(searchInput).toHaveAttribute('id', 'ticket-category-picker-search-input');
    fireEvent.change(searchInput, { target: { value: 'laptop' } });

    expect(screen.getByText('Hardware')).toBeInTheDocument();
    expect(screen.getByText('Laptops')).toBeInTheDocument();
    expect(screen.queryByText('Network')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Laptops'));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(['laptops'], []);
    });
  });
});
