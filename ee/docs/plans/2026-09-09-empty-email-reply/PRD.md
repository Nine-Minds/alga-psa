# Preserve empty Alga replies

Alga can restore notification text after reply extraction yields nothing, allowing its own notification to become another ticket comment. Support staff and customers need empty replies to stay empty.

Scope: preserve empty text when an Alga conversation token and explicit text boundary or removed token artifacts establish that no reply remains. Keep fallback behavior for ambiguous ordinary email and preserve genuine replies. Exercise the real parser through inbound processing. No UI, schema, API, cross-mailbox sender policy, cleanup or deployment changes.

Acceptance: notification-only messages do not create tickets or comments; genuine replies still create comments; ordinary fallback remains unchanged. No migration required. Risk: overly broad empty-body suppression can discard legitimate replies, so restrict the change to recognized Alga reply structure. Exact original MIME was not retrieved; regression uses the observed notification structure.
