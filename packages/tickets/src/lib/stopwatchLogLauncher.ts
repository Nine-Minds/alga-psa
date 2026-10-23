import type { OpenDrawerFn, SchedulingCallbacks, StopwatchLogLauncher } from '@alga-psa/ui/context';
import { stopwatchSessionToTimeEntryContext } from './timeEntryContext';

interface CreateStopwatchLogLauncherParams {
  openDrawer: OpenDrawerFn;
  closeDrawer: () => void;
  launchTimeEntry: SchedulingCallbacks['launchTimeEntry'];
  translate: (key: string, defaultValue: string, options?: Record<string, unknown>) => string;
  locale?: string;
  descriptionOverride?: string;
  masterTicketId?: string | null;
  masterTicketNumber?: string | null;
  /** Extra host work after the entry was saved (e.g. refresh the ticket's time list). */
  onSaved?: () => void;
}

/**
 * The Stop flow shared by the ticket tile and the header (D4): the provider has already paused
 * the session; this opens the time-entry drawer prefilled from its span. Saving the drawer logs
 * the session server-side; closing it leaves the session paused.
 */
export function createStopwatchLogLauncher({
  openDrawer,
  closeDrawer,
  launchTimeEntry,
  translate,
  locale,
  descriptionOverride,
  masterTicketId,
  masterTicketNumber,
  onSaved,
}: CreateStopwatchLogLauncherParams): StopwatchLogLauncher {
  return async ({ session, span, onLogged }) => {
    await launchTimeEntry({
      openDrawer,
      closeDrawer,
      context: stopwatchSessionToTimeEntryContext(session, span, {
        translate,
        locale,
        descriptionOverride,
        masterTicketId,
        masterTicketNumber,
      }),
      onComplete: () => {
        onLogged();
        onSaved?.();
      },
    });
  };
}
