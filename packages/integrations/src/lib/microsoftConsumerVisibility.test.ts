import { describe, expect, it } from 'vitest';
import {
  getVisibleMicrosoftConsumerTypes,
  isMicrosoftConsumerEnterpriseEdition,
  isVisibleMicrosoftConsumerType,
} from './microsoftConsumerVisibility';

describe('microsoftConsumerVisibility', () => {
  it('treats only enterprise editions as multi-consumer Microsoft environments', () => {
    const originalEdition = process.env.EDITION;
    const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

    try {
      process.env.EDITION = 'ee';
      delete process.env.NEXT_PUBLIC_EDITION;
      expect(isMicrosoftConsumerEnterpriseEdition()).toBe(true);

      delete process.env.EDITION;
      process.env.NEXT_PUBLIC_EDITION = 'enterprise';
      expect(isMicrosoftConsumerEnterpriseEdition()).toBe(true);

      process.env.EDITION = 'ce';
      process.env.NEXT_PUBLIC_EDITION = 'community';
      expect(isMicrosoftConsumerEnterpriseEdition()).toBe(false);
    } finally {
      if (originalEdition === undefined) {
        delete process.env.EDITION;
      } else {
        process.env.EDITION = originalEdition;
      }

      if (originalPublicEdition === undefined) {
        delete process.env.NEXT_PUBLIC_EDITION;
      } else {
        process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
      }
    }
  });

  it('returns only MSP SSO in community edition', () => {
    expect(getVisibleMicrosoftConsumerTypes(false)).toEqual(['msp_sso']);
    expect(isVisibleMicrosoftConsumerType('msp_sso', false)).toBe(true);
    expect(isVisibleMicrosoftConsumerType('email', false)).toBe(false);
    expect(isVisibleMicrosoftConsumerType('calendar', false)).toBe(false);
    expect(isVisibleMicrosoftConsumerType('teams', false)).toBe(false);
  });

  it('returns every supported Microsoft consumer in enterprise edition', () => {
    expect(getVisibleMicrosoftConsumerTypes(true)).toEqual(['msp_sso', 'email', 'calendar', 'teams']);
    expect(isVisibleMicrosoftConsumerType('msp_sso', true)).toBe(true);
    expect(isVisibleMicrosoftConsumerType('email', true)).toBe(true);
    expect(isVisibleMicrosoftConsumerType('calendar', true)).toBe(true);
    expect(isVisibleMicrosoftConsumerType('teams', true)).toBe(true);
  });
});
