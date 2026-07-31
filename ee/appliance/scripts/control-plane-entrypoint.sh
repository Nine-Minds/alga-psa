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

# A control-plane channel update can repair storage without replacing the
# ISO-baked host scripts. Reconcile in the background only when the historical
# k3s controller is still present or the appliance controller is unavailable;
# the setup/update workflows run the same locked installer synchronously before
# asking Flux to create or converge PVC-backed workloads.
(
  sleep "${ALGA_APPLIANCE_STORAGE_REPAIR_DELAY_SECONDS:-5}"
  if kubectl --kubeconfig "$KUBECONFIG_PATH" -n kube-system get deployment local-path-provisioner >/dev/null 2>&1 \
    || ! kubectl --kubeconfig "$KUBECONFIG_PATH" -n local-path-storage rollout status deployment/local-path-provisioner --timeout=5s >/dev/null 2>&1; then
    /opt/alga-appliance/scripts/install-storage.sh --kubeconfig "$KUBECONFIG_PATH"
  fi
) >> /var/lib/alga-appliance/storage-reconcile.log 2>&1 &

exec node /opt/alga-appliance/host-service/server.mjs
