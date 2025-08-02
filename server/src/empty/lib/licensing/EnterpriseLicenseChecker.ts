// Stub implementation for CE build
import { ILicenseChecker, LicenseCheckResult } from '../../../lib/licensing/LicenseChecker';

export class EnterpriseLicenseChecker implements ILicenseChecker {
  async checkUserLimit(currentUserCount: number): Promise<LicenseCheckResult> {
    // CE version - no limit
    return {
      allowed: true,
      limit: Infinity,
      current: currentUserCount,
      message: 'Community Edition - no user limits'
    };
  }

  async getUserLimit(): Promise<number> {
    // CE version - no limit
    return Infinity;
  }

  // Additional static methods that might be used elsewhere
  static async checkLicense(): Promise<boolean> {
    return false;
  }

  static isEnterpriseFeatureEnabled(feature: string): boolean {
    return false;
  }

  static async validateLicense(licenseKey: string): Promise<boolean> {
    return false;
  }
}

export default EnterpriseLicenseChecker;