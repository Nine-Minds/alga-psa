#!/usr/bin/env python3
"""Build an appliance release manifest (alga.appliance.release/v1) JSON.

The manifest is the channel pointer published as an OCI artifact's config blob
(see ee/appliance/docs/registry-metadata-design.md). It records the app image
tags, the chart versions, the flux config-bundle reference (repo + digest), the
control-plane image tag, and the per-service profile values (so the appliance
can render runtime values without fetching anything from git).

Image tags are read from ee/appliance/releases/<version>/release.json, chart
versions from each chart's Chart.yaml, and profile values from
ee/appliance/flux/profiles/<profile>/values/.
"""
import argparse
import glob
import json
import os
import re
import sys


def chart_version(chart_dir):
    chart_yaml = os.path.join(chart_dir, "Chart.yaml")
    for line in open(chart_yaml):
        m = re.match(r"^version:\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    raise SystemExit(f"no version found in {chart_yaml}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--release-version", required=True)
    ap.add_argument("--channel", default="stable")
    ap.add_argument("--profile", default="single-node")
    ap.add_argument("--config-repository", required=True,
                    help="OCI repo holding the flux config bundle, e.g. ghcr.io/nine-minds/alga-appliance-config")
    ap.add_argument("--config-digest", required=True, help="sha256:... digest of the pushed config bundle")
    ap.add_argument("--config-tag", default=None)
    ap.add_argument("--control-plane", default="", help="control-plane image tag (optional)")
    args = ap.parse_args()

    root = args.repo_root
    release_json = os.path.join(root, "ee/appliance/releases", args.release_version, "release.json")
    rj = json.load(open(release_json))
    images = (rj.get("app") or {}).get("images") or {}
    if not images.get("algaCore"):
        raise SystemExit(f"{release_json} has no app.images.algaCore")

    charts = {
        "sebastian": chart_version(os.path.join(root, "helm")),
        "pgbouncer": chart_version(os.path.join(root, "ee/helm/pgbouncer")),
        "temporal": chart_version(os.path.join(root, "ee/helm/temporal")),
        "temporal-worker": chart_version(os.path.join(root, "ee/helm/temporal-worker")),
        "workflow-worker": chart_version(os.path.join(root, "ee/helm/workflow-worker")),
        "email-service": chart_version(os.path.join(root, "ee/helm/email-service")),
    }

    values_dir = os.path.join(root, "ee/appliance/flux/profiles", args.profile, "values")
    profile_values = {}
    for f in sorted(glob.glob(os.path.join(values_dir, f"*.{args.profile}.yaml"))):
        profile_values[os.path.basename(f)] = open(f).read()
    if not profile_values:
        raise SystemExit(f"no profile values found in {values_dir}")

    manifest = {
        "schema": "alga.appliance.release/v1",
        "version": args.release_version,
        "channel": args.channel,
        "valuesProfile": args.profile,
        "images": images,
        "controlPlane": args.control_plane or None,
        "config": {
            "repository": args.config_repository,
            "tag": args.config_tag or args.release_version,
            "digest": args.config_digest,
        },
        "charts": charts,
        "profileValues": profile_values,
    }
    json.dump(manifest, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
