// The resolver lives in shared/ so the workflow worker and shared/services read
// the same capabilities; server code keeps importing it from this path.
export * from '@alga-psa/shared/core/deploymentProfile';
