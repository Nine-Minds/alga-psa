import { describe, expect, it } from 'vitest';
import {
  getVisibleMicrosoftConsumerTypes,
  isMicrosoftConsumerEnterpriseEdition,
  isVisibleMicrosoftConsumerType,
} from './microsoftConsumerVisibility';

describe('microsoftConsumerVisibility', () => {
  it('treats only enterprise editions as multi-consumer Microsoft environments', () => {
    expect(isMicrosoftConsumerEnterpriseEdition({ EDITION: 'ee' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(
      isMicrosoftConsumerEnterpriseEdition({
        NEXT_PUBLIC_EDITION: 'enterprise',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isMicrosoftConsumerEnterpriseEdition({
        EDITION: 'ce',
        NEXT_PUBLIC_EDITION: 'community',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
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
