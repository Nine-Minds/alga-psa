#!/bin/sh
set -eu

PROFILE="talos-single-node"
PROFILE_DIR=""
KUBECONFIG_PATH="${KUBECONFIG:-}"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --profile-dir)
      PROFILE_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$PROFILE_DIR" ]; then
  PROFILE_DIR="$REPO_ROOT/ee/appliance/flux/profiles/$PROFILE"
fi

if [ ! -d "$PROFILE_DIR" ]; then
  echo "Flux profile not found: $PROFILE_DIR" >&2
  exit 1
fi

if [ -z "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig path is required via --kubeconfig or KUBECONFIG" >&2
  exit 1
fi

kubectl --kubeconfig "$KUBECONFIG_PATH" apply -k "$PROFILE_DIR"
