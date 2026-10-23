import { redirect } from 'next/navigation';

// There is no standalone page behind the intercepted bulk modal: a hard load or refresh of
// this URL renders this route instead of the @modal slot, and re-opening the dialog on top
// of the rehydrated selection is what made it survive a refresh. Go back to the list.
export default function BulkSetDueDatePage() {
  redirect('/msp/tickets');
}
