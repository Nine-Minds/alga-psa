#!/usr/bin/env bash
# Publish the appliance release artifacts to an OCI registry (ghcr by default).
#
# Produces, for one release/channel (see ee/appliance/docs/registry-metadata-design.md):
#   1. the 6 helm charts   -> oci://<CHARTS_REPO>/<name>:<version>      (helm push)
#   2. the flux config bundle -> oci://<CONFIG_REPO>:<version>          (flux push artifact)
#   3. the release manifest   -> oci://<RELEASE_REPO>:<version> + :<channel>  (oras push)
#
# Requirements on PATH: helm, flux, oras, python3, git.
# Auth: either already-logged-in (`helm/oras registry login ghcr.io`), or set
#   ALGA_GHCR_TOKEN (and ALGA_GHCR_USER) and this script logs in for you.
#
# Env overrides:
#   RELEASE_VERSION (default 1.0)   CHANNEL (default stable)   PROFILE (default single-node)
#   REGISTRY_HOST (default ghcr.io) REGISTRY_NAMESPACE (default nine-minds)
#   CONTROL_PLANE_TAG (optional; the control-plane image tag for bootstrap-pull)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RELEASE_VERSION="${RELEASE_VERSION:-1.0}"
CHANNEL="${CHANNEL:-stable}"
PROFILE="${PROFILE:-single-node}"
REGISTRY_HOST="${REGISTRY_HOST:-ghcr.io}"
REGISTRY_NAMESPACE="${REGISTRY_NAMESPACE:-nine-minds}"
CONTROL_PLANE_TAG="${CONTROL_PLANE_TAG:-}"

CHARTS_REPO="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/charts"
CONFIG_REPO="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/alga-appliance-config"
RELEASE_REPO="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/alga-appliance-release"
RELEASE_MEDIA_TYPE="application/vnd.alga.appliance.release.config.v1+json"
RELEASE_ARTIFACT_TYPE="application/vnd.alga.appliance.release.v1"

for tool in helm flux oras python3 git; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

if [ -n "${ALGA_GHCR_TOKEN:-}" ]; then
  echo "==> logging in to ${REGISTRY_HOST} as ${ALGA_GHCR_USER:-token}"
  printf '%s' "$ALGA_GHCR_TOKEN" | helm registry login "$REGISTRY_HOST" -u "${ALGA_GHCR_USER:-token}" --password-stdin
  printf '%s' "$ALGA_GHCR_TOKEN" | oras login "$REGISTRY_HOST" -u "${ALGA_GHCR_USER:-token}" --password-stdin
fi

WORK="$(mktemp -d -t alga-publish-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 1/3 packaging + pushing charts to oci://${CHARTS_REPO}"
# chart dir -> chart name (version comes from each Chart.yaml)
chart_dirs=(helm ee/helm/pgbouncer ee/helm/temporal ee/helm/temporal-worker ee/helm/workflow-worker ee/helm/email-service)
for dir in "${chart_dirs[@]}"; do
  helm package "${REPO_ROOT}/${dir}" -d "${WORK}/charts" >/dev/null
done
for tgz in "${WORK}"/charts/*.tgz; do
  echo "    push $(basename "$tgz")"
  helm push "$tgz" "oci://${CHARTS_REPO}" 2>&1 | sed 's/^/      /'
done

echo "==> 2/3 pushing flux config bundle to oci://${CONFIG_REPO}:${RELEASE_VERSION}"
SOURCE_URL="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || echo 'unknown')"
REVISION="${RELEASE_VERSION}@sha1:$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
flux push artifact "oci://${CONFIG_REPO}:${RELEASE_VERSION}" \
  --path="${REPO_ROOT}/ee/appliance/flux" \
  --source="${SOURCE_URL}" \
  --revision="${REVISION}"
CONFIG_DIGEST="$(oras manifest fetch "${CONFIG_REPO}:${RELEASE_VERSION}" --descriptor \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"])')"
echo "    config bundle digest: ${CONFIG_DIGEST}"

echo "==> 2.5 control-plane image"
# The Kubernetes-hosted control plane (setup UI + host-service). Publishing it to
# ghcr lets the appliance roll to it from a channel (no ISO re-burn). CONTROL_PLANE_TAG
# (a pre-pushed ref) wins; otherwise push the local CONTROL_PLANE_IMAGE if present.
CONTROL_PLANE_IMAGE="${CONTROL_PLANE_IMAGE:-localhost/alga-appliance-control-plane:baked}"
CONTROL_PLANE_REF="${CONTROL_PLANE_TAG:-}"
CONTROL_PLANE_REPO="${REGISTRY_HOST}/${REGISTRY_NAMESPACE}/alga-appliance-control-plane"
if [ -z "$CONTROL_PLANE_REF" ] && [ "${SKIP_CONTROL_PLANE:-}" != "1" ]; then
  if command -v docker >/dev/null 2>&1 && docker image inspect "$CONTROL_PLANE_IMAGE" >/dev/null 2>&1; then
    if [ -n "${ALGA_GHCR_TOKEN:-}" ]; then
      printf '%s' "$ALGA_GHCR_TOKEN" | docker login "$REGISTRY_HOST" -u "${ALGA_GHCR_USER:-token}" --password-stdin >/dev/null
    fi
    echo "    push ${CONTROL_PLANE_IMAGE} -> ${CONTROL_PLANE_REPO}:${RELEASE_VERSION}"
    docker tag "$CONTROL_PLANE_IMAGE" "${CONTROL_PLANE_REPO}:${RELEASE_VERSION}"
    docker push "${CONTROL_PLANE_REPO}:${RELEASE_VERSION}" | sed 's/^/      /'
    CP_DIGEST="$(docker image inspect "${CONTROL_PLANE_REPO}:${RELEASE_VERSION}" \
      --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null \
      | grep "/alga-appliance-control-plane@" | head -n1 | sed 's/.*@//')"
    if [ -n "$CP_DIGEST" ]; then
      CONTROL_PLANE_REF="${CONTROL_PLANE_REPO}@${CP_DIGEST}"
    else
      CONTROL_PLANE_REF="${CONTROL_PLANE_REPO}:${RELEASE_VERSION}"
    fi
    echo "    control-plane ref: ${CONTROL_PLANE_REF}"
  else
    echo "    no local ${CONTROL_PLANE_IMAGE} and no CONTROL_PLANE_TAG; manifest controlPlane will be empty"
  fi
fi

echo "==> 3/3 building + pushing release manifest to oci://${RELEASE_REPO}:{${RELEASE_VERSION},${CHANNEL}}"
MANIFEST="${WORK}/release-manifest.json"
python3 "${REPO_ROOT}/ee/appliance/scripts/build-release-manifest.py" \
  --repo-root "${REPO_ROOT}" \
  --release-version "${RELEASE_VERSION}" \
  --channel "${CHANNEL}" \
  --profile "${PROFILE}" \
  --config-repository "${CONFIG_REPO}" \
  --config-digest "${CONFIG_DIGEST}" \
  --control-plane "${CONTROL_PLANE_REF}" > "${MANIFEST}"

# The manifest JSON is the artifact's config blob (the consume side reads
# config.digest); also attach it as a layer so the artifact is well-formed.
( cd "${WORK}" && oras push "${RELEASE_REPO}:${RELEASE_VERSION}" \
    --config "${MANIFEST}:${RELEASE_MEDIA_TYPE}" \
    --artifact-type "${RELEASE_ARTIFACT_TYPE}" \
    "release-manifest.json:${RELEASE_MEDIA_TYPE}" )
oras tag "${RELEASE_REPO}:${RELEASE_VERSION}" "${CHANNEL}"

echo "==> done."
echo "    charts:   oci://${CHARTS_REPO}/{sebastian,pgbouncer,temporal,temporal-worker,workflow-worker,email-service}"
echo "    bundle:   oci://${CONFIG_REPO}:${RELEASE_VERSION} (${CONFIG_DIGEST})"
echo "    ctrlplane:${CONTROL_PLANE_REF:-<none>}"
echo "    release:  oci://${RELEASE_REPO}:${RELEASE_VERSION} (channel tag: ${CHANNEL})"
