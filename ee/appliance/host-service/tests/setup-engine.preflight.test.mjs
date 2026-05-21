import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSetupPreflight, validateSetupInputs } from '../setup-engine.mjs';

test('validateSetupInputs rejects invalid custom DNS values', () => {
  assert.throws(
    () => validateSetupInputs({ channel: 'stable', dnsMode: 'custom', dnsServers: '8.8.8.8,not-an-ip', repoUrl: 'https://github.com/Nine-Minds/alga-psa.git' }),
    /Invalid custom DNS server/
  );
});

test('runSetupPreflight blocks early when no system resolvers are present', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-preflight-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const resolvConf = path.join(tmp, 'resolv.conf');
  fs.writeFileSync(resolvConf, '# empty resolver file\n');

  const inputs = validateSetupInputs({
    channel: 'stable',
    appHostname: 'psa.example.com',
    dnsMode: 'system',
    dnsServers: '',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: 'main'
  });

  const result = await runSetupPreflight(inputs, { stateFile, resolvConfPath: resolvConf });
  assert.equal(result.ok, false);
  assert.equal(result.phase, 'dns');
  assert.match(result.message, /No system DNS resolvers detected/);

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'preflight-blocked');
  assert.equal(persisted.phase, 'dns');
  assert.equal(persisted.failure.phase, 'dns');
});
