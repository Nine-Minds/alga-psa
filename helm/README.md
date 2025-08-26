helm template sebastian sebastian_helm 

helm install sebastian . --create-namespace --kubeconfig ~/.kube/config-hv-dev -n msp


helm list


helm upgrade sebastian --kubeconfig ~/.kube/config-dev . -n msp
---

sudo helm template sebastian helm -f values.draft.yaml > deployment.yaml         

Istio/Vault networking
- The chart sets `traffic.sidecar.istio.io/excludeOutboundPorts: "8200"` by default when you enable Vault annotations, so Vault Agent can reach Vault without Envoy during init.
- You can fine-tune via values:
  - `istio.sidecar.excludeOutboundPorts` (list, default ["8200"]) – bypass Envoy for these ports.
  - `istio.sidecar.excludeOutboundIPRanges` (string CIDRs) – optionally bypass by IP ranges.
  - `istio.sidecar.includeOutboundIPRanges` (string CIDRs) – optionally restrict Envoy egress ranges.

Upgrade example
- `helm upgrade sebastian . -n msp -f values.yaml`
