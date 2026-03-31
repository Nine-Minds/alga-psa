# Alga PSA Trial Deployment

A self-service web app that spins up isolated Alga PSA trial instances on demand using Kubernetes and Helm.

## How it works

1. A user fills in the trial request form (name, email, optional company)
2. The app creates an isolated Kubernetes namespace (`trial-<id>`)
3. Secrets are generated and injected
4. The main Alga PSA Helm chart is deployed into that namespace
5. Database migrations and seeds run automatically
6. Once ready, the user sees their instance URL and login credentials
7. The trial auto-expires after 72 hours (configurable)

## Prerequisites

- Kubernetes cluster with Helm 3 installed
- The `helm` CLI available on the machine/container running this app
- RBAC permissions to create namespaces, deployments, secrets, etc.
- A wildcard DNS record pointing `*.trials.alga-psa.com` to your cluster ingress
- (Optional) Istio for automatic ingress routing

## Local Development

```bash
cd trial-deployment
cp .env.example .env.local   # Edit values for your cluster
npm install
npm run dev
```

Open http://localhost:3000 to see the trial request form.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Description | Default |
|---|---|---|
| `TRIAL_BASE_DOMAIN` | Base domain for trial subdomains | `trials.alga-psa.com` |
| `TRIAL_HELM_CHART_PATH` | Path to Alga PSA Helm chart | `../helm` |
| `TRIAL_SERVER_IMAGE` | Docker image for Alga PSA | `ghcr.io/nine-minds/alga-psa-ce` |
| `TRIAL_SERVER_IMAGE_TAG` | Image tag | `latest` |
| `TRIAL_SETUP_IMAGE` | Bootstrap/setup image | `ghcr.io/nine-minds/alga-psa-ce` |
| `TRIAL_SETUP_IMAGE_TAG` | Setup image tag | `latest` |
| `TRIAL_DURATION_HOURS` | Trial lifetime in hours | `72` |
| `TRIAL_KUBE_CONTEXT` | Kubernetes context (empty = current) | — |
| `TRIAL_STORAGE_CLASS` | K8s storage class for PVCs | `local-path` |
| `TRIAL_ISTIO_ENABLED` | Enable Istio virtual service routing | `false` |

## Production Deployment

### Build the Docker image

```bash
docker build -t ghcr.io/nine-minds/alga-psa-trial:latest .
docker push ghcr.io/nine-minds/alga-psa-trial:latest
```

### Deploy to Kubernetes

```bash
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/deployment.yaml
```

The app runs in the `trial-system` namespace with a `trial-deployer` service account that has the necessary RBAC permissions to create trial namespaces and manage resources within them.

### DNS Setup

Configure a wildcard DNS record:
```
*.trials.alga-psa.com → <your-cluster-ingress-ip>
```

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/trials` | Create a new trial. Body: `{ name, email, company? }` |
| `GET` | `/api/trials/:id` | Get trial status, URL, and credentials |
| `DELETE` | `/api/trials/:id` | Manually destroy a trial |
| `GET` | `/api/trials` | List all trials (admin) |

## Architecture

```
trial-deployment/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Trial request form
│   │   ├── trial/[id]/page.tsx   # Status + credentials page
│   │   └── api/trials/           # REST API
│   └── lib/
│       ├── config.ts             # Environment config
│       ├── helm.ts               # Helm CLI wrapper
│       ├── k8s.ts                # Kubernetes API client
│       ├── secrets.ts            # Secret generation
│       ├── trial-manager.ts      # Orchestration logic
│       ├── trial-store.ts        # In-memory state store
│       └── types.ts              # TypeScript types
├── k8s/
│   ├── rbac.yaml                 # ServiceAccount + ClusterRole
│   └── deployment.yaml           # App deployment manifest
├── Dockerfile
└── .env.example
```
