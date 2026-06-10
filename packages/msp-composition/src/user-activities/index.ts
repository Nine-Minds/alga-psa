// MSP composition boundary for the user-activities feature.
//
// The route/layout consume the dashboard and drawer provider through this wrapper rather
// than importing `@alga-psa/user-activities` directly, keeping host-level composition
// consistent. These are thin re-exports today (no MSP-specific props), but this remains
// the place to wire MSP cross-feature concerns if they arise. EE workflow-task integration
// is supplied separately via `MspActivityCrossFeatureProvider`, not through here.
export {
  UserActivitiesDashboard,
  ActivityDrawerProvider,
  useActivityDrawer,
} from '@alga-psa/user-activities/components';
