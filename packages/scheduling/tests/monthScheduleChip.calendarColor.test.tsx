/**
 * @vitest-environment jsdom
 */
/**
 * The month view renders entries through MonthScheduleChip. When several
 * calendars are overlaid, each chip must keep its owning calendar's colour as a
 * left stripe, the same cue the week view draws, or overlaid entries cannot be
 * told apart in month view.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MonthScheduleChip from '../src/components/schedule/MonthScheduleChip';

function renderChip(calendarColor?: string) {
  render(
    <MonthScheduleChip
      workItemType="ticket"
      isPrimary
      opacity={1}
      tooltip="Entry"
      calendarColor={calendarColor}
      onClick={() => {}}
      onMouseEnter={() => {}}
      onMouseLeave={() => {}}
    >
      Overlay entry
    </MonthScheduleChip>
  );
  return screen.getByTitle('Entry');
}

describe('MonthScheduleChip calendar colour', () => {
  it('draws the owning calendar colour as a left stripe', () => {
    // jsdom normalises the palette's hex colour to rgb().
    expect(renderChip('#7c3aed').style.borderLeft).toBe('4px solid rgb(124, 58, 237)');
  });

  it('draws no stripe for an entry without an overlay calendar', () => {
    expect(renderChip().style.borderLeft).toBe('');
  });
});
