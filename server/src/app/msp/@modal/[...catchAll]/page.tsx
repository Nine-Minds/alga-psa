// Parallel slots keep their PREVIOUS content on soft navigation when the new URL matches
// nothing in the slot (@modal/default.tsx only applies on hard loads). Without this
// catch-all, navigating away from an intercepted modal — e.g. create-ticket's
// "Create + View" router.replace to the new ticket — left the stale dialog stuck over the
// destination page. Matching every non-intercepted /msp/* URL and rendering nothing makes
// any navigation away from a modal route actually dismiss the modal.
export default function MspModalCatchAll() {
  return null;
}
