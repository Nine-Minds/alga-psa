# Temporal Worker Helm Chart Extraction Plan

## Intro / Rationale

This plan outlines the extraction of temporal worker components from the main Alga PSA helm chart (`helm/`) into a separate, dedicated helm chart (`ee/helm/temporal-worker/`). This separation will:

- Improve modularity and maintainability by isolating temporal-specific deployments
- Enable independent versioning and deployment of temporal workers
- Simplify the main helm chart by removing optional enterprise components
- Allow for easier testing and development of temporal worker features

**Success Criteria:**
- Temporal worker components are fully extracted into a separate helm chart
- Main chart can optionally depend on the temporal chart via subchart mechanism
- Both charts deploy successfully with existing configurations
- No breaking changes to existing deployments

## Phased Implementation Checklist

### Phase 1: Create New Chart Structure
- [x] Create directory structure at `ee/helm/temporal-worker/`
- [x] Create `Chart.yaml` with appropriate metadata
  - [x] Set chart name to `temporal-worker`
  - [x] Set version to `0.1.0`
  - [x] Add description and maintainer information
- [x] Create initial `values.yaml` with temporal-specific values
- [x] Create `templates/` directory
- [x] Add `.helmignore` file

### Phase 2: Extract Temporal Components
- [x] Copy all files from `helm/templates/temporal-worker/` to `ee/helm/temporal-worker/templates/`
  - [x] `configmap.yaml`
  - [x] `deployment.yaml`
  - [x] `hpa.yaml`
  - [x] `pdb.yaml`
  - [x] `secrets.yaml`
  - [x] `service.yaml`
  - [x] `serviceaccount.yaml`
- [x] Update template references to use local chart context
  - [x] Replace `.Values.temporalWorker` with `.Values` in all templates
  - [x] Update any global value references
- [x] Extract temporal-specific helpers to `ee/helm/temporal-worker/templates/_helpers.tpl`

### Phase 3: Update Values Structure
- [x] Extract `temporalWorker` section from main `helm/values.yaml`
- [x] Create comprehensive `ee/helm/temporal-worker/values.yaml`
  - [x] Remove the `temporalWorker` parent key
  - [x] Ensure all nested values are at root level
- [x] Add any missing default values
- [x] Document all configurable values with comments

### Phase 4: Clean Up Main Chart
- [x] Remove `helm/templates/temporal-worker/` directory
- [x] Remove `temporalWorker` section from `helm/values.yaml`
- [x] Add optional dependency in `helm/Chart.yaml`:
  ```yaml
  dependencies:
    - name: temporal-worker
      version: "0.1.0"
      repository: "file://../ee/helm/temporal-worker"
      condition: temporal-worker.enabled
  ```
- [x] Update any documentation references

### Phase 5: Integration Testing
- [x] Test standalone temporal chart deployment:
  ```bash
  helm install temporal-test ee/helm/temporal-worker/ -f test-values.yaml
  ```
- [x] Test main chart with temporal subchart disabled
- [x] Test main chart with temporal subchart enabled
- [x] Verify all resources are created correctly
- [x] Check service connectivity and configuration

### Phase 6: Documentation and Finalization
- [ ] Create `ee/helm/temporal-worker/README.md` with:
  - [ ] Installation instructions
  - [ ] Configuration options
  - [ ] Example values files
- [ ] Update main helm chart README if needed
- [ ] Create example values files for common scenarios
- [ ] Add upgrade notes for existing deployments

## Background Details / Investigation / Implementation Advice

### Current Structure
The temporal worker components are currently embedded in the main helm chart under `helm/templates/temporal-worker/`. The configuration uses a conditional flag `.Values.temporalWorker.enabled` to control deployment.

### Key Considerations

1. **Namespace Handling**: The temporal worker may need to communicate with services in different namespaces. Ensure service discovery works correctly.

2. **Value References**: When extracting, be careful with references to global values or other chart components. These will need to be passed explicitly or configured separately.

3. **Secret Management**: The temporal worker uses both Vault and local secrets. Ensure the secret provider configuration is properly isolated.

4. **Image Registry**: The worker uses a private Harbor registry. Ensure image pull secrets are correctly configured in the new chart.

5. **Resource Naming**: Consider prefixing resources with the release name to avoid conflicts when both charts are deployed in the same namespace.

### Testing Approach

1. Create a test values file that mirrors production configuration
2. Deploy in a test namespace first
3. Verify all pods start successfully
4. Check logs for configuration errors
5. Test actual workflow execution if possible

### Rollback Strategy

If issues arise during migration:
1. The original chart remains unchanged until Phase 4
2. Can quickly revert by not using the subchart dependency
3. Keep backup of original temporal-worker templates until fully validated

## Implementer's Scratch Pad

### Notes and Observations
<!-- Track findings during implementation -->

### Issues Encountered and Resolutions
<!-- Document any problems and their solutions -->

### Deviations from Plan
<!-- Note any changes to the original approach -->

### Test Results
<!-- Record deployment test outcomes -->

### Questions for Review
<!-- Capture items needing clarification -->

### Commands Used
<!-- Keep track of useful helm/kubectl commands -->
```bash
# Example commands for reference
# helm dep update helm/
# helm template temporal-worker ee/helm/temporal-worker/
# kubectl get all -l app.kubernetes.io/name=temporal-worker
```