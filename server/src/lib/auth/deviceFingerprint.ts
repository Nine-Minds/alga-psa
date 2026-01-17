/**
 * Device Fingerprinting Utilities
 *
 * Generates stable device fingerprints and parses User-Agent strings
 * for session tracking and device recognition.
 *
 * NOTE: Device fingerprints are based on User-Agent only (not IP address)
 * to avoid flagging the same device as "new" when changing networks.
 */

import crypto from 'crypto';
import { UAParser } from 'ua-parser-js';

export interface DeviceInfo {
  name: string; // "Chrome on macOS"
  type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string | undefined;
  browserVersion: string | undefined;
  os: string | undefined;
  osVersion: string | undefined;
}

export function generateDeviceFingerprint(userAgent: string): string {
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  const fingerprintData = [
    browser.name || 'unknown',
    browser.version || '',
    os.name || 'unknown',
    os.version || '',
    device.model || 'unknown',
    device.vendor || '',
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex');
}

export function getDeviceInfo(userAgent: string): DeviceInfo {
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  const browserName = browser.name || 'Unknown Browser';
  const osName = os.name || 'Unknown OS';

  return {
    name: `${browserName} on ${osName}`,
    type: (device.type as DeviceInfo['type']) || 'desktop',
    browser: browser.name,
    browserVersion: browser.version,
    os: os.name,
    osVersion: os.version,
  };
}
