import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ButtonDemo } from '../src/demos/ButtonDemo';
import { InputDemo } from '../src/demos/InputDemo';
import { SelectDemo } from '../src/demos/SelectDemo';
import { CardDemo } from '../src/demos/CardDemo';
import { AlertDemo } from '../src/demos/AlertDemo';
import { TextDemo } from '../src/demos/TextDemo';
import { StackDemo } from '../src/demos/StackDemo';
import { BadgeDemo } from '../src/demos/BadgeDemo';

const findButton = (label: string) => screen.getByRole('button', { name: label });

describe('Button demo', () => {
  test('primary variant uses alga primary background', () => {
    render(<ButtonDemo />);
    expect(findButton('Primary').style.background).toContain('var(--alga-primary)');
  });

  test('secondary variant uses alga secondary background', () => {
    render(<ButtonDemo />);
    expect(findButton('Secondary').style.background).toContain('var(--alga-secondary)');
  });

  test('destructive variant uses alga accent background', () => {
    render(<ButtonDemo />);
    expect(findButton('Destructive').style.background).toContain('var(--alga-accent)');
  });

  test('outline variant uses transparent background with border', () => {
    render(<ButtonDemo />);
    const btn = findButton('Outline');
    expect(btn.style.background).toBe('transparent');
    expect(btn.style.borderColor).toContain('var(--alga-border)');
  });

  test('ghost variant uses transparent background', () => {
    render(<ButtonDemo />);
    expect(findButton('Ghost').style.background).toBe('transparent');
  });

  test('link variant uses transparent background with underline', () => {
    render(<ButtonDemo />);
    const btn = findButton('Link');
    expect(btn.style.background).toBe('transparent');
    expect(btn.style.textDecoration).toBe('underline');
  });

  test('soft variant uses alga primary-soft background', () => {
    render(<ButtonDemo />);
    expect(findButton('Soft').style.background).toContain('var(--alga-primary-soft)');
  });

  test('dashed variant uses dashed border style', () => {
    render(<ButtonDemo />);
    const btn = findButton('Dashed');
    expect(btn.style.background).toContain('var(--alga-primary-soft)');
    expect(btn.style.borderStyle).toBe('dashed');
  });

  test('disabled buttons have reduced opacity and are non-interactive', () => {
    render(<ButtonDemo />);
    const buttons = screen.getAllByRole('button');
    const disabledButtons = buttons.filter((b) => (b as HTMLButtonElement).disabled);
    expect(disabledButtons.length).toBeGreaterThanOrEqual(1);
    disabledButtons.forEach((btn) => {
      expect((btn as HTMLElement).style.opacity).toBe('0.5');
    });
  });
});

describe('Input demo', () => {
  test('input accepts text input', async () => {
    const user = userEvent.setup();
    render(<InputDemo />);
    const input = screen.getByPlaceholderText('Enter a value') as HTMLInputElement;
    await user.type(input, 'Hello');
    expect(input.value).toBe('Hello');
  });

  test('placeholder text is visible when empty', () => {
    render(<InputDemo />);
    const input = screen.getByPlaceholderText('Enter a value') as HTMLInputElement;
    expect(input.placeholder).toBe('Enter a value');
  });

  test('disabled input cannot receive focus', async () => {
    const user = userEvent.setup();
    render(<InputDemo />);
    const input = screen.getByPlaceholderText('Disabled') as HTMLInputElement;
    await user.click(input);
    expect(input).not.toHaveFocus();
  });
});

describe('CustomSelect demo', () => {
  test('dropdown opens on click', async () => {
    const user = userEvent.setup();
    render(<SelectDemo />);
    const trigger = screen.getAllByRole('combobox')[0];
    await user.click(trigger);
    expect(await screen.findByText('Paused')).toBeInTheDocument();
  });

  test('selected option is displayed', async () => {
    const user = userEvent.setup();
    render(<SelectDemo />);
    const trigger = screen.getAllByRole('combobox')[0];
    await user.click(trigger);
    const paused = await screen.findByRole('option', { name: 'Paused' });
    await user.click(paused);
    expect(trigger).toHaveTextContent('Paused');
  });

  test('disabled select does not open', async () => {
    const user = userEvent.setup();
    render(<SelectDemo />);
    const disabledTrigger = screen.getAllByRole('combobox')[1];
    await user.click(disabledTrigger);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });
});

describe('Card demo', () => {
  test('card renders with border and padding', () => {
    render(<CardDemo />);
    const card = screen.getByText('Starter Plan').closest('div')?.parentElement as HTMLElement | null;
    expect(card?.style.border).toContain('var(--alga-border)');
    expect(card?.style.padding).toBe('16px');
  });

  test('card content is displayed inside', () => {
    render(<CardDemo />);
    expect(screen.getByText('Starter Plan')).toBeInTheDocument();
    expect(screen.getByText('$24 / month')).toBeInTheDocument();
  });
});

describe('Alert demo', () => {
  test('info tone has left border and primary-soft background', () => {
    render(<AlertDemo />);
    const info = screen.getByText('Info').closest('[role="alert"]') as HTMLElement;
    expect(info.style.background).toContain('var(--alga-primary-soft');
    expect(info.style.borderLeft).toContain('var(--alga-primary');
  });

  test('success tone has green left border', () => {
    render(<AlertDemo />);
    const success = screen.getByText('Success').closest('[role="alert"]') as HTMLElement;
    expect(success.style.borderLeft).toContain('var(--alga-success');
  });

  test('warning tone has amber/orange left border', () => {
    render(<AlertDemo />);
    const warning = screen.getByText('Warning').closest('[role="alert"]') as HTMLElement;
    expect(warning.style.borderLeft).toContain('var(--alga-warning');
  });

  test('danger tone has red left border', () => {
    render(<AlertDemo />);
    const danger = screen.getByText('Danger').closest('[role="alert"]') as HTMLElement;
    expect(danger.style.borderLeft).toContain('var(--alga-danger');
  });
});

describe('Text demo', () => {
  test('size props change font size', () => {
    render(<TextDemo />);
    const xs = screen.getByText('Extra small text');
    const lg = screen.getByText('Large text');
    expect(Number(xs.style.fontSize.replace('px', ''))).toBeLessThan(Number(lg.style.fontSize.replace('px', '')));
  });

  test('weight prop changes font weight', () => {
    render(<TextDemo />);
    const bold = screen.getByText('Bold 700');
    expect(bold.style.fontWeight).toBe('700');
  });

  test('as prop renders correct HTML element', () => {
    render(<TextDemo />);
    expect(screen.getByText('Heading 1').tagName).toBe('H1');
    expect(screen.getByText('Heading 2').tagName).toBe('H2');
    expect(screen.getByText('Paragraph text rendered via Text').tagName).toBe('P');
    expect(screen.getByText('Span inline text').tagName).toBe('SPAN');
  });
});

describe('Stack demo', () => {
  test('horizontal direction displays items in a row', () => {
    render(<StackDemo />);
    const row = screen.getByText('A').parentElement as HTMLElement;
    expect(row.style.flexDirection).toBe('row');
  });

  test('vertical direction displays items in a column', () => {
    render(<StackDemo />);
    const column = screen.getByText('1').parentElement as HTMLElement;
    expect(column.style.flexDirection).toBe('column');
  });

  test('gap prop adds spacing between items', () => {
    render(<StackDemo />);
    const row = screen.getByText('A').parentElement as HTMLElement;
    expect(row.style.gap).toBe('8px');
  });
});

describe('Badge demo', () => {
  test('default tone renders neutral styling', () => {
    render(<BadgeDemo />);
    const badge = screen.getByText('Default');
    expect(badge.style.background).toContain('var(--alga-muted');
  });

  test('success tone renders green styling', () => {
    render(<BadgeDemo />);
    const badge = screen.getByText('Success');
    expect(badge.style.background).toContain('rgb(220, 252, 231)');
  });

  test('warning and danger tones render correctly', () => {
    render(<BadgeDemo />);
    const warning = screen.getByText('Warning');
    const danger = screen.getByText('Danger');
    expect(warning.style.background).toContain('rgb(254, 243, 199)');
    expect(danger.style.background).toContain('rgb(255, 247, 237)');
  });
});
