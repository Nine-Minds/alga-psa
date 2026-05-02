# T016 Reboot Persistence

1. Start from successful T011 environment.
2. Reboot VM host.
3. After boot, verify:

```bash
systemctl status alga-appliance.service --no-pager
systemctl status k3s --no-pager
kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get nodes
kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml -n flux-system get gitrepositories,kustomizations
kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml -n alga-system get helmreleases
```

4. Open `http://<node-ip>:8080` and confirm status reports current state.

Expected:
- host service starts automatically
- k3s node returns Ready
- Flux/Helm objects remain reconciled
- status UI remains available
