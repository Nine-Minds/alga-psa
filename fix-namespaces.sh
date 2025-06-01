#!/bin/bash
# Fix namespace references in all Helm templates

files=(
  "helm/templates/deployment.yaml"
  "helm/templates/redis/service.yaml"
  "helm/templates/redis/pvc.yaml"
  "helm/templates/redis/statefulSet.yaml"
  "helm/templates/storage-secret.yaml"
  "helm/templates/hocuspocus/deployment.yaml"
  "helm/templates/hocuspocus/service.yaml"
  "helm/templates/storage-pvc.yaml"
  "helm/templates/service.yaml"
  "helm/templates/pvc-delete-hook.yaml"
  "helm/templates/postgres/service.yaml"
  "helm/templates/postgres/pvc.yaml"
  "helm/templates/postgres/statefulSet.yaml"
  "helm/templates/local-storage-pvc.yaml"
  "helm/templates/jobs.yaml"
)

for file in "${files[@]}"; do
  echo "Fixing namespace in $file"
  sed -i.bak 's/namespace: {{ \.Values\.namespace }}/namespace: {{ include "sebastian.namespace" . }}/g' "$file"
done

echo "All namespace references updated!"