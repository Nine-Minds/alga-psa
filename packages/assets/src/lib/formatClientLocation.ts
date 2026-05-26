export interface ClientLocationLike {
    location_name?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state_province?: string | null;
    postal_code?: string | null;
    country_name?: string | null;
}

export function formatClientLocation(location: ClientLocationLike): string {
    return [
        location.location_name,
        location.address_line1,
        location.address_line2,
        location.city,
        location.state_province,
        location.postal_code,
        location.country_name,
    ].filter(Boolean).join(', ');
}
