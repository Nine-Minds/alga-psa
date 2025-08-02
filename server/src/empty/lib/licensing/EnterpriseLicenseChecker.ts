// Stub implementation for CE build
export class EnterpriseLicenseChecker {
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