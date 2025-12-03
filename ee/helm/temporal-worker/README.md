# Temporal Worker Helm Chart

This Helm chart deploys the Temporal Worker component for the Alga PSA application.

## Overview

The Temporal Worker is responsible for executing workflows and activities in the Alga PSA system. It connects to a Temporal server and processes tasks from specified task queues.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- Temporal server deployed and accessible
- PostgreSQL database
- (Optional) HashiCorp Vault for secret management

## Installation

### Standalone Installation

To install the chart with the release name `temporal-worker`:

```bash
helm install temporal-worker ee/helm/temporal-worker/
```

### As a Subchart

The temporal worker is included as an optional dependency in the main Alga PSA helm chart. To enable it:

```bash
helm install alga-psa helm/ --set temporal-worker.enabled=true
```

## Configuration

The following table lists the configurable parameters and their default values.

### Basic Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `enabled` | Enable/disable the temporal worker deployment | `true` |
| `replicaCount` | Number of worker replicas | `2` |
| `image.repository` | Container image repository | `harbor.nineminds.com/nineminds/temporal-worker` |
| `image.tag` | Container image tag | `latest` |
| `image.pullPolicy` | Image pull policy | `Always` |
| `logLevel` | Logging level (debug, info, warn, error) | `info` |

### Temporal Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `temporal.address` | Temporal frontend service address | `temporal-frontend.temporal.svc.cluster.local:7233` |
| `temporal.namespace` | Temporal namespace | `default` |
| `temporal.taskQueue` | Task queue name (comma-separated for multiple queues) | `tenant-workflows,portal-domain-workflows,email-domain-workflows` |
| `temporal.maxConcurrentActivityExecutions` | Max concurrent activities | `10` |
| `temporal.maxConcurrentWorkflowTaskExecutions` | Max concurrent workflow tasks | `10` |

### Database Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `db.host` | PostgreSQL host | `postgresql.default.svc.cluster.local` |
| `db.port` | PostgreSQL port | `5432` |
| `db.serverDatabase` | Database name | `msp_server` |
| `db.user` | Database user | `msp_server` |
| `db.serverPasswordSecret.name` | Secret name for DB password | `db-secrets` |
| `db.serverPasswordSecret.key` | Secret key for DB password | `server-password` |

### Secret Management

| Parameter | Description | Default |
|-----------|-------------|---------|
| `vault.enabled` | Enable Vault integration | `false` |
| `vault.role` | Vault role | `temporal-worker` |
| `vault.secretPath` | Vault secret path | `secret/data/alga-psa/temporal-worker` |
| `secrets.internalApiSharedSecret` | Shared secret for internal API (when Vault disabled) | `change-me-in-production` |
| `secrets.algaAuthKey` | Auth key (when Vault disabled) | `change-me-in-production` |

### Resources

| Parameter | Description | Default |
|-----------|-------------|---------|
| `resources.limits.cpu` | CPU limit | `1000m` |
| `resources.limits.memory` | Memory limit | `1Gi` |
| `resources.requests.cpu` | CPU request | `200m` |
| `resources.requests.memory` | Memory request | `512Mi` |

### Autoscaling

| Parameter | Description | Default |
|-----------|-------------|---------|
| `autoscaling.enabled` | Enable horizontal pod autoscaler | `true` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | Target memory utilization | `80` |

## Examples

### Basic Installation with Custom Values

```bash
cat <<EOF > my-values.yaml
replicaCount: 3

temporal:
  address: my-temporal.example.com:7233
  taskQueue: my-task-queue

db:
  host: my-postgres.example.com
  serverPasswordSecret:
    name: my-db-secrets
    key: password

resources:
  requests:
    cpu: 500m
    memory: 1Gi
EOF

helm install temporal-worker ee/helm/temporal-worker/ -f my-values.yaml
```

### Production Configuration with Vault

```bash
cat <<EOF > prod-values.yaml
replicaCount: 5

vault:
  enabled: true
  role: temporal-worker-prod
  secretPath: secret/data/prod/temporal-worker

resources:
  limits:
    cpu: 2000m
    memory: 4Gi
  requests:
    cpu: 1000m
    memory: 2Gi

autoscaling:
  enabled: true
  minReplicas: 5
  maxReplicas: 20
  targetCPUUtilizationPercentage: 60

podDisruptionBudget:
  enabled: true
  minAvailable: 2
EOF

helm install temporal-worker ee/helm/temporal-worker/ -f prod-values.yaml
```

### Integration with Main Chart

```bash
cat <<EOF > alga-values.yaml
temporal-worker:
  enabled: true
  replicaCount: 3
  db:
    host: postgresql.default.svc.cluster.local
    serverPasswordSecret:
      name: alga-psa-db-secrets
      key: server-password
  applicationUrl: https://app.algapsa.com
EOF

helm install alga-psa helm/ -f alga-values.yaml
```

## Upgrading

To upgrade an existing release:

```bash
helm upgrade temporal-worker ee/helm/temporal-worker/
```

## Uninstalling

To uninstall/delete the release:

```bash
helm uninstall temporal-worker
```

## Troubleshooting

### Check Worker Status

```bash
kubectl get pods -l app.kubernetes.io/name=temporal-worker
kubectl logs -l app.kubernetes.io/name=temporal-worker
```

### Verify Configuration

```bash
kubectl describe configmap <release-name>-temporal-worker
```

### Common Issues

1. **Worker not connecting to Temporal**: Check the `temporal.address` configuration and ensure the Temporal frontend is accessible.

2. **Database connection errors**: Verify database credentials and connectivity. Check that the secrets are properly created.

3. **High memory usage**: Adjust `temporal.maxConcurrentActivityExecutions` and resource limits based on workload.

## Development

For local development and testing:

```bash
# Render templates locally
helm template temporal-worker ee/helm/temporal-worker/

# Dry run installation
helm install temporal-worker ee/helm/temporal-worker/ --dry-run --debug

# Lint the chart
helm lint ee/helm/temporal-worker/
```

## Support

For issues and questions, please refer to the main Alga PSA documentation or create an issue in the project repository.