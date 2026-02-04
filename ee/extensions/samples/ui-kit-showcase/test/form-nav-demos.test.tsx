import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckboxDemo } from '../src/demos/CheckboxDemo';
import { SwitchDemo } from '../src/demos/SwitchDemo';
import { TextAreaDemo } from '../src/demos/TextAreaDemo';
import { LabelDemo } from '../src/demos/LabelDemo';
import { SearchInputDemo } from '../src/demos/SearchInputDemo';
import { TabsDemo } from '../src/demos/TabsDemo';
import { DrawerDemo } from '../src/demos/DrawerDemo';
import { DropdownMenuDemo } from '../src/demos/DropdownMenuDemo';

describe('Checkbox demo', () => {
  test('checkbox toggles between checked and unchecked', async () => {
    const user = userEvent.setup();
    render(<CheckboxDemo />);
    const checkbox = screen.getByLabelText('Checked') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await user.click(checkbox);
    expect(screen.getByLabelText('Unchecked')).toBeInTheDocument();
  });

  test('indeterminate state shows dash/minus icon', () => {
    render(<CheckboxDemo />);
    const input = screen.getByLabelText('Indeterminate') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  test('label is clickable and toggles checkbox', async () => {
    const user = userEvent.setup();
    render(<CheckboxDemo />);
    const checkbox = screen.getByLabelText('Checked') as HTMLInputElement;
    await user.click(screen.getByText('Checked'));
    expect(checkbox.checked).toBe(false);
  });

  test('disabled checkbox cannot be toggled', async () => {
    const user = userEvent.setup();
    render(<CheckboxDemo />);
    const checkbox = screen.getByLabelText('Disabled') as HTMLInputElement;
    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });
});

describe('Switch demo', () => {
  test('switch toggles between on and off', async () => {
    const user = userEvent.setup();
    render(<SwitchDemo />);
    const switchEl = screen.getAllByRole('switch')[0] as HTMLButtonElement;
    await user.click(switchEl);
    expect(switchEl.getAttribute('aria-checked')).toBe('false');
  });

  test('size variants render at different scales', () => {
    render(<SwitchDemo />);
    const switches = screen.getAllByRole('switch');
    const sm = switches[1];
    const lg = switches[3];
    expect(Number(sm.style.width.replace('px', ''))).toBeLessThan(Number(lg.style.width.replace('px', '')));
  });

  test('disabled switch cannot be toggled', async () => {
    const user = userEvent.setup();
    render(<SwitchDemo />);
    const disabled = screen.getAllByRole('switch')[4] as HTMLButtonElement;
    await user.click(disabled);
    expect(disabled.getAttribute('aria-checked')).toBe('true');
  });
});

describe('TextArea demo', () => {
  test('textarea accepts multi-line input', async () => {
    const user = userEvent.setup();
    render(<TextAreaDemo />);
    const textarea = screen.getByPlaceholderText('Write a message...') as HTMLTextAreaElement;
    await user.type(textarea, 'Line 1\nLine 2');
    expect(textarea.value).toContain('Line 2');
  });

  test('rows prop changes visible rows', () => {
    render(<TextAreaDemo />);
    const rows2 = screen.getByPlaceholderText('2 rows') as HTMLTextAreaElement;
    const rows4 = screen.getByPlaceholderText('4 rows') as HTMLTextAreaElement;
    expect(rows2.rows).toBe(2);
    expect(rows4.rows).toBe(4);
  });

  test('resize option controls resize behavior', () => {
    render(<TextAreaDemo />);
    const none = screen.getByPlaceholderText('No resize') as HTMLTextAreaElement;
    const horizontal = screen.getByPlaceholderText('Horizontal resize') as HTMLTextAreaElement;
    expect(none.style.resize).toBe('none');
    expect(horizontal.style.resize).toBe('horizontal');
  });

  test('disabled textarea cannot be edited', async () => {
    const user = userEvent.setup();
    render(<TextAreaDemo />);
    const disabled = screen.getByPlaceholderText('Disabled') as HTMLTextAreaElement;
    await user.type(disabled, 'Text');
    expect(disabled.value).toBe('');
  });
});

describe('Label demo', () => {
  test('label text is rendered', () => {
    render(<LabelDemo />);
    expect(screen.getByText('Email address')).toBeInTheDocument();
  });

  test('required indicator is shown when required=true', () => {
    render(<LabelDemo />);
    const required = screen.getByText('Company name').parentElement as HTMLElement;
    expect(required.textContent).toContain('*');
  });

  test('size variants change font size', () => {
    render(<LabelDemo />);
    const sm = screen.getByText('Small');
    const lg = screen.getByText('Large');
    expect(Number(sm.style.fontSize.replace('px', ''))).toBeLessThan(Number(lg.style.fontSize.replace('px', '')));
  });
});

describe('SearchInput demo', () => {
  test('search icon is visible', () => {
    render(<SearchInputDemo />);
    const input = screen.getByPlaceholderText('Search accounts');
    const container = input.parentElement as HTMLElement;
    expect(container.querySelector('svg')).toBeTruthy();
  });

  test('clear button appears when input has value', async () => {
    const user = userEvent.setup();
    render(<SearchInputDemo />);
    const input = screen.getByPlaceholderText('Search accounts') as HTMLInputElement;
    await user.type(input, 'Query');
    const container = input.parentElement as HTMLElement;
    expect(container.querySelector('button')).toBeTruthy();
  });

  test('clear button clears input value', async () => {
    const user = userEvent.setup();
    render(<SearchInputDemo />);
    const input = screen.getByPlaceholderText('Search accounts') as HTMLInputElement;
    await user.type(input, 'Query');
    const container = input.parentElement as HTMLElement;
    const clearButton = container.querySelector('button') as HTMLButtonElement;
    await user.click(clearButton);
    expect(input.value).toBe('');
  });

  test('loading state shows spinner instead of clear button', () => {
    render(<SearchInputDemo />);
    const input = screen.getByPlaceholderText('Loading results');
    const container = input.parentElement as HTMLElement;
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  test('size variants render at different scales', () => {
    render(<SearchInputDemo />);
    const sm = screen.getByPlaceholderText('Small') as HTMLInputElement;
    const lg = screen.getByPlaceholderText('Large') as HTMLInputElement;
    expect(Number(sm.style.height.replace('px', ''))).toBeLessThan(Number(lg.style.height.replace('px', '')));
  });

  test('debounce delays onSearch callback', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInputDemo />);
    const input = screen.getByPlaceholderText('Debounced search') as HTMLInputElement;
    await user.type(input, 'abc');
    expect(screen.getByText(/Debounced value: —/)).toBeInTheDocument();
    vi.advanceTimersByTime(400);
    await waitFor(() => {
      expect(screen.getByText(/Debounced value: abc/)).toBeInTheDocument();
    });
    vi.useRealTimers();
  });
});

describe('Tabs demo', () => {
  test('default variant shows border-bottom indicator', () => {
    render(<TabsDemo />);
    const active = screen.getAllByRole('button', { name: 'Overview' })[0];
    expect(active.style.borderBottom).toContain('var(--alga-primary');
  });

  test('pills variant shows pill-shaped active state', () => {
    render(<TabsDemo />);
    const active = screen.getAllByRole('button', { name: 'Details' })[0];
    expect(active.style.borderRadius).toBe('6px');
  });

  test('underline variant shows underline indicator', () => {
    render(<TabsDemo />);
    const active = screen.getAllByRole('button', { name: 'Overview' })[2];
    expect(active.style.borderBottom).toContain('var(--alga-primary');
  });

  test('disabled tab cannot be selected', async () => {
    render(<TabsDemo />);
    const disabled = screen.getAllByRole('button', { name: 'Settings' })[0] as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
  });

  test('tab content changes when tab is selected', async () => {
    const user = userEvent.setup();
    render(<TabsDemo />);
    const details = screen.getAllByRole('button', { name: 'Details' })[0];
    await user.click(details);
    expect(screen.getByText('Details content')).toBeInTheDocument();
  });
});

describe('Drawer demo', () => {
  test('right drawer slides in from right edge', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open right' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer.style.right).toBe('0px');
  });

  test('left drawer slides in from left edge', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open left' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer.style.left).toBe('0px');
  });

  test('bottom drawer slides up from bottom', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open bottom' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer.style.bottom).toBe('0px');
  });

  test('different sizes change drawer width/height', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'SM' }));
    const smDrawer = screen.getByRole('dialog');
    const smWidth = Number(smDrawer.style.width.replace('px', ''));
    await user.click(screen.getByRole('button', { name: 'LG' }));
    const lgDrawer = screen.getByRole('dialog');
    const lgWidth = Number(lgDrawer.style.width.replace('px', ''));
    expect(smWidth).toBeLessThan(lgWidth);
  });

  test('title is displayed in drawer header', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open right' }));
    expect(screen.getByText(/Drawer right/)).toBeInTheDocument();
  });

  test('close button closes drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open right' }));
    await user.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('escape key closes drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open right' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('overlay click closes drawer', async () => {
    const user = userEvent.setup();
    render(<DrawerDemo />);
    await user.click(screen.getByRole('button', { name: 'Open right' }));
    const overlay = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    await user.click(overlay);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('DropdownMenu demo', () => {
  test('menu opens on trigger click', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  test('menu items are clickable', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    await user.click(screen.getByText('New item'));
    expect(screen.getByText(/Last action: New item/)).toBeInTheDocument();
  });

  test('dividers separate menu sections', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('div').length).toBeGreaterThan(1);
  });

  test('disabled items are not clickable', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    await user.click(screen.getByText('Disabled action'));
    expect(screen.queryByText(/Last action: Disabled action/)).not.toBeInTheDocument();
  });

  test('danger items have red text', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    const danger = screen.getByText('Delete item');
    expect(danger.style.color).toContain('var(--alga-danger)');
  });

  test('right-aligned menu aligns to right edge of trigger', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Right Align' }));
    const menu = screen.getByRole('menu');
    expect(menu.style.right).toBe('0px');
  });

  test('menu closes on item click', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    await user.click(screen.getByText('New item'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('menu closes on outside click', async () => {
    const user = userEvent.setup();
    render(<DropdownMenuDemo />);
    await user.click(screen.getByRole('button', { name: 'Open Menu' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
