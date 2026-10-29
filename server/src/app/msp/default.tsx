import { notFound } from 'next/navigation';

// Children-slot default for the msp layout. Next 16.4's strict route matching
// requires every URL the @modal catch-all can match to resolve in the children
// slot too; /msp/go/[target] is a route handler with no page, so it needs this.
// Mirrors the built-in default: an unmatched /msp/* URL is still a 404.
export default function MspChildrenDefault(): never {
  notFound();
}
