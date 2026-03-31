import type { TrialConfig } from './types';

export function getTrialConfig(): TrialConfig {
  return {
    baseDomain: process.env.TRIAL_BASE_DOMAIN || 'trials.alga-psa.com',
    helmChartPath: process.env.TRIAL_HELM_CHART_PATH || '../helm',
    serverImage: process.env.TRIAL_SERVER_IMAGE || 'ghcr.io/nine-minds/alga-psa-ce',
    serverImageTag: process.env.TRIAL_SERVER_IMAGE_TAG || 'latest',
    setupImage: process.env.TRIAL_SETUP_IMAGE || 'ghcr.io/nine-minds/alga-psa-ce',
    setupImageTag: process.env.TRIAL_SETUP_IMAGE_TAG || 'latest',
    trialDurationHours: parseInt(process.env.TRIAL_DURATION_HOURS || '72', 10),
    kubeContext: process.env.TRIAL_KUBE_CONTEXT || undefined,
    storageClass: process.env.TRIAL_STORAGE_CLASS || 'local-path',
    istioEnabled: process.env.TRIAL_ISTIO_ENABLED === 'true',
  };
}
