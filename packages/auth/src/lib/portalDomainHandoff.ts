import { isInteractiveUserType } from "@alga-psa/types";
import {
    isPortalDomainHandoffTarget,
    normalizeHandoffReturnPath,
    surfaceForUserType,
} from "@alga-psa/shared/core/portalDomainSurface";
import { getPortalDomain, getPortalDomainByHostname } from "./PortalDomainModel";
import { issuePortalDomainOtt } from "./PortalDomainSessionToken";

function applyPortToVanityUrl(url: URL, portCandidate: string | undefined, protocol: string): void {
    if (!portCandidate || portCandidate.length === 0) {
        return;
    }

    const isHttpsDefault = protocol === 'https:' && portCandidate === '443';
    const isHttpDefault = protocol === 'http:' && portCandidate === '80';

    if (isHttpsDefault || isHttpDefault) {
        return;
    }

    url.port = portCandidate;
}

/** The surface-neutral page that exchanges a handoff OTT for a session on a custom domain. */
export const PORTAL_HANDOFF_PATH = '/auth/handoff';
/** The client-portal handoff page, kept working for links already in flight. */
const LEGACY_CLIENT_PORTAL_HANDOFF_PATH = '/auth/client-portal/handoff';

export function isHandoffPathname(pathname: string): boolean {
    return pathname.startsWith(PORTAL_HANDOFF_PATH) || pathname.startsWith(LEGACY_CLIENT_PORTAL_HANDOFF_PATH);
}

/**
 * Hands a signed-in user's session to one of their tenant's custom domains. Returns the
 * URL of that domain's handoff page (carrying a one-time token), or null when the user
 * should stay on the host they are on.
 *
 * The handoff is surface-neutral: the surface follows the user type (client users the
 * client portal, internal users the MSP app) and the domain must be ACTIVE, owned by the
 * user's tenant and serving that surface; the return path must be a relative path inside
 * the surface. Anything else yields null and no OTT is issued.
 *
 * An internal user is only handed off to a target on another host: sign-in on the
 * canonical host itself is unchanged. A client user whose callback is a canonical-host
 * path is sent to the tenant's client-portal domain (existing behaviour).
 */
export async function computeVanityRedirect({
    url,
    baseUrl,
    token,
}: {
    url: string;
    baseUrl: string;
    token?: Record<string, unknown> | null;
}): Promise<string | null> {
    if (!token) {
        return null;
    }

    const userType = typeof token.user_type === 'string' ? token.user_type : undefined;
    const tenantId = token.tenant;

    if (!userType || !isInteractiveUserType(userType) || typeof tenantId !== 'string' || tenantId.length === 0) {
        console.log('[computeVanityRedirect] token not eligible', { userType, tenantId });
        return null;
    }
    const surface = surfaceForUserType(userType);

    const base = new URL(baseUrl);
    const target = new URL(url, baseUrl);

    const userIdCandidate = token.id ?? token.sub;
    if (typeof userIdCandidate !== 'string' || userIdCandidate.length === 0) {
        console.log('[computeVanityRedirect] missing user id', { tokenKeys: Object.keys(token) });
        return null;
    }

    const isSameOrigin = target.origin === base.origin;
    if (isHandoffPathname(target.pathname)) {
        console.log('[computeVanityRedirect] target already handoff', { target: target.toString() });
        return null;
    }
    // Internal users sign in on the canonical host in place; only a custom-host target is a handoff.
    if (isSameOrigin && surface === 'msp') {
        return null;
    }

    const returnPath = normalizeHandoffReturnPath(`${target.pathname}${target.search ?? ''}`, surface);
    if (!returnPath) {
        console.log('[computeVanityRedirect] return path not inside surface', { surface, pathname: target.pathname });
        return null;
    }

    try {
        console.log('[computeVanityRedirect] begin lookup', {
            tenantId,
            userIdCandidate,
            base: baseUrl,
            target: target.toString(),
            surface,
        });
        const { getAdminConnection } = await import('@alga-psa/db/admin');
        const knex = await getAdminConnection();

        const fetchPortalDomainForTenant = async () => {
            const portalDomain = await getPortalDomain(knex, tenantId);
            if (!portalDomain || !isPortalDomainHandoffTarget(portalDomain, surface)) {
                return null;
            }
            // Already on the tenant's own custom domain (an MSP/both domain authenticates in
            // place, see nextauth/customHostAuth.ts): the session cookie is host-only on this
            // host, so a handoff to ourselves would be a pointless redirect loop.
            if (portalDomain.domain.toLowerCase() === base.host.toLowerCase()) {
                return null;
            }
            return portalDomain;
        };

        const fetchPortalDomainForHost = async (hostname: string, port?: string) => {
            const candidates = [hostname];
            if (port && port.length > 0 && port !== '80' && port !== '443') {
                candidates.unshift(`${hostname}:${port}`);
            }

            for (const candidate of candidates) {
                const portalDomain = await getPortalDomainByHostname(knex, candidate);
                if (!portalDomain || !isPortalDomainHandoffTarget(portalDomain, surface)) {
                    continue;
                }
                if (portalDomain.tenant !== tenantId) {
                    continue;
                }
                return portalDomain;
            }

            return null;
        };

        const protocol = isSameOrigin ? base.protocol : target.protocol;
        const portalDomain = isSameOrigin
            ? await fetchPortalDomainForTenant()
            : await fetchPortalDomainForHost(target.hostname, target.port);

        if (!portalDomain) {
            console.log('[computeVanityRedirect] portal domain not found', {
                tenant: tenantId,
                targetHost: target.hostname,
                isSameOrigin,
                surface,
            });
            return null;
        }

        const { token: ott } = await issuePortalDomainOtt({
            tenant: portalDomain.tenant,
            portalDomainId: portalDomain.id,
            userId: userIdCandidate,
            targetDomain: portalDomain.domain,
            surface,
            loginMethod: typeof token.login_method === 'string' ? token.login_method : undefined,
            issuedFromHost: base.host,
            returnPath,
        });

        const vanityUrl = new URL(`${protocol}//${portalDomain.domain}${PORTAL_HANDOFF_PATH}`);
        const desiredPort = isSameOrigin ? base.port : target.port;
        applyPortToVanityUrl(vanityUrl, desiredPort, protocol);
        vanityUrl.searchParams.set('ott', ott);
        vanityUrl.searchParams.set('return', returnPath);

        console.log('[computeVanityRedirect] redirecting to vanity host', {
            base: base.origin,
            target: target.toString(),
            vanity: vanityUrl.toString(),
            tenant: tenantId,
            user: userIdCandidate,
            surface,
        });

        return vanityUrl.toString();
    } catch (error) {
        console.warn('Failed to prepare vanity redirect', error);
        return null;
    }
}

