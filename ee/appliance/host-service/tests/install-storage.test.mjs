import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const installer = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'install-storage.sh');

function createHarness(options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-storage-reconcile-'));
  const binDir = path.join(tmp, 'bin');
  const stateDir = path.join(tmp, 'state');
  const callLog = path.join(tmp, 'kubectl-calls.log');
  const inputLog = path.join(tmp, 'kubectl-input.log');
  const kubeconfig = path.join(tmp, 'k3s.yaml');
  fs.mkdirSync(binDir);
  fs.mkdirSync(stateDir);
  fs.writeFileSync(kubeconfig, 'apiVersion: v1\n');
  fs.writeFileSync(callLog, '');
  fs.writeFileSync(inputLog, '');

  if (options.leakedSmokePv) {
    fs.writeFileSync(path.join(stateDir, 'pv-leaked.exists'), '');
    fs.writeFileSync(path.join(stateDir, 'pv-leaked.policy'), 'Retain');
  }

  fs.writeFileSync(path.join(binDir, 'kubectl'), `#!/usr/bin/env bash
set -euo pipefail

args="$*"
state="$FAKE_KUBE_STATE_DIR"
printf '%s%s\\n' "\${FAKE_KUBE_TAG:-}" "$args" >> "$FAKE_KUBE_CALL_LOG"

next_counter() {
  local file="$1"
  local value=0
  if [ -f "$file" ]; then
    value="$(cat "$file")"
  fi
  value=$((value + 1))
  printf '%s' "$value" > "$file"
  printf '%s' "$value"
}

pv_from_args() {
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "persistentvolume" ]; then
      printf '%s' "$2"
      return 0
    fi
    shift
  done
  return 1
}

if [[ "$args" == *"apply -f -"* ]]; then
  input="$(cat)"
  {
    printf '%s\\n' "--- stdin for: $args"
    printf '%s\\n' "$input"
  } >> "$FAKE_KUBE_INPUT_LOG"
  if [[ "$input" == *"name: storage-smoke-pvc"* ]]; then
    printf 'pv-storage-smoke' > "$state/current-smoke-pv"
    printf 'Retain' > "$state/pv-storage-smoke.policy"
    next_counter "$state/smoke-create-count" >/dev/null
  fi
  exit 0
fi

case "$args" in
  *"create namespace "*" --dry-run=client -o yaml"*)
    printf 'apiVersion: v1\\nkind: Namespace\\nmetadata:\\n  name: fake\\n'
    ;;
  *"get storageclass local-path -o jsonpath={.reclaimPolicy}"*)
    printf '%s' "\${FAKE_STORAGE_CLASS_POLICY:-Retain}"
    ;;
  *"get storageclass local-path"*)
    exit 0
    ;;
  *"get persistentvolume -o jsonpath="*|*"get pv -o jsonpath="*)
    printf 'pv-postgresql\\npv-redis\\npv-application\\n'
    if [ -f "$state/pv-leaked.exists" ]; then
      printf 'pv-leaked\\n'
    fi
    if [ -f "$state/current-smoke-pv" ]; then
      cat "$state/current-smoke-pv"
      printf '\\n'
    fi
    ;;
  *"get persistentvolume "*" -o jsonpath={.spec.claimRef.namespace}"*)
    pv="$(pv_from_args "$@")"
    case "$pv" in
      pv-storage-smoke|pv-leaked) printf 'storage-smoke' ;;
      pv-postgresql|pv-redis|pv-application) printf 'msp' ;;
      *) exit 1 ;;
    esac
    ;;
  *"get persistentvolume "*" -o jsonpath={.spec.persistentVolumeReclaimPolicy}"*)
    pv="$(pv_from_args "$@")"
    if [ -f "$state/$pv.policy" ]; then
      cat "$state/$pv.policy"
    else
      printf 'Retain'
    fi
    ;;
  *"patch persistentvolume "*)
    pv="$(pv_from_args "$@")"
    if [[ "$args" == *'"value":"Delete"'* ]]; then
      printf 'Delete' > "$state/$pv.policy"
    fi
    ;;
  *"delete persistentvolume "*)
    pv="$(pv_from_args "$@")"
    case "$pv" in
      pv-storage-smoke)
        rm -f "$state/current-smoke-pv" "$state/pv-storage-smoke.policy"
        ;;
      pv-leaked)
        rm -f "$state/pv-leaked.exists" "$state/pv-leaked.policy"
        ;;
      *)
        printf 'refusing fake deletion of application PV %s\\n' "$pv" >&2
        exit 42
        ;;
    esac
    ;;
  *"wait --for=delete"*"persistentvolume/"*)
    pv="\${args##*persistentvolume/}"
    case "$pv" in
      pv-storage-smoke) [ ! -f "$state/current-smoke-pv" ] ;;
      pv-leaked) [ ! -f "$state/pv-leaked.exists" ] ;;
      *) exit 42 ;;
    esac
    ;;
  *"-n storage-smoke get persistentvolumeclaim storage-smoke-pvc -o jsonpath={.spec.volumeName}"*)
    [ -f "$state/current-smoke-pv" ]
    cat "$state/current-smoke-pv"
    ;;
  *"-n storage-smoke wait --for=jsonpath={.status.phase}=Bound"*)
    [ -f "$state/current-smoke-pv" ]
    ;;
  *"-n storage-smoke wait --for=condition=complete"*)
    [ "\${FAKE_SMOKE_JOB_FAIL:-false}" != "true" ]
    ;;
  *"-n storage-smoke logs job/storage-smoke"*)
    printf 'ok\\n'
    ;;
  *"delete namespace storage-smoke"*)
    if [ -f "$state/current-smoke-pv" ] \
      && [ "$(cat "$state/pv-storage-smoke.policy" 2>/dev/null || true)" = "Delete" ]; then
      rm -f "$state/current-smoke-pv" "$state/pv-storage-smoke.policy"
    fi
    ;;
  *"-n kube-system delete deployment local-path-provisioner"*)
    printf 'deleted' > "$state/bundled-deleted"
    ;;
  *"-n kube-system get deployment local-path-provisioner"*)
    count="$(next_counter "$state/bundled-get-count")"
    reappear_on="\${FAKE_BUNDLED_REAPPEAR_ON_GET:-0}"
    if [ "$reappear_on" -gt 0 ] && [ "$count" -ge "$reappear_on" ]; then
      exit 0
    fi
    exit 1
    ;;
  *"-n local-path-storage rollout status deployment/local-path-provisioner"*)
    [ "\${FAKE_APPLIANCE_CONTROLLER_AVAILABLE:-true}" = "true" ]
    ;;
esac

exit 0
`, { mode: 0o755 });

  return {
    tmp,
    stateDir,
    callLog,
    inputLog,
    kubeconfig,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_KUBE_CALL_LOG: callLog,
      FAKE_KUBE_INPUT_LOG: inputLog,
      FAKE_KUBE_STATE_DIR: stateDir,
      FAKE_APPLIANCE_CONTROLLER_AVAILABLE: options.applianceControllerAvailable === false ? 'false' : 'true',
      FAKE_BUNDLED_REAPPEAR_ON_GET: String(options.bundledReappearOnGet || 0),
      FAKE_SMOKE_JOB_FAIL: options.smokeJobFail ? 'true' : 'false',
      FAKE_STORAGE_CLASS_POLICY: options.storageClassPolicy || 'Retain',
      ALGA_APPLIANCE_STORAGE_LOCK_PATH: path.join(tmp, 'storage-reconcile.lock'),
      ALGA_APPLIANCE_STORAGE_LOCK_ATTEMPTS: options.lockWaitAttempts || '150',
      ALGA_APPLIANCE_STORAGE_STABILITY_SECONDS: '0',
      ...(options.dnsReconcileScript
        ? { ALGA_APPLIANCE_DNS_RECONCILE_SCRIPT: options.dnsReconcileScript }
        : {})
    }
  };
}

function runInstaller(harness) {
  return spawnSync(installer, ['--kubeconfig', harness.kubeconfig], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: harness.env
  });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('storage reconciliation installs the host skip file and converges on only the appliance controller', () => {
  const harness = createHarness({ storageClassPolicy: 'Delete' });
  const result = runInstaller(harness);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Storage prerequisites are ready/);

  const calls = read(harness.callLog);
  const appliedInput = read(harness.inputLog);
  assert.match(appliedInput, /securityContext:\n\s+privileged: true/);
  assert.match(appliedInput, /: > "\/host\/var\/lib\/rancher\/k3s\/server\/manifests\/local-storage\.yaml\.skip"/);
  assert.match(appliedInput, /disable\+:\n\s+- local-storage/);
  assert.match(appliedInput, /--disable servicelb --disable local-storage/);
  assert.match(calls, /delete storageclass local-path/);
  assert.match(calls, /-n kube-system delete deployment local-path-provisioner --ignore-not-found --wait=true/);
  assert.equal((calls.match(/-n kube-system get deployment local-path-provisioner/g) || []).length, 4);
  assert.equal((calls.match(/-n local-path-storage rollout status deployment\/local-path-provisioner/g) || []).length >= 4, true);
});

test('storage reconciliation fails if the bundled controller reappears during the stability check', () => {
  const harness = createHarness({ bundledReappearOnGet: 2 });
  const result = runInstaller(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Bundled kube-system\/local-path-provisioner is still present/);
  assert.doesNotMatch(result.stdout, /Storage prerequisites are ready/);
  assert.equal(fs.existsSync(path.join(harness.stateDir, 'current-smoke-pv')), false);
});

test('storage reconciliation requires the appliance-owned controller to be available', () => {
  const harness = createHarness({ applianceControllerAvailable: false });
  const result = runInstaller(harness);

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Storage prerequisites are ready/);
  assert.equal(fs.existsSync(path.join(harness.stateDir, 'current-smoke-pv')), false);
});

test('smoke failures still transition and remove only the smoke PV', () => {
  const harness = createHarness({ leakedSmokePv: true, smokeJobFail: true });
  const result = runInstaller(harness);

  assert.notEqual(result.status, 0);
  const calls = read(harness.callLog);
  assert.match(calls, /patch persistentvolume pv-leaked --type=json .*"value":"Retain".*"value":"Delete"/);
  assert.match(calls, /delete persistentvolume pv-leaked --wait=false/);
  assert.match(calls, /patch persistentvolume pv-storage-smoke --type=json .*"value":"Retain".*"value":"Delete"/);
  assert.match(calls, /wait --for=delete --timeout=5m persistentvolume\/pv-storage-smoke/);
  assert.equal(fs.existsSync(path.join(harness.stateDir, 'current-smoke-pv')), false);
  assert.equal(fs.existsSync(path.join(harness.stateDir, 'pv-leaked.exists')), false);
  assert.doesNotMatch(calls, /delete persistentvolume pv-(?:postgresql|redis|application)/);
});

// "No flock is held on the path": try to take it from a separate process. The
// lock file itself is allowed to stay on disk (it is never unlinked).
function lockAbsent(lockPath) {
  const probe = spawnSync('bash', ['-c', 'exec 9>>"$1"; flock -n 9', 'probe', lockPath]);
  return probe.status === 0;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, what) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await sleepMs(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// A real process holding flock on the lock path, exactly like a running installer.
async function startHolder(lockPath) {
  const holder = spawn('bash', ['-c', 'exec 9>"$1"; flock 9; sleep 30', 'holder', lockPath], {
    stdio: 'ignore'
  });
  await waitFor(() => fs.existsSync(lockPath) && !lockAbsent(lockPath), 'holder to take the lock');
  return holder;
}

function exited(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
}

function procState(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
}

// A genuine zombie: the backgrounded `sleep 0` exits and its parent (the exec'd
// `sleep 30`) never waits for it, so it stays defunct until the parent dies.
async function startZombie() {
  const parent = spawn('sh', ['-c', 'sleep 0 & echo $!; exec sleep 30'], {
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const zombiePid = await new Promise((resolve) => {
    parent.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())));
  });
  await waitFor(() => {
    try {
      return procState(zombiePid) === 'Z';
    } catch {
      return false;
    }
  }, 'child to become a zombie');
  return { parent, zombiePid };
}

function runInstallerAsync(harness, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(installer, ['--kubeconfig', harness.kubeconfig], {
      cwd: repoRoot,
      env: { ...harness.env, ...extraEnv }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// Ticket alga-2026-0003233: a legacy PID-symlink lock whose owner is a zombie
// passed `kill -0` and was never reclaimed. Ownership is no longer a PID.
test('a legacy symlink lock pointing at a real zombie is migrated and the installer succeeds', async () => {
  const harness = createHarness();
  const lockPath = harness.env.ALGA_APPLIANCE_STORAGE_LOCK_PATH;
  const { parent, zombiePid } = await startZombie();
  try {
    assert.equal(procState(zombiePid), 'Z');
    fs.symlinkSync(String(zombiePid), lockPath);
    const result = runInstaller(harness);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Storage prerequisites are ready/);
    assert.match(result.stdout, /Removed legacy symlink storage reconcile lock/);
    const stat = fs.lstatSync(lockPath);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.isFile(), true);
    assert.equal(fs.existsSync(path.join(path.dirname(lockPath), String(zombiePid))), false);
    assert.equal(lockAbsent(lockPath), true);
  } finally {
    parent.kill('SIGKILL');
    await exited(parent);
  }
});

// Ticket alga-2026-0003233: a PID reused by an unrelated live process (PID
// namespaces restart at low numbers) must not keep the lock held.
test('a legacy symlink lock pointing at a live unrelated PID is reclaimed', () => {
  const harness = createHarness();
  const lockPath = harness.env.ALGA_APPLIANCE_STORAGE_LOCK_PATH;
  fs.symlinkSync(String(process.pid), lockPath);
  const result = runInstaller(harness);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Storage prerequisites are ready/);
  assert.equal(fs.lstatSync(lockPath).isFile(), true);
  assert.equal(lockAbsent(lockPath), true);
});

// An older build used a mkdir lock directory; it recorded no owner and must not
// wedge the new scheme.
test('a legacy mkdir-style lock directory left by an older build is reclaimed', () => {
  const harness = createHarness();
  const lockPath = harness.env.ALGA_APPLIANCE_STORAGE_LOCK_PATH;
  fs.mkdirSync(lockPath);
  const result = runInstaller(harness);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Storage prerequisites are ready/);
  assert.equal(fs.lstatSync(lockPath).isFile(), true);
  assert.equal(lockAbsent(lockPath), true);
});

// A genuinely running reconcile must still exclude a second one, and the
// waiter must not delete or steal the lock.
test('a real flock holder still blocks until the wait times out', async () => {
  const harness = createHarness({ lockWaitAttempts: '1' });
  const lockPath = harness.env.ALGA_APPLIANCE_STORAGE_LOCK_PATH;
  const holder = await startHolder(lockPath);
  try {
    // A waiter must not truncate the holder's diagnostic line.
    const diagnostic = '4242 holder-host boot-id 2026-01-01T00:00:00Z\n';
    fs.writeFileSync(lockPath, diagnostic);
    const result = runInstaller(harness);

    assert.equal(read(lockPath), diagnostic);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Timed out waiting for another storage reconciliation to finish/);
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(lockAbsent(lockPath), false);
  } finally {
    holder.kill('SIGKILL');
    await exited(holder);
  }
});

// The control-plane container being restarted mid-reconcile (e.g. by its
// liveness probe) SIGKILLs the lock holder, so no cleanup ever runs. A dead
// owner must never block future reconciles — that previously left appliances
// permanently unable to update (alga0002202). The kernel drops the flock.
test('a lock whose holder was SIGKILLed is acquired immediately', async () => {
  const harness = createHarness({ lockWaitAttempts: '1' });
  const lockPath = harness.env.ALGA_APPLIANCE_STORAGE_LOCK_PATH;
  const holder = await startHolder(lockPath);
  holder.kill('SIGKILL');
  await exited(holder);

  const result = runInstaller(harness);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Storage prerequisites are ready/);
  assert.equal(lockAbsent(lockPath), true);
});

// Two concurrent reconciles must run one at a time. The fake kubectl tags every
// logged call with the installer that made it, so interleaving shows up as the
// tag changing more than once.
test('two concurrent installers run one at a time without interleaving', async () => {
  const harness = createHarness();
  const [a, b] = await Promise.all([
    runInstallerAsync(harness, { FAKE_KUBE_TAG: 'A|' }),
    runInstallerAsync(harness, { FAKE_KUBE_TAG: 'B|' })
  ]);

  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.equal(b.status, 0, b.stderr || b.stdout);
  const tags = read(harness.callLog)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(0, 1));
  assert.ok(tags.includes('A') && tags.includes('B'));
  const switches = tags.filter((tag, i) => i > 0 && tag !== tags[i - 1]).length;
  assert.equal(switches, 1, `kubectl calls interleaved: ${tags.join('')}`);
  assert.equal(read(path.join(harness.stateDir, 'smoke-create-count')), '2');
});

// A host without util-linux must fail loudly, never silently run unlocked or
// fall back to a PID lock.
test('a missing flock fails loudly with no PID-lock fallback', () => {
  const harness = createHarness();
  const lockPath = harness.env.ALGA_APPLIANCE_STORAGE_LOCK_PATH;
  const toolDir = path.join(harness.tmp, 'tools-without-flock');
  fs.mkdirSync(toolDir);
  for (const tool of ['env', 'bash', 'dirname', 'cat']) {
    const resolved = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(resolved, path.join(toolDir, tool));
  }
  const result = spawnSync(installer, ['--kubeconfig', harness.kubeconfig], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...harness.env, PATH: `${path.join(harness.tmp, 'bin')}:${toolDir}` }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /flock \(util-linux\) is required/);
  assert.doesNotMatch(result.stdout, /Storage prerequisites are ready/);
  assert.equal(fs.existsSync(lockPath), false);
});

// The update engine runs this reconcile first. Run from here, a DNS activation
// that failed on an unrelated broken workload blocked the very app update that
// would have fixed it (stable 1.6.11–1.6.16, email-service). The control
// plane's DNS reconciler owns activation; storage must never trigger it.
test('storage reconciliation never stages a cluster DNS activation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-storage-dns-'));
  const launcher = path.join(tmp, 'reconcile-k3s-dns.sh');
  const marker = path.join(tmp, 'dns-called.log');
  fs.writeFileSync(
    launcher,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${marker}\nexit 1\n`,
    { mode: 0o755 }
  );

  const harness = createHarness({ dnsReconcileScript: launcher });
  const result = runInstaller(harness);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Storage prerequisites are ready/);
  assert.equal(fs.existsSync(marker), false, 'the DNS launcher must not be invoked by the storage reconcile');
});

test('repeated reconciliation preserves application PVs and leaves no smoke resources or side effects', () => {
  const harness = createHarness();
  const first = runInstaller(harness);
  const second = runInstaller(harness);

  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const calls = read(harness.callLog);
  for (const pv of ['pv-postgresql', 'pv-redis', 'pv-application']) {
    assert.equal(
      (calls.match(new RegExp(`patch persistentvolume ${pv} .*persistentVolumeReclaimPolicy.*Retain`, 'g')) || []).length,
      2
    );
    assert.doesNotMatch(calls, new RegExp(`delete persistentvolume ${pv}`));
  }
  assert.equal(read(path.join(harness.stateDir, 'smoke-create-count')), '2');
  assert.equal(fs.existsSync(path.join(harness.stateDir, 'current-smoke-pv')), false);
  assert.equal(fs.existsSync(path.join(harness.stateDir, 'pv-storage-smoke.policy')), false);
});
