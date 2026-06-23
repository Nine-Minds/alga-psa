# Talos Release Model (Superseded)

This page is retained as historical context for the removed Talos image/release workflow. The supported appliance path is Ubuntu/k3s with release metadata resolved from OCI artifacts.

The local release contract and local image-build/publish scripts no longer exist in `ee/appliance`. Current release metadata lives at:

```text
ghcr.io/nine-minds/alga-appliance-release:<version>
ghcr.io/nine-minds/alga-appliance-release:<channel>
```

The release manifest JSON is the OCI artifact config blob. It records application image tags, chart versions, Flux config-bundle digest, control-plane image ref, values profile, and profile values.

Release publishing is owned by the Argo workflow in:

```text
~/nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml
```

For stable channel publishing, use:

```text
promote-release=true
publish-appliance-release=true
appliance-release-channel=stable
```

Historical Talos schematic guidance can still inform future OS-image work, but it is not the active release process for customer appliances.
