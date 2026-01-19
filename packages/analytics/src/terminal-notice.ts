import fs from 'fs';
import path from 'path';
import os from 'os';

const NOTICE_FILE = path.join(os.homedir(), '.alga-psa', 'usage-stats-notice-shown');

export function hasShownUsageStatsNotice(): boolean {
  try {
    return fs.existsSync(NOTICE_FILE);
  } catch {
    return false;
  }
}

export function markUsageStatsNoticeShown(): void {
  try {
    const dir = path.dirname(NOTICE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(NOTICE_FILE, new Date().toISOString());
  } catch (error) {
    console.error('Failed to mark usage stats notice as shown:', error);
  }
}

export function showUsageStatsNotice(): void {
  // Check if we've already shown the notice
  if (hasShownUsageStatsNotice()) return;
  
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    Usage Statistics Notice                     ║
║                                                                ║
║  Alga PSA collects anonymous usage statistics to help         ║
║  improve the product. No personal or customer data is sent.   ║
║                                                                ║
║  This helps us understand:                                     ║
║  • Which features are used most                                ║
║  • Performance characteristics                                 ║
║  • Error patterns to fix                                       ║
║                                                                ║
║  To opt out, set ALGA_USAGE_STATS=false in your .env file    ║
║                                                                ║
║  Learn more: https://docs.algapsa.com/privacy                  ║
╚════════════════════════════════════════════════════════════════╝
`);
  
  // Mark that we've shown the notice
  markUsageStatsNoticeShown();
}