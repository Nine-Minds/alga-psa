# Release runtime readback

The read-only collector requires an explicit target JSON. This two-workload example illustrates collection only; it is not a complete provider-enabled release target:

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

The consumer-owned policy supplies revision, edition, requiredComponents, requiredChecks, requiredCheckConfigurations, requiredBrowserProviders, expectedTarget (the approved context/namespace/workload list), and a positive maxObservationAgeSeconds (for example 300). Component names match renderedReleaseComponents: namespace/kind/workload/containers-or-initContainers/container. The required rendered-resources.json input is the complete JSON resource array rendered by the release pipeline, including hooks and init containers. The verifier derives its inventory independently and compares it with policy, manifest images, target namespace and target workloads. Omitting a worker consistently from policy, manifest and observations still fails when that worker appears in the rendered release. Missing rendered input fails; the previous five-argument CLI is no longer supported.

The collector queries only the named live workloads and Pods/ReplicaSets in the explicit context/namespace. It emits a single versioned envelope containing image observations, target, and observedAt; it never deploys or changes Kubernetes objects. Promotion rejects mismatched target, stale/future timestamps and legacy bare observation arrays. observedAt is recorded before API reads, conservatively aging the earliest snapshot. It clears stale observation output before a query, and failed collection must block subsequent promotion.

Ownership follows controller UID references, including Deployment → ReplicaSet → Pod. Regular containers must be running and ready; ordinary init containers must exit0; restartable init sidecars must be running and ready. Jobs require observed completion and successful terminated containers. Replica count must be positive and complete, controllers must have observed the current generation, and all observed replicas must agree on each image. Rollouts with extra/missing/terminating/mixed-image pods are rejected until stable.

Runtime identities come only from container status imageID. Supported identities are fully qualified repository@sha256 references, optionally prefixed docker-pullable://. Bare containerd/docker config IDs are intentionally unsupported until an adapter resolves their identity against the registry/runtime. Desired PodSpec image strings and status.image cannot substitute for imageID. Kubernetes documents imageID as runtime-reported and potentially different from the requested image: [Pod API](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/). Ownership semantics: [ReplicaSet API](https://kubernetes.io/docs/reference/kubernetes-api/apps/replica-set-v1/).

Supported workload snapshots: Deployment, StatefulSet, DaemonSet, ReplicaSet, Pod and completed Job. CronJobs, operator resources, ephemeral containers and zero-replica workloads need explicit policies/adapters and currently fail. Namespace inventory reads are not atomic across resource types; a racing rollout should be retried after the snapshot stabilizes. This is image identity/readiness evidence, not complete configuration parity or signed build provenance.

Host fixtures validate adapters and CLI inputs. No live Kubernetes collection, production promotion or target-specific imageID compatibility has yet been verified for this plan. Release pipeline wiring, target-specific maximum age selection, and actual smoke evidence production remain open. The verifier enforces the consumer-supplied freshness policy; host tests do not prove target clock synchronization or live collection.

Each required check must have an explicit entry in `requiredCheckConfigurations`, and its test result must carry the same `configuration` object. The verifier compares JSON values exactly (object key order is immaterial); absent, additional or changed provider modes, protocol versions, authentication modes or other configured values fail promotion even with matching images and passing checks. Use `{}` explicitly for a check with no configuration. This is a required consumer policy input, never inferred from producer evidence; older policies without it fail closed. The policy author must choose the actual required configuration and the producer must record observed values. For the provider browser check, the verifier additionally compares declared provider modes and any specified authentication/serverLifecycle with independently projected browser observations. Protocol-version labels and other configuration values are declaration comparisons only; the journals do not independently prove protocol versions.

## Required browser provider evidence

`requiredBrowserProviders` is mandatory, including when a check omits provider configuration. Missing or null policy fails promotion. Supply:

- `checkId`: an existing required check with matching configuration evidence.
- `runId` and `runAttempt`: the browser CI execution identity.
- `componentServices`: a mapping from release component names to tested archive service names.

Map every application runtime service: `server` for community or `server-ee` for enterprise, `email-service`, `hocuspocus`, and `workflow-worker`; enterprise also requires `temporal-worker`. Each mapping must identify an existing release component and a unique archive service. Setup, the emulator and infrastructure archives do not satisfy an application mapping. Additional release components remain subject to the existing complete rendered inventory and runtime readback checks.

`test-evidence.json` must contain `browserProviderExecution` with `collected`, `report`, `evidence`, `root`, `artifactManifest`, and `registryManifests`. The first five inputs are the actual browser collection, execution, clean source evidence, source root and validated CI archive manifest. The verifier recomputes provider readiness against the edition's committed `scripts/browser-provider-requirements.json`; submitted journey requirements or a precomputed passed verdict cannot replace it. Required journeys must pass their first attempt and retain supported, complete, nonempty provider traffic.

`registryManifests` maps each release component name to base64 encoding of its exact registry image-manifest bytes. Preserve the bytes; reserializing parsed JSON changes their digest. The verifier hashes those bytes and compares the result to the component's immutable registry image digest, then compares the manifest's config digest to the tested archive's config image ID. Component source revision and complete build identity must also match the tested record. Archive hashes and config IDs never substitute for registry manifest digests.

Only single-platform OCI image manifests and Docker distribution schema-v2 image manifests are accepted. Image indexes/manifest lists fail until platform-leaf verification is supported. These checks validate the supplied digest chain and browser evidence; they do not authenticate a publisher, publish images, select a deployment target, or implement the remaining release workflow rollout.
