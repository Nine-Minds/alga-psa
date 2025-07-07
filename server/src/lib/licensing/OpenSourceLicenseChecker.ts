import { ILicenseChecker, LicenseCheckResult } from './LicenseChecker';

export class OpenSourceLicenseChecker implements ILicenseChecker {
  async checkUserLimit(currentUserCount: number): Promise<LicenseCheckResult> {
    return {
      allowed: true,
      limit: Number.MAX_SAFE_INTEGER,
      current: currentUserCount,
      message: 'Open Source edition has no user limits'
    };
  }

  async getUserLimit(): Promise<number> {
    return Number.MAX_SAFE_INTEGER;
  }
}