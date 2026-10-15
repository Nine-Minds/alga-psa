import { describe, expect, it } from 'vitest';
import { parseOverlayListHeight, resolveOverlayVerticalFit } from './SearchableSelect';

describe('parseOverlayListHeight', () => {
  it('reads rem and px list heights', () => {
    expect(parseOverlayListHeight('15rem')).toBe(240);
    expect(parseOverlayListHeight('320px')).toBe(320);
    expect(parseOverlayListHeight('200')).toBe(200);
  });

  it('falls back to the default for units it cannot read', () => {
    expect(parseOverlayListHeight('calc(100vh - 2rem)')).toBe(240);
  });
});

describe('resolveOverlayVerticalFit', () => {
  it('opens below the trigger when the list fits there', () => {
    expect(
      resolveOverlayVerticalFit({
        triggerTop: 200,
        triggerBottom: 240,
        viewportHeight: 813,
        preferredListHeight: 240,
      })
    ).toEqual({ placement: 'below', listMaxHeight: 240 });
  });

  it('flips above when a picker low in a short viewport would run off the bottom', () => {
    const fit = resolveOverlayVerticalFit({
      triggerTop: 700,
      triggerBottom: 740,
      viewportHeight: 813,
      preferredListHeight: 240,
    });

    expect(fit.placement).toBe('above');
    expect(fit.listMaxHeight).toBe(240);
  });

  it('caps the list to the room below rather than overflowing it', () => {
    const fit = resolveOverlayVerticalFit({
      triggerTop: 500,
      triggerBottom: 540,
      viewportHeight: 813,
      preferredListHeight: 240,
    });

    expect(fit.placement).toBe('below');
    expect(fit.listMaxHeight).toBe(813 - 540 - 4 - 8 - 44);
  });

  it('stays below when there is even less room above', () => {
    expect(
      resolveOverlayVerticalFit({
        triggerTop: 20,
        triggerBottom: 60,
        viewportHeight: 300,
        preferredListHeight: 240,
      }).placement
    ).toBe('below');
  });
});
