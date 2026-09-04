// Community Edition seam for the hosted/cloud portal-domain driver. CE ships no
// Temporal, cert-manager, or Istio automation, so the factory falls back to the
// direct (trust-on-submit) provisioner under every deployment profile.
// Kept type-free on purpose: importing the contract from server/ would add an
// @alga-psa/ee-stubs -> server edge to the Nx project graph and create cycles.
export const hostedProvisioner = null;
