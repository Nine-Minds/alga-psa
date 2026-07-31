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
  });
});
