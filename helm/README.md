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

## Istio Gateway + VirtualService (optional)

Enable Istio-managed ingress when you terminate TLS upstream (e.g., Cloudflare) and send HTTP to the cluster.

1) Label the namespace for injection:
   - kubectl label ns msp istio-injection=enabled --overwrite
   - or: kubectl label ns msp istio.io/rev=default --overwrite

2) Enable the templates and set hosts:

   helm upgrade --install sebastian . -n msp \
     --set istio.enabled=true \
     --set istio.gateway.selector.istio=ingress \
     --set istio.hosts={sebastian.9minds.ai,green-sebastian.9minds.ai,blue-sebastian.9minds.ai,istio.9minds.ai} \
     --set istio.routes.default.service=sebastian-green \
     --set istio.routes.default.port=3000 \
     --set istio.routes.green.host=green-sebastian.9minds.ai \
     --set istio.routes.green.service=sebastian-green \
     --set istio.routes.green.port=3000 \
     --set istio.routes.blue.host=blue-sebastian.9minds.ai \
     --set istio.routes.blue.service=sebastian-blue \
     --set istio.routes.blue.port=3000

Notes:
- Only HTTP (port 80) is exposed by the Gateway. Terminate TLS at your reverse
  proxy (e.g., Cloudflare) and target the origin URL:
  http://istio-ingress.istio-system.svc.cluster.local:80
- The default apex host routes to green. Adjust to your needs.
