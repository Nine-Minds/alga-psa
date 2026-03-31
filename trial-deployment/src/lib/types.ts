export type TrialStatus =
  | 'pending'
  | 'provisioning_namespace'
  | 'creating_secrets'
  | 'deploying_helm'
  | 'waiting_for_pods'
  | 'running_migrations'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'destroying';

export interface TrialRequest {
  email: string;
  name: string;
  company?: string;
}

export interface TrialCredentials {
  email: string;
  password: string;
}

export interface TrialInstance {
  id: string;
  request: TrialRequest;
  status: TrialStatus;
  statusMessage: string;
  url: string | null;
  credentials: TrialCredentials | null;
  namespace: string;
  releaseName: string;
  createdAt: string;
  expiresAt: string;
  error: string | null;
}

export interface TrialConfig {
  /** Base domain for trial instances, e.g. "trials.alga-psa.com" */
  baseDomain: string;
  /** Helm chart path relative to repo root */
  helmChartPath: string;
  /** Docker image for the server */
  serverImage: string;
  /** Docker image tag */
  serverImageTag: string;
  /** Setup/bootstrap image */
  setupImage: string;
  /** Setup image tag */
  setupImageTag: string;
  /** Trial duration in hours */
  trialDurationHours: number;
  /** Kubernetes context to use (optional, uses current if not set) */
  kubeContext?: string;
  /** Storage class for PVCs */
  storageClass: string;
  /** Whether Istio is enabled in the cluster */
  istioEnabled: boolean;
}
