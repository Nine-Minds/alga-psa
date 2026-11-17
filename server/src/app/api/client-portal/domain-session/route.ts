// The client-portal exchange path predates the surface-neutral /api/auth/domain-session and
// stays reachable for handoff links already in flight. Same handlers, same behaviour.
export { POST, OPTIONS } from '../../auth/domain-session/route';
