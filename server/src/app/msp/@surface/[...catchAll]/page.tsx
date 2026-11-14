import { enforcePrincipalSurfaceRoute } from '@/lib/serverProductRouteGuard';

// The server-side gate of a principal kind's surface (a seat technician sees the operational routes only).
//
// A layout does not re-run on soft navigation, so a gate in the layout alone would miss every client-side
// move. A parallel slot that matches every /msp URL does re-render on each navigation (the @modal catch-all
// next to it relies on the same property), so the one gate lives here and covers hard loads and soft
// navigation alike, with no call in any page. The layout applies the same gate first on a hard load so
// that a closed page never starts to render. An ordinary principal passes through untouched.
//
// The segment must be a required catch-all named like @modal's: Next normalizes parallel slots onto one
// route tree, and refuses to start when an optional and a required catch-all, or two slug names, share a
// level. /msp itself is a route handler (msp/route.tsx), so no slot page is needed for it.
export default async function MspSurfaceGate({ params }: { params: Promise<{ catchAll?: string[] }> }) {
  const { catchAll = [] } = await params;
  await enforcePrincipalSurfaceRoute(['/msp', ...catchAll].join('/'));
  return null;
}
