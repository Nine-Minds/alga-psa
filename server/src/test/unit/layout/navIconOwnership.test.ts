import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Monitor, SquareActivity } from 'lucide-react';

import { menuItems } from '../../../config/menuConfig';

// One glyph per feature, one feature per glyph: a collapsed rail is unreadable
// when the same picture means two things (or one thing wears two pictures).
describe('nav icon ownership', () => {
  const navItem = (name: string) => menuItems.find((item) => item.name === name);

  it('gives System Monitoring the screen-with-activity glyph', () => {
    expect(navItem('System Monitoring')?.icon).toBe(SquareActivity);
  });

  it('keeps the plain screen metaphor off Assets', () => {
    const assets = navItem('Assets');

    expect(assets?.icon).not.toBe(Monitor);
    expect((assets?.subItems ?? []).some((subItem) => subItem.icon === Monitor)).toBe(false);
  });

  it('uses that same glyph on the dashboard System Monitoring card', () => {
    const dashboard = fs.readFileSync(
      path.resolve(__dirname, '../../../components/dashboard/DashboardContainer.tsx'),
      'utf8',
    );

    expect(dashboard).toMatch(/id: 'monitoring',[\s\S]{0,200}?icon: SquareActivity,/);
  });
});
