# Release runtime readback

The read-only collector requires an explicit target JSON:

```json
{"context":"dedicated-release-smoke","namespace":"release-smoke","workloads":[{"kind":"Deployment","name":"server"},{"kind":"Deployment","name":"email-service"}]}
```

Run only after selecting the intended target and completing the smoke for its exact immutable manifest:

```sh
node scripts/collect-kubernetes-release.mjs target.json observations.json
node scripts/verify-release-promotion.mjs policy.json manifest.json test-evidence.json observations.json promotion.json
```

The consumer-owned policy supplies revision, edition, requiredComponents and requiredChecks. Component names match renderedReleaseComponents: namespace/kind/workload/containers-or-initContainers/container. Compare that independent rendered release inventory with the collector target; omitting a required workload must fail promotion. The collector queries only the named live workloads and Pods/ReplicaSets in the explicit context/namespace. It emits image observations plus a metadata sidecar; it never deploys or changes Kubernetes objects. It clears stale observation output before a query, and failed collection must block subsequent promotion.

Ownership follows controller UID references, including Deployment → ReplicaSet → Pod. Regular containers must be running and ready; ordinary init containers must exit0; restartable init sidecars must be running and ready. Jobs require observed completion and successful terminated containers. Replica count must be positive and complete, controllers must have observed the current generation, and all observed replicas must agree on each image. Rollouts with extra/missing/terminating/mixed-image pods are rejected until stable.

Runtime identities come only from container status imageID. Supported identities are fully qualified repository@sha256 references, optionally prefixed docker-pullable://. Bare containerd/docker config IDs are intentionally unsupported until an adapter resolves their identity against the registry/runtime. Desired PodSpec image strings and status.image cannot substitute for imageID. Kubernetes documents imageID as runtime-reported and potentially different from the requested image: [Pod API](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/). Ownership semantics: [ReplicaSet API](https://kubernetes.io/docs/reference/kubernetes-api/apps/replica-set-v1/).

Supported workload snapshots: Deployment, StatefulSet, DaemonSet, ReplicaSet, Pod and completed Job. CronJobs, operator resources, ephemeral containers and zero-replica workloads need explicit policies/adapters and currently fail. Namespace inventory reads are not atomic across resource types; a racing rollout should be retried after the snapshot stabilizes. This is image identity/readiness evidence, not complete configuration parity or signed build provenance.

Host fixtures validate adapters and CLI inputs. No live Kubernetes collection, production promotion or target-specific imageID compatibility has yet been verified for this plan. Release pipeline wiring, observed runtime freshness policy and actual smoke evidence production remain open.
