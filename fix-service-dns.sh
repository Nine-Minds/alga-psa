#!/bin/bash
# Fix service DNS namespace references in all Helm templates

echo "Fixing service DNS namespace references..."

# Find all files with service DNS references
find helm/templates -name "*.yaml" -type f ! -name "*.bak" -exec grep -l "\.{{ \.Values\.namespace }}\.svc\.cluster\.local" {} + | while read file; do
  echo "Fixing service DNS in $file"
  sed -i.bak 's/\.{{ \.Values\.namespace }}\.svc\.cluster\.local/.{{ include "sebastian.namespace" . }}.svc.cluster.local/g' "$file"
done

echo "All service DNS namespace references updated!"