#!/usr/bin/env sh
set -eu

KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/tmp/alga-appliance/kubeconfig}"
SA_DIR="/var/run/secrets/kubernetes.io/serviceaccount"
TOKEN_FILE="$SA_DIR/token"
CA_FILE="$SA_DIR/ca.crt"
NAMESPACE_FILE="$SA_DIR/namespace"

if [ -n "${KUBERNETES_SERVICE_HOST:-}" ] && [ -f "$TOKEN_FILE" ] && [ -f "$CA_FILE" ]; then
  mkdir -p "$(dirname "$KUBECONFIG_PATH")"
  NAMESPACE="default"
  if [ -f "$NAMESPACE_FILE" ]; then
    NAMESPACE="$(cat "$NAMESPACE_FILE")"
  fi
  cat > "$KUBECONFIG_PATH" <<EOF
apiVersion: v1
kind: Config
clusters:
- name: in-cluster
  cluster:
    certificate-authority: $CA_FILE
    server: https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT:-443}
contexts:
- name: appliance-control-plane
  context:
    cluster: in-cluster
    namespace: $NAMESPACE
    user: appliance-control-plane
current-context: appliance-control-plane
users:
- name: appliance-control-plane
  user:
    tokenFile: $TOKEN_FILE
EOF
  chmod 0600 "$KUBECONFIG_PATH"
  export ALGA_APPLIANCE_KUBECONFIG="$KUBECONFIG_PATH"
fi

exec node /opt/alga-appliance/host-service/server.mjs
