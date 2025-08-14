# S3 Deployment

## Background

We have a storage provider abstraction that is used to abstract away how we handle file storage for the document system, etc. It has a factory that is used to properly instantiate the correct class, specified via configuration, etc.

Alga PSA base folder: alga-psa.worktrees/s3-fileprovider-deployment
NM Kube Config base folder: nm-kube-config/

s3: server/src/empty/lib/storage/providers/S3StorageProvider.ts
file: server/src/lib/storage/providers/LocalStorageProvider.ts

base provider: server/src/lib/storage/providers/StorageProvider.ts
configuration info: server/src/config/storage.ts

## Task at hand
 - Ensure file system configuration can happen via env vars
 - Ensure that we can specify the s3 provider
 - Ensure that s3 provider can be configured for our helm chart (located at helm/)
    - Ensure that the hosted.values.yaml configuration has a configuration for s3
        - nm-kube-config/alga-psa/hosted.values.yaml
    - Ensure that the deployment for the "server" pod in helm/ *can be* configured with s3 configuration details
    - Ensure that minio secrets can be specified in the hosted.values.yaml and be used via the deployment configuration
 - Make any necessary updates to the storage abstraction that might be required to use s3 as a provider, if you find it to be deficient.

 ## Coding standards
 docs/AI_coding_standards.md