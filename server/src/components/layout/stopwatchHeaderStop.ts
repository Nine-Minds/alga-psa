import type { StopwatchSessionView } from '@alga-psa/types';
import type { StopwatchLogLauncher } from '@alga-psa/ui/context';

interface HeaderStopLauncherParams {
  /** True while a DrawerOutlet is mounted (useDrawer().hasOutlet). Absent = assume mounted. */
  hasOutlet?: () => boolean;
  /** The normal Stop flow: open the time-entry drawer prefilled from the session span. */
  drawerLauncher: StopwatchLogLauncher;
  /** Explicit fallback when no outlet can render the drawer: tell the user and link to the work item. */
  notifyPausedWithoutDrawer: (session: StopwatchSessionView) => void;
}

/**
 * Header Stop must never silently do nothing. Several MSP routes (dashboard, profile, reports, …)
 * mount no DrawerOutlet, so openDrawer would pause the session and show nothing. When there is no
 * outlet the session stays paused (the provider already paused it) and the user is told, with a
 * link back to the work item where the log drawer exists.
 */
export function createHeaderStopLauncher({
  hasOutlet,
  drawerLauncher,
  notifyPausedWithoutDrawer,
}: HeaderStopLauncherParams): StopwatchLogLauncher {
  return async (args) => {
    if (hasOutlet && !hasOutlet()) {
      notifyPausedWithoutDrawer(args.session);
      return;
    }
    await drawerLauncher(args);
  };
}
