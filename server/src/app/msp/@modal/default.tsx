// Default render for the msp @modal parallel slot: nothing is shown unless an intercepting
// modal route (e.g. (.)create-ticket) is active. Required so non-modal /msp/* routes
// resolve the slot instead of 404-ing.
export default function MspModalDefault() {
  return null;
}
