'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Activity, SlidersHorizontal } from 'lucide-react';
import { AlgaLogo } from '../AlgaLogo';
import styles from '../status.module.css';

type SetupConfig = {
  mode?: string;
  defaults?: {
    channel?: string;
    appHostname?: string;
    dnsMode?: string;
    dnsServers?: string;
    releaseRef?: string;
  };
  network?: {
    addresses?: string[];
    resolvers?: string[];
  };
};

type FieldErrors = Partial<Record<'tenantName' | 'adminFirstName' | 'adminLastName' | 'adminEmail' | 'adminPassword' | 'adminPasswordConfirm' | 'appHostname' | 'dnsServers' | 'releaseRef' | 'licenseKey', string>>;

function tokenQuery() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function withToken(path: string, query: string) {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query.slice(1)}` : `${path}${query}`;
}

function isValidIpv4(value: string) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function passwordValidationError(value: string) {
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/\d/.test(value)) return 'Include a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Include a special character.';
  return null;
}

function isWellFormedJwt(value: string) {
  return /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(value);
}

function validateSetupForm(payload: { tenantName: string; adminFirstName: string; adminLastName: string; adminEmail: string; adminPassword: string; adminPasswordConfirm: string; appHostname: string; dnsMode: string; dnsServers: string; releaseRef: string; licenseKey: string }) {
  const errors: FieldErrors = {};

  if (!payload.tenantName.trim()) errors.tenantName = 'Enter the company name for the initial tenant.';
  if (!payload.adminFirstName.trim()) errors.adminFirstName = 'Enter the admin first name.';
  if (!payload.adminLastName.trim()) errors.adminLastName = 'Enter the admin last name.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.adminEmail.trim())) errors.adminEmail = 'Enter a valid admin email address.';
  const passwordError = passwordValidationError(payload.adminPassword);
  if (passwordError) errors.adminPassword = passwordError;
  if (payload.adminPassword !== payload.adminPasswordConfirm) errors.adminPasswordConfirm = 'Passwords do not match.';

  if (!payload.appHostname.trim()) {
    errors.appHostname = 'Enter the full URL users will open after setup.';
  } else {
    try {
      const parsed = new URL(payload.appHostname.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.appHostname = 'Use an http or https URL.';
      }
    } catch {
      errors.appHostname = 'Use a full URL, for example http://192.168.1.50:3000.';
    }
  }

  if (payload.dnsMode === 'custom') {
    const servers = payload.dnsServers.split(',').map((value) => value.trim()).filter(Boolean);
    if (servers.length === 0) {
      errors.dnsServers = 'Enter at least one DNS server for custom DNS.';
    } else {
      const invalid = servers.filter((server) => !isValidIpv4(server));
      if (invalid.length) errors.dnsServers = `Check these IPv4 addresses: ${invalid.join(', ')}.`;
    }
  }

  if (payload.releaseRef && !/^[A-Za-z0-9._:@/-]+$/.test(payload.releaseRef)) {
    errors.releaseRef = 'Use a release version (e.g. 1.0.3) or a digest (sha256:...).';
  }

  if (payload.licenseKey && !isWellFormedJwt(payload.licenseKey.trim())) {
    errors.licenseKey = 'License key format is invalid. Paste the full key as provided.';
  }

  return errors;
}

function SkeletonCard() {
  return (
    <article className={`${styles.card} ${styles.full}`} aria-busy="true">
      <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
      <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
      <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
      <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
    </article>
  );
}

export default function SetupPage() {
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('stable');
  const [tenantName, setTenantName] = useState('');
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [appHostname, setAppHostname] = useState('');
  const [dnsMode, setDnsMode] = useState('system');
  const [dnsServers, setDnsServers] = useState('');
  const [releaseRef, setReleaseRef] = useState('');
  const [editionChoice, setEditionChoice] = useState<'ee' | 'ce'>('ee');
  const [licenseKey, setLicenseKey] = useState('');

  useEffect(() => {
    setQuery(tokenQuery());
  }, []);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    async function loadConfig() {
      try {
        const response = await fetch(withToken('/api/setup/config', query), { cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 401 ? 'Unauthorized: check the setup token.' : 'Unable to load setup defaults.');
        const data = (await response.json()) as SetupConfig;
        if (cancelled) return;
        setConfig(data);
        setChannel(data.defaults?.channel || 'stable');
        setAppHostname(data.defaults?.appHostname || '');
        setDnsMode(data.defaults?.dnsMode || 'system');
        setDnsServers(data.defaults?.dnsServers || '');
        setReleaseRef(data.defaults?.releaseRef || '');
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, [query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      channel: String(formData.get('channel') || channel),
      tenantName: String(formData.get('tenantName') || ''),
      adminFirstName: String(formData.get('adminFirstName') || ''),
      adminLastName: String(formData.get('adminLastName') || ''),
      adminEmail: String(formData.get('adminEmail') || ''),
      adminPassword: String(formData.get('adminPassword') || ''),
      adminPasswordConfirm: String(formData.get('adminPasswordConfirm') || ''),
      appHostname: String(formData.get('appHostname') || ''),
      dnsMode: String(formData.get('dnsMode') || dnsMode),
      dnsServers: String(formData.get('dnsServers') || ''),
      releaseRef: String(formData.get('releaseRef') || releaseRef),
      editionChoice,
      licenseKey: licenseKey.trim() || undefined,
    };
    const validation = validateSetupForm(payload);
    setFieldErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withToken('/api/setup', query), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to save setup.');
      window.location.href = withToken('/', query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  const resolvers = config?.network?.resolvers || [];
  const addresses = config?.network?.addresses || [];
  const disabled = busy || !config;

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}><AlgaLogo className={styles.logoSvg} /></span>
          <span className={styles.brandText}><span>Alga PSA</span><small>Setup</small></span>
        </div>
        <nav className={styles.nav} aria-label="Alga PSA setup pages">
          <a className={styles.setupLink} aria-current="page" href={withToken('/setup/', query)}><SlidersHorizontal className={styles.navIcon} aria-hidden="true" /><span>Setup</span></a>
          <a className={styles.setupLink} href={withToken('/', query)}><Activity className={styles.navIcon} aria-hidden="true" /><span>Status</span></a>
        </nav>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.commandBar}>
          <div>
            <div className={styles.eyebrow}>Guided setup</div>
            <h1>Configure your appliance</h1>
            <p className={styles.muted}>Confirm the release channel, app URL, and DNS behavior. Advanced support settings stay tucked away unless you need them.</p>
          </div>
          <span className={`${styles.statusPill} ${styles.installing}`}>{busy ? 'Starting setup' : 'Setup'}</span>
        </header>

        <section className={styles.grid}>
          {!config && !error ? <SkeletonCard /> : null}

          <article className={`${styles.card} ${styles.full}`}>
            <h2>Network detected from Ubuntu</h2>
            {!config && !error ? (
              <>
                <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
                <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
              </>
            ) : (
              <dl className={styles.kv}>
                <div><dt>Node addresses</dt><dd>{addresses.length ? addresses.join(', ') : 'No non-loopback address detected'}</dd></div>
                <div><dt>System resolvers</dt><dd>{resolvers.length ? resolvers.join(', ') : 'No resolver detected'}</dd></div>
              </dl>
            )}
          </article>

          <article className={`${styles.card} ${styles.full}`}>
            <h2>Setup details</h2>
            <form id="appliance-setup-form" className={styles.form} onSubmit={submit} noValidate>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Edition</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                      <input type="radio" name="editionChoice" value="ee" checked={editionChoice === 'ee'} onChange={() => setEditionChoice('ee')} disabled={disabled} style={{ marginTop: '0.2rem' }} />
                      <span>
                        <strong>Enterprise</strong> — 30-day free trial, then reverts to Essentials.
                        <br /><small style={{ color: 'var(--muted, #6b7280)' }}>Includes all features. Enter a license key below to extend beyond the trial.</small>
                      </span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                      <input type="radio" name="editionChoice" value="ce" checked={editionChoice === 'ce'} onChange={() => setEditionChoice('ce')} disabled={disabled} style={{ marginTop: '0.2rem' }} />
                      <span>
                        <strong>Essentials</strong> — core open-source feature set, no trial required.
                        <br /><small style={{ color: 'var(--muted, #6b7280)' }}>You can start an Enterprise trial later from the in-app License page.</small>
                      </span>
                    </label>
                  </div>
                </div>

                {editionChoice === 'ee' && (
                  <div className={styles.field}>
                    <label htmlFor="setup-license-key">License key <small style={{ fontWeight: 'normal', color: 'var(--muted, #6b7280)' }}>(optional — enter if you already have one)</small></label>
                    <textarea
                      id="setup-license-key"
                      name="licenseKey"
                      value={licenseKey}
                      onChange={(event) => { setLicenseKey(event.target.value); clearFieldError('licenseKey'); }}
                      placeholder="eyJhbGci…"
                      rows={3}
                      disabled={disabled}
                      aria-invalid={Boolean(fieldErrors.licenseKey)}
                      aria-describedby="setup-license-key-help setup-license-key-error"
                      style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                    />
                    <span id="setup-license-key-help" className={styles.helpText}>Paste the signed key from Nine Minds. Leave blank to start the 30-day trial.</span>
                    {fieldErrors.licenseKey ? <span id="setup-license-key-error" className={styles.fieldError}>{fieldErrors.licenseKey}</span> : null}
                  </div>
                )}

                <div className={styles.field}>
                  <label htmlFor="setup-channel">Release channel</label>
                  <select id="setup-channel" name="channel" value={channel} onChange={(event) => setChannel(event.target.value)} disabled={disabled}>
                    <option value="stable">stable (recommended)</option>
                    <option value="nightly">nightly (testing/support-directed)</option>
                  </select>
                  <span className={styles.helpText}>Stable is recommended unless support asks you to test nightly.</span>
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-tenant-name">Company name</label>
                  <input id="setup-tenant-name" name="tenantName" value={tenantName} onChange={(event) => { setTenantName(event.target.value); clearFieldError('tenantName'); }} placeholder="Acme Managed Services" disabled={disabled} required aria-invalid={Boolean(fieldErrors.tenantName)} aria-describedby="setup-tenant-name-help setup-tenant-name-error" />
                  <span id="setup-tenant-name-help" className={styles.helpText}>This becomes the first tenant and default client company.</span>
                  {fieldErrors.tenantName ? <span id="setup-tenant-name-error" className={styles.fieldError}>{fieldErrors.tenantName}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-admin-first-name">Admin first name</label>
                  <input id="setup-admin-first-name" name="adminFirstName" value={adminFirstName} onChange={(event) => { setAdminFirstName(event.target.value); clearFieldError('adminFirstName'); }} disabled={disabled} required aria-invalid={Boolean(fieldErrors.adminFirstName)} aria-describedby="setup-admin-first-name-error" />
                  {fieldErrors.adminFirstName ? <span id="setup-admin-first-name-error" className={styles.fieldError}>{fieldErrors.adminFirstName}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-admin-last-name">Admin last name</label>
                  <input id="setup-admin-last-name" name="adminLastName" value={adminLastName} onChange={(event) => { setAdminLastName(event.target.value); clearFieldError('adminLastName'); }} disabled={disabled} required aria-invalid={Boolean(fieldErrors.adminLastName)} aria-describedby="setup-admin-last-name-error" />
                  {fieldErrors.adminLastName ? <span id="setup-admin-last-name-error" className={styles.fieldError}>{fieldErrors.adminLastName}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-admin-email">Admin email</label>
                  <input id="setup-admin-email" name="adminEmail" type="email" value={adminEmail} onChange={(event) => { setAdminEmail(event.target.value); clearFieldError('adminEmail'); }} placeholder="admin@example.com" disabled={disabled} required aria-invalid={Boolean(fieldErrors.adminEmail)} aria-describedby="setup-admin-email-help setup-admin-email-error" />
                  <span id="setup-admin-email-help" className={styles.helpText}>Use this email to sign in after setup completes.</span>
                  {fieldErrors.adminEmail ? <span id="setup-admin-email-error" className={styles.fieldError}>{fieldErrors.adminEmail}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-admin-password">Admin password</label>
                  <input id="setup-admin-password" name="adminPassword" type="password" value={adminPassword} onChange={(event) => { setAdminPassword(event.target.value); clearFieldError('adminPassword'); clearFieldError('adminPasswordConfirm'); }} autoComplete="new-password" disabled={disabled} required aria-invalid={Boolean(fieldErrors.adminPassword)} aria-describedby="setup-admin-password-help setup-admin-password-error" />
                  <span id="setup-admin-password-help" className={styles.helpText}>At least 8 characters with uppercase, lowercase, number, and special character.</span>
                  {fieldErrors.adminPassword ? <span id="setup-admin-password-error" className={styles.fieldError}>{fieldErrors.adminPassword}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-admin-password-confirm">Confirm admin password</label>
                  <input id="setup-admin-password-confirm" name="adminPasswordConfirm" type="password" value={adminPasswordConfirm} onChange={(event) => { setAdminPasswordConfirm(event.target.value); clearFieldError('adminPasswordConfirm'); }} autoComplete="new-password" disabled={disabled} required aria-invalid={Boolean(fieldErrors.adminPasswordConfirm)} aria-describedby="setup-admin-password-confirm-error" />
                  {fieldErrors.adminPasswordConfirm ? <span id="setup-admin-password-confirm-error" className={styles.fieldError}>{fieldErrors.adminPasswordConfirm}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-app-hostname">App URL</label>
                  <input id="setup-app-hostname" name="appHostname" value={appHostname} onChange={(event) => { setAppHostname(event.target.value); clearFieldError('appHostname'); }} placeholder="http://192.168.1.50:3000" disabled={disabled} aria-invalid={Boolean(fieldErrors.appHostname)} aria-describedby="setup-app-hostname-help setup-app-hostname-error" />
                  <span id="setup-app-hostname-help" className={styles.helpText}>Use the full URL users will enter in their browser. The default local URL works out of the box.</span>
                  {fieldErrors.appHostname ? <span id="setup-app-hostname-error" className={styles.fieldError}>{fieldErrors.appHostname}</span> : null}
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-dns-mode">DNS mode</label>
                  <select id="setup-dns-mode" name="dnsMode" value={dnsMode} onChange={(event) => { setDnsMode(event.target.value); clearFieldError('dnsServers'); }} disabled={disabled}>
                    <option value="system">Use DHCP/system resolvers</option>
                    <option value="custom">Use custom DNS servers</option>
                  </select>
                  <span className={styles.helpText}>Keep system DNS unless this site requires specific internal resolvers.</span>
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-dns-servers">Custom DNS servers</label>
                  <input id="setup-dns-servers" name="dnsServers" value={dnsServers} onChange={(event) => { setDnsServers(event.target.value); clearFieldError('dnsServers'); }} placeholder="8.8.8.8,8.8.4.4" disabled={disabled || dnsMode !== 'custom'} aria-invalid={Boolean(fieldErrors.dnsServers)} aria-describedby="setup-dns-servers-help setup-dns-servers-error" />
                  <span id="setup-dns-servers-help" className={styles.helpText}>Comma-separated IPv4 addresses. Required only for custom DNS.</span>
                  {fieldErrors.dnsServers ? <span id="setup-dns-servers-error" className={styles.fieldError}>{fieldErrors.dnsServers}</span> : null}
                </div>

                <details className={styles.advancedSupport}>
                  <summary className={styles.advancedSummary}>Advanced</summary>
                  <p className={styles.helpText}>Optional: pin a specific release instead of following the channel. Support/testing only.</p>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label htmlFor="setup-release-ref">Release pin</label>
                      <input id="setup-release-ref" name="releaseRef" value={releaseRef} onChange={(event) => { setReleaseRef(event.target.value); clearFieldError('releaseRef'); }} placeholder="e.g. 1.0.3 or sha256:..." disabled={disabled} aria-invalid={Boolean(fieldErrors.releaseRef)} aria-describedby="setup-release-ref-help setup-release-ref-error" />
                      <span id="setup-release-ref-help" className={styles.helpText}>Leave blank to use the selected release channel.</span>
                      {fieldErrors.releaseRef ? <span id="setup-release-ref-error" className={styles.fieldError}>{fieldErrors.releaseRef}</span> : null}
                    </div>
                  </div>
                </details>
              </div>

              {error ? <div className={styles.alert} role="alert">{error}</div> : null}

              <div className={styles.formFooter}>
                <a className={`${styles.actionButton} ${styles.secondary}`} href={withToken('/', query)}>View status</a>
                <button id="setup-submit" className={styles.primaryButton} type="submit" disabled={busy || !config}>{busy ? 'Starting setup…' : 'Save and continue'}</button>
              </div>
            </form>
          </article>
        </section>
      </section>
    </main>
  );
}
