'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { getLicenseStatus, submitLicense, startTrial } from '@/lib/actions/licenseManagementActions';
import type { LicenseStatus } from '@/lib/actions/licenseManagementActions';

/**
 * In-app License management page.
 *
 * Gated by admin RBAC only — NOT by eeRuntimeEnabled — so an expired install
 * can always navigate here to renew or start a trial.
 */
export default function LicenseManagementPage() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getLicenseStatus().then((s) => { setStatus(s); setLoading(false); });
  }, []);

  function refresh(newStatus: LicenseStatus) {
    setStatus(newStatus);
    setError(null);
  }

  function handleSubmitLicense() {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await submitLicense(licenseKey.trim());
      if (result.success && result.status) {
        refresh(result.status);
        setLicenseKey('');
        setSuccessMsg('License activated successfully.');
      } else {
        setError(result.error ?? 'Failed to activate license');
      }
    });
  }

  function handleStartTrial() {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const result = await startTrial();
      if (result.success && result.status) {
        refresh(result.status);
        setSuccessMsg('30-day Enterprise trial started.');
      } else {
        setError(result.error ?? 'Failed to start trial');
      }
    });
  }

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading license status…</div>;
  }

  if (!status?.selfHostMode) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>License</h1>
        <p style={{ marginTop: '1rem', color: '#6b7280' }}>
          License management is only available for self-hosted installations.
        </p>
      </div>
    );
  }

  const stateLabelMap: Record<string, string> = {
    ce: 'Community Edition (Essentials)',
    trial: 'Enterprise Trial',
    trial_expired: 'Trial Expired — Essentials',
    licensed: 'Licensed',
    license_expired: 'License Expired — Essentials',
  };

  const stateLabel = status.state ? (stateLabelMap[status.state] ?? status.state) : 'Unknown';
  const canStartTrial = !status.trialUsed && status.state !== 'licensed';

  return (
    <div style={{ padding: '2rem', maxWidth: '640px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>License</h1>

      {/* Current status */}
      <section style={{ marginTop: '1.5rem', padding: '1.25rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
        <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Current Status</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', rowGap: '0.4rem' }}>
          <dt style={{ color: '#6b7280' }}>Status</dt>
          <dd><strong>{stateLabel}</strong></dd>
          {status.tier && (
            <>
              <dt style={{ color: '#6b7280' }}>Tier</dt>
              <dd style={{ textTransform: 'capitalize' }}>{status.tier}</dd>
            </>
          )}
          {status.customer && (
            <>
              <dt style={{ color: '#6b7280' }}>Licensed to</dt>
              <dd>{status.customer}</dd>
            </>
          )}
          {status.expiresAt && (
            <>
              <dt style={{ color: '#6b7280' }}>Expires</dt>
              <dd>
                {new Date(status.expiresAt).toLocaleDateString()}
                {status.daysRemaining !== null && (
                  <span style={{ marginLeft: '0.5rem', color: status.daysRemaining < 7 ? '#dc2626' : '#6b7280' }}>
                    ({status.daysRemaining} days remaining)
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Enter / renew license */}
      <section style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Enter License Key</h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Paste the signed license key provided by Nine Minds. The key takes effect immediately.
        </p>
        <textarea
          value={licenseKey}
          onChange={(e) => setLicenseKey(e.target.value)}
          rows={4}
          placeholder="eyJhbGci…"
          style={{
            width: '100%', fontFamily: 'monospace', fontSize: '0.8rem',
            padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem',
            resize: 'vertical',
          }}
        />
        <button
          onClick={handleSubmitLicense}
          disabled={isPending || !licenseKey.trim()}
          style={{
            marginTop: '0.5rem', padding: '0.5rem 1rem', background: '#2563eb',
            color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer',
            opacity: isPending || !licenseKey.trim() ? 0.5 : 1,
          }}
        >
          {isPending ? 'Activating…' : 'Activate License'}
        </button>
      </section>

      {/* Start trial */}
      {canStartTrial && (
        <section style={{ marginTop: '1.5rem', padding: '1rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '0.5rem' }}>
          <h2 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>30-Day Enterprise Trial</h2>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
            Try all Enterprise features free for 30 days. No credit card required.
            This trial is available once per installation.
          </p>
          <button
            onClick={handleStartTrial}
            disabled={isPending}
            style={{
              padding: '0.5rem 1rem', background: '#0ea5e9', color: '#fff',
              border: 'none', borderRadius: '0.375rem', cursor: 'pointer',
              opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? 'Starting…' : 'Start 30-Day Trial'}
          </button>
        </section>
      )}

      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', color: '#16a34a' }}>
          {successMsg}
        </div>
      )}
    </div>
  );
}
