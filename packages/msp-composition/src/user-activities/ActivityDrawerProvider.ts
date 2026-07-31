// MSP composition boundary for just the user-activities drawer provider.
//
// The app shell (DefaultLayout) needs only ActivityDrawerProvider, so it imports it
// here rather than through `./index` or `@alga-psa/user-activities/components` — both of
// which also pull UserActivitiesDashboard (and its 35-file action barrel) into every
// route's RSC server-reference manifest (dev OOM — see package-build-system.md).
export {
  ActivityDrawerProvider,
  useActivityDrawer,
} from '@alga-psa/user-activities/components/ActivityDrawerProvider';
