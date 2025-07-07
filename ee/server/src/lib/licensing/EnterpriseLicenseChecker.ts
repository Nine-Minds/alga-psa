import { ILicenseChecker, LicenseCheckResult } from '../../../../../server/src/lib/licensing/LicenseChecker';

export class EnterpriseLicenseChecker implements ILicenseChecker {
  private readonly DEFAULT_USER_LIMIT = 50;

  async checkUserLimit(currentUserCount: number): Promise<LicenseCheckResult> {
    const limit = await this.getUserLimit();
    const allowed = currentUserCount < limit;
    
    return {
      allowed,
      limit,
      current: currentUserCount,
      message: allowed 
        ? `${currentUserCount}/${limit} users` 
        : `User limit reached (${currentUserCount}/${limit}). Contact support to increase your limit.`
    };
  }

  async getUserLimit(): Promise<number> {
    return this.DEFAULT_USER_LIMIT;
  }
}