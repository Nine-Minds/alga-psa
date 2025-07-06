import { ILicenseChecker } from './LicenseChecker';
import { OpenSourceLicenseChecker } from './OpenSourceLicenseChecker';

let cachedLicenseChecker: ILicenseChecker | null = null;

export async function getLicenseChecker(): Promise<ILicenseChecker> {
  if (cachedLicenseChecker) {
    return cachedLicenseChecker;
  }

  const edition = process.env.NEXT_PUBLIC_EDITION;
  
  if (edition === 'enterprise') {
    try {
      const { EnterpriseLicenseChecker } = await import('@ee/lib/licensing/EnterpriseLicenseChecker');
      cachedLicenseChecker = new EnterpriseLicenseChecker();
    } catch (error) {
      console.warn('Failed to load Enterprise License Checker, falling back to Open Source:', error);
      cachedLicenseChecker = new OpenSourceLicenseChecker();
    }
  } else {
    cachedLicenseChecker = new OpenSourceLicenseChecker();
  }

  return cachedLicenseChecker;
}

export * from './LicenseChecker';