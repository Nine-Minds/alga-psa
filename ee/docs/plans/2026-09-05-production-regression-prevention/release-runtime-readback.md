# Release runtime readback

The read-only collector requires an explicit target JSON:

```json
{"context":"dedicated-release-smoke","namespace":"release-smoke","workloads":[{"kind":"Deployment","name":"server"},{"kind":"Deployment","name":"email-service"}]}
```

Run only after selecting the intended target and completing the smoke for its exact immutable manifest:

```sh
node scripts/collect-kubernetes-release.mjs target.json observations.json
node scripts/verify-release-promotion.mjs policy.json rendered-resources.json manifest.json test-evidence.json observations.json promotion.json
```

Each manifest component must include `name`, immutable `image`, a full 40-character
lowercase Git `revision`, and `build: {"provider":"github-actions","runId":123}`.
A build run ID may also be a nonempty provider-specific string. An optional
`build.attempt` must be a positive integer. Component revisions may differ when
explicitly recorded; the manifest digest binds every component's source and
build metadata. These fields identify the asserted build but do not authenticate
that assertion: release CI must produce them from its actual build records.

The consumer-owned policy supplies revision, edition, requiredComponents, requiredChecks, requiredCheckConfigurations, expectedTarget (the approved context/namespace/workload list), and a positive maxObservationAgeSeconds (for example 300). Component names match renderedReleaseComponents: namespace/kind/workload/containers-or-initContainers/container. The required rendered-resources.json input is the complete JSON resource array rendered by the release pipeline, including hooks and init containers. The verifier derives its inventory independently and compares it with policy, manifest images, target namespace and target workloads. Omitting a worker consistently from policy, manifest and observations still fails when that worker appears in the rendered release. Missing rendered input fails; the previous five-argument CLI is no longer supported.

The collector queries only the named live workloads and Pods/ReplicaSets in the explicit context/namespace. It emits a single versioned envelope containing image observations, target, and observedAt; it never deploys or changes Kubernetes objects. Promotion rejects mismatched target, stale/future timestamps and legacy bare observation arrays. observedAt is recorded before API reads, conservatively aging the earliest snapshot. It clears stale observation output before a query, and failed collection must block subsequent promotion.

Ownership follows controller UID references, including Deployment → ReplicaSet → Pod. Regular containers must be running and ready; ordinary init containers must exit0; restartable init sidecars must be running and ready. Jobs require observed completion and successful terminated containers. Replica count must be positive and complete, controllers must have observed the current generation, and all observed replicas must agree on each image. Rollouts with extra/missing/terminating/mixed-image pods are rejected until stable.

Runtime identities come only from container status imageID. Supported identities are fully qualified repository@sha256 references, optionally prefixed docker-pullable://. Bare containerd/docker config IDs are intentionally unsupported until an adapter resolves their identity against the registry/runtime. Desired PodSpec image strings and status.image cannot substitute for imageID. Kubernetes documents imageID as runtime-reported and potentially different from the requested image: [Pod API](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/). Ownership semantics: [ReplicaSet API](https://kubernetes.io/docs/reference/kubernetes-api/apps/replica-set-v1/).

Supported workload snapshots: Deployment, StatefulSet, DaemonSet, ReplicaSet, Pod and completed Job. CronJobs, operator resources, ephemeral containers and zero-replica workloads need explicit policies/adapters and currently fail. Namespace inventory reads are not atomic across resource types; a racing rollout should be retried after the snapshot stabilizes. This is image identity/readiness evidence, not complete configuration parity or signed build provenance.

Host fixtures validate adapters and CLI inputs. No live Kubernetes collection, production promotion or target-specific imageID compatibility has yet been verified for this plan. Release pipeline wiring, target-specific maximum age selection, and actual smoke evidence production remain open. The verifier enforces the consumer-supplied freshness policy; host tests do not prove target clock synchronization or live collection.

Each required check must have an explicit entry in `requiredCheckConfigurations`, and its test result must carry the same `configuration` object. The verifier compares JSON values exactly (object key order is immaterial); absent, additional or changed provider modes, protocol versions, authentication modes or other configured values fail promotion even with matching images and passing checks. Use `{}` explicitly for a check with no configuration. This is a required consumer policy input, never inferred from producer evidence; older policies without it fail closed. The policy author must choose the actual required configuration and the producer must record observed values. This comparison does not independently attest how those values were observed, deploy the policy, or establish runtime enforcement.
