'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import type { TrialInstance } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Initialising...',
  provisioning_namespace: 'Creating isolated environment...',
  creating_secrets: 'Generating secure credentials...',
  deploying_helm: 'Deploying Alga PSA services...',
  waiting_for_pods: 'Starting application...',
  running_migrations: 'Setting up database...',
  ready: 'Your trial is ready!',
  failed: 'Deployment failed',
  expired: 'Trial expired',
  destroying: 'Cleaning up...',
};

const PROGRESS_STEPS = [
  'provisioning_namespace',
  'creating_secrets',
  'deploying_helm',
  'running_migrations',
  'waiting_for_pods',
  'ready',
];

export default function TrialStatusPage() {
  const params = useParams();
  const id = params.id as string;
  const [trial, setTrial] = useState<TrialInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/trials/${id}`);
      if (!res.ok) throw new Error('Trial not found');
      const data = await res.json();
      setTrial(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trial');
    }
  }, [id]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-red-50 text-red-700 rounded-xl px-6 py-4 max-w-md w-full text-center">
          <h2 className="font-semibold text-lg mb-1">Error</h2>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!trial) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </main>
    );
  }

  const currentStepIndex = PROGRESS_STEPS.indexOf(trial.status);
  const isInProgress = !['ready', 'failed', 'expired', 'destroying'].includes(trial.status);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">
            {trial.status === 'ready' ? 'Your Trial is Ready!' : 'Setting Up Your Trial'}
          </h1>
          <p className="text-gray-500 text-sm">
            Trial ID: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{id}</code>
          </p>
        </div>

        {/* Progress bar */}
        {isInProgress && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <div className="space-y-4">
              {PROGRESS_STEPS.map((step, i) => {
                const isActive = step === trial.status;
                const isDone = currentStepIndex > i;
                return (
                  <div key={step} className="flex items-center gap-3">
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0
                      ${isDone ? 'bg-green-100 text-green-700' : ''}
                      ${isActive ? 'bg-indigo-100 text-indigo-700' : ''}
                      ${!isDone && !isActive ? 'bg-gray-100 text-gray-400' : ''}
                    `}>
                      {isDone ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span className={`text-sm ${isActive ? 'text-gray-900 font-medium' : isDone ? 'text-gray-500' : 'text-gray-400'}`}>
                      {STATUS_LABELS[step] || step}
                    </span>
                    {isActive && (
                      <div className="ml-auto">
                        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ready state — show credentials */}
        {trial.status === 'ready' && trial.url && trial.credentials && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-green-800 mb-4">Your Alga PSA Instance</h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-green-700 mb-1">Instance URL</label>
                  <div className="flex items-center gap-2">
                    <a
                      href={trial.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-sm underline break-all"
                    >
                      {trial.url}
                    </a>
                    <button
                      onClick={() => copyToClipboard(trial.url!, 'url')}
                      className="text-xs bg-white border border-green-300 rounded px-2 py-1 hover:bg-green-50 shrink-0 cursor-pointer"
                    >
                      {copied === 'url' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-green-700 mb-1">Login Email</label>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-white px-3 py-1.5 rounded border border-green-200 break-all">
                      {trial.credentials.email}
                    </code>
                    <button
                      onClick={() => copyToClipboard(trial.credentials!.email, 'email')}
                      className="text-xs bg-white border border-green-300 rounded px-2 py-1 hover:bg-green-50 shrink-0 cursor-pointer"
                    >
                      {copied === 'email' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-green-700 mb-1">Password</label>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-white px-3 py-1.5 rounded border border-green-200 break-all">
                      {trial.credentials.password}
                    </code>
                    <button
                      onClick={() => copyToClipboard(trial.credentials!.password, 'password')}
                      className="text-xs bg-white border border-green-300 rounded px-2 py-1 hover:bg-green-50 shrink-0 cursor-pointer"
                    >
                      {copied === 'password' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm text-amber-800">
                <strong>Note:</strong> This trial expires on{' '}
                <time dateTime={trial.expiresAt}>
                  {new Date(trial.expiresAt).toLocaleString()}
                </time>
                . All data will be deleted after expiry.
              </p>
            </div>

            <a
              href={trial.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg px-4 py-3 text-sm text-center transition-colors"
            >
              Open Alga PSA
            </a>
          </div>
        )}

        {/* Failed state */}
        {trial.status === 'failed' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Deployment Failed</h2>
            <p className="text-sm text-red-700 mb-4">{trial.error || 'An unexpected error occurred during setup.'}</p>
            <a
              href="/"
              className="inline-block bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Try Again
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
