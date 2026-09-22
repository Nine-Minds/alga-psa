import { describe, it, expect } from 'vitest';
import {
  parseDeploymentProfile,
  resolveDeploymentCapabilities,
} from '@/lib/deployment/deploymentProfile';

describe('deploymentProfile', () => {
  describe('parseDeploymentProfile', () => {
    it('resolves "appliance" (case-insensitive, trimmed) to appliance', () => {
      expect(parseDeploymentProfile('appliance')).toBe('appliance');
      expect(parseDeploymentProfile('  Appliance ')).toBe('appliance');
      expect(parseDeploymentProfile('APPLIANCE')).toBe('appliance');
    });

    it('resolves unset/empty/unknown to the safe default hosted', () => {
      expect(parseDeploymentProfile(undefined)).toBe('hosted');
      expect(parseDeploymentProfile(null)).toBe('hosted');
      expect(parseDeploymentProfile('')).toBe('hosted');
      expect(parseDeploymentProfile('hosted')).toBe('hosted');
      expect(parseDeploymentProfile('cloud')).toBe('hosted');
      expect(parseDeploymentProfile('appliancex')).toBe('hosted');
    });
  });

  describe('resolveDeploymentCapabilities', () => {
    it('maps appliance -> direct provisioner + trustForwardedHost true', () => {
      const caps = resolveDeploymentCapabilities({ DEPLOYMENT_PROFILE: 'appliance' });
      expect(caps.portalDomain.provisioner).toBe('direct');
      expect(caps.trustForwardedHost).toBe(true);
    });

    it('maps hosted/unset/unknown -> temporal provisioner + trustForwardedHost false', () => {
      for (const env of [
        { DEPLOYMENT_PROFILE: 'hosted' },
        { DEPLOYMENT_PROFILE: '' },
        { DEPLOYMENT_PROFILE: undefined },
        {},
        { DEPLOYMENT_PROFILE: 'nonsense' },
      ]) {
        const caps = resolveDeploymentCapabilities(env);
        expect(caps.portalDomain.provisioner).toBe('temporal');
        expect(caps.trustForwardedHost).toBe(false);
      }
    });

    it('TRUST_FORWARDED_HOST switches on forwarded-host trust without the appliance profile', () => {
      for (const value of ['true', 'TRUE', ' 1 ', 'yes']) {
        const caps = resolveDeploymentCapabilities({ TRUST_FORWARDED_HOST: value });
        expect(caps.trustForwardedHost).toBe(true);
        expect(caps.portalDomain.provisioner).toBe('temporal');
        expect(caps.microsoftOAuth.sharedApp).toBe(true);
      }
    });

    it('ignores non-affirmative TRUST_FORWARDED_HOST values', () => {
      for (const value of ['false', '0', 'no', '', undefined, 'nonsense']) {
        expect(resolveDeploymentCapabilities({ TRUST_FORWARDED_HOST: value }).trustForwardedHost).toBe(false);
      }
    });

    it('never lets TRUST_FORWARDED_HOST disable trust on the appliance', () => {
      const caps = resolveDeploymentCapabilities({ DEPLOYMENT_PROFILE: 'appliance', TRUST_FORWARDED_HOST: 'false' });
      expect(caps.trustForwardedHost).toBe(true);
    });

    it('maps the Microsoft OAuth app model from the profile', () => {
      expect(resolveDeploymentCapabilities({}).microsoftOAuth.sharedApp).toBe(true);
      expect(resolveDeploymentCapabilities({ DEPLOYMENT_PROFILE: 'appliance' }).microsoftOAuth.sharedApp).toBe(false);
    });
  });
});
