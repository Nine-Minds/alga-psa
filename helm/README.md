helm template sebastian sebastian_helm 

helm install sebastian . --create-namespace --kubeconfig ~/.kube/config-hv-dev -n msp


helm list


helm upgrade sebastian --kubeconfig ~/.kube/config-dev . -n msp
---

sudo helm template sebastian helm -f values.draft.yaml > deployment.yaml         