import { describe, expect, it } from 'vitest';
import { generateTotp } from '@ee/lib/credentials/totp';
import { generateTotpInBrowser } from '@ee/lib/credentials/totpBrowser';
describe('browser TOTP', () => { it('matches the server RFC vector', async () => { const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; await expect(generateTotpInBrowser(secret, 59000)).resolves.toEqual(generateTotp(secret, 59000)); }); });
