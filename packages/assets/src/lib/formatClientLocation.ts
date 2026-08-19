import { displayAddressField, displayCountry } from '@alga-psa/core';

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
        displayAddressField(location.address_line1),
        displayAddressField(location.address_line2),
        displayAddressField(location.city),
        displayAddressField(location.state_province),
        displayAddressField(location.postal_code),
        displayCountry(location.country_name),
    ].filter(Boolean).join(', ');
}
