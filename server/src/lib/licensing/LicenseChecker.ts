export interface LicenseCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  message?: string;
}

export interface ILicenseChecker {
  checkUserLimit(currentUserCount: number): Promise<LicenseCheckResult>;
  getUserLimit(): Promise<number>;
}