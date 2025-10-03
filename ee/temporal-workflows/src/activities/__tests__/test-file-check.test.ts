import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, access } from 'node:fs/promises';

describe('Check if file actually gets created', () => {
  it('should show file exists after test', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'test-check-'));
    const filePath = path.join(tmpDir, 'msp', 'istio-virtualservice.yaml');
    
    let exists = false;
    try {
      await access(filePath);
      exists = true;
    } catch {}
    
    console.log('File exists:', exists);
    console.log('File path:', filePath);
  });
});
