# SCRATCHPAD: Tiered Appliance Bootstrap Status

## Context

Plan created after a local UTM/Talos appliance bootstrap on the `feature/on-premise-email-processing` worktree exposed major bootstrap UX and reliability problems.

## Decisions

- Use approach C from brainstorming: status plane + tiered readiness + chart segmentation.
- Define `LOGIN_READY` as core business ready, not fully healthy.
- `LOGIN_READY` requires DB/bootstrap/web app/PgBouncer/Redis readiness but not email-service, Temporal, workflow-worker, temporal-worker, or optional integrations.
- Add a token-protected early status UI on `http://<node-ip>:8080`.
- Bootstrap should print the generated token so the admin has easy access without making diagnostics open on the LAN.
- First implementation should be hybrid: a small web service reads Kubernetes directly, but the status schema should be stable enough for a future controller/CRD.

## Observed Bootstrap Timeline and Findings

Environment:

- UTM VM: `Talos-Appliance`
- Node IP: `192.168.64.8`
- Talos: `v1.12.0`
- Kubernetes: `v1.31.4`
- Appliance release: `1.0-rc5`
- Repo branch used by Flux: `release/1.0-rc5`

What took time or failed:

1. Talos install initially blocked pulling `factory.talos.dev/metal-installer/...` because DNS lookup through `192.168.64.1:53` was refused.
2. Rerunning bootstrap with `--dns-servers 1.1.1.1,8.8.8.8` allowed Talos/Kubernetes to come up.
3. `ee/appliance/appliance bootstrap` generated Talos config and bootstrapped Kubernetes successfully, but fresh reset failed with `reset-appliance-data.sh: line 167: target: unbound variable`.
4. The operator wrapper later ignored or mishandled explicit kubeconfig/talosconfig reuse and overwrote the local Talos config, breaking `talosctl` auth while Kubernetes remained usable.
5. Script-level `ee/appliance/scripts/bootstrap-appliance.sh --bootstrap-mode recover --kubeconfig ...` continued the app install.
6. `alga-core` image pull took around 16 minutes for `ghcr.io/nine-minds/alga-psa-ee:94446747`.
7. `db-0` was stuck in `CreateContainerConfigError` with `failed to create subPath directory for volumeMount "db-data"`.
8. Manually creating `/mnt/data` in the Postgres PVC and deleting `db-0` fixed Postgres.
9. The first alga-core bootstrap job timed out waiting for Postgres; forcing a HelmRelease reconcile created revision 2, which completed migrations/seeds.
10. Bootstrap proof point: querying the `server` database showed `users` count `7`.
11. Alga web app responded at `http://192.168.64.8:3000` with a redirect to `/msp/dashboard`.
12. Temporal deployment initially did not run autosetup, causing `sql schema version compatibility check failed`.
13. Patching Temporal command to `/etc/temporal/entrypoint.sh autosetup` allowed Temporal to initialize.
14. Temporal UI failed with `cannot unmarshal !!str tcp://... into int`; disabling service links fixed it.
15. `email-service:61e4a00e` exists but first pull was canceled; deleting the pod allowed retry and it became Ready.
16. `workflow-worker:61e4a00e` was missing from GHCR and remained `ImagePullBackOff`.
17. `temporal-worker:61e4a00e` was also missing from GHCR; `temporal-worker:latest` existed.

## Useful Commands from Investigation

Check maintenance-mode Talos disk access:

```bash
talosctl get disks --insecure -n 192.168.64.8 -e 192.168.64.8
```

Bootstrap with explicit DNS:

```bash
ee/appliance/appliance bootstrap --bootstrap-mode fresh \
  --release-version 1.0-rc5 \
  --node-ip 192.168.64.8 \
  --hostname appliance-single-node \
  --app-url http://192.168.64.8:3000 \
  --interface enp0s1 \
  --network-mode dhcp \
  --dns-servers 1.1.1.1,8.8.8.8 \
  --install-disk /dev/sda \
  --repo-url https://github.com/nine-minds/alga-psa \
  --repo-branch release/1.0-rc5
```

Continue app install with existing kubeconfig:

```bash
ee/appliance/scripts/bootstrap-appliance.sh --bootstrap-mode recover \
  --release-version 1.0-rc5 \
  --site-id appliance-single-node \
  --profile talos-single-node \
  --node-ip 192.168.64.8 \
  --hostname appliance-single-node \
  --app-url http://192.168.64.8:3000 \
  --dns-servers 1.1.1.1,8.8.8.8 \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  --repo-url https://github.com/nine-minds/alga-psa \
  --repo-branch release/1.0-rc5
```

Fix observed Postgres subPath issue manually:

```bash
cat <<'EOF' | kubectl --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: db-subpath-fix
  namespace: msp
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: fix
          image: busybox
          command: ["sh", "-c", "mkdir -p /mnt/data && chmod 700 /mnt/data && chown 999:999 /mnt/data || true && ls -la /mnt"]
          volumeMounts:
            - name: db-data
              mountPath: /mnt
      volumes:
        - name: db-data
          persistentVolumeClaim:
            claimName: alga-core-sebastian-postgres-data
EOF
```

Force alga-core reconcile after DB fix:

```bash
flux --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  -n alga-system reconcile helmrelease alga-core --reset --force --with-source --timeout=45m
```

Verify seeded users:

```bash
kubectl --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig -n msp exec db-0 -- \
  sh -c "PGPASSWORD=\$POSTGRES_PASSWORD psql -U postgres -d server -tAc 'select count(*) from users;'"
```

## Open Questions

- Should `appliance-status` be implemented in Node to match existing repo tooling, or Go for a tiny static binary?
- Should the status token use a bearer header, cookie-based login form, or both?
- Should status service use `hostNetwork: true`, NodePort, hostPort, or a lightweight local ingress path for port 8080?
- How much advanced diagnostics should be available in the first version versus deferred to support-bundle work?
- Should background services be installed by separate Flux Kustomizations immediately or should the first iteration only change readiness/status semantics?

## Next Implementation Planning Notes

Suggested implementation order:

1. Fix the immediate deterministic bugs from the observed run: reset helper, Talos config overwrite, Temporal autosetup/service links.
2. Add release image validation so missing background tags are detected before long waits.
3. Build shared status collector and blocker detector used by CLI.
4. Add early appliance-status chart/service.
5. Split Flux platform/core/background once status model is in place.
