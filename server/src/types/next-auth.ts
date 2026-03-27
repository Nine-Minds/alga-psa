import NextAuth from "next-auth";

declare module "next-auth" {
    interface User {
        username: string;
        proToken: string;
        tenant?: string;
        tenantSlug?: string;
        user_type: string;
        clientId?: string;
        contactId?: string;
        max_concurrent_sessions?: number;
        two_factor_enabled?: boolean;
        two_factor_required_new_device?: boolean;
        deviceInfo?: {
            ip: string;
            userAgent: string;
            deviceFingerprint: string;
            deviceName: string;
            deviceType: string;
            locationData: any;
        };
    }

    interface Session {
        session_id?: string;
        login_method?: string;
        user: {
            id: string;
            email: string;
            name: string;
            username: string;
            image?: string;
            proToken: string;
            tenant?: string;
            tenantSlug?: string;
            user_type: string;
            clientId?: string;
            contactId?: string;
            plan?: string;
            addons?: string[];
            trial_end?: string | null;
            subscription_status?: string | null;
            premium_trial_end?: string | null;
            premium_trial_confirmed?: boolean;
            premium_trial_effective_date?: string | null;
        };
    }

    interface JWT {
        id: string;
        email: string;
        name: string;
        username: string;
        image: string;
        proToken: string;
        tenant?: string;
        tenantSlug?: string;
        user_type: string;
        clientId?: string;
        contactId?: string;
        plan?: string;
        addons?: string[];
        trial_end?: string | null;
        subscription_status?: string | null;
        premium_trial_end?: string | null;
        premium_trial_confirmed?: boolean;
        premium_trial_effective_date?: string | null;
        session_id?: string;
        login_method?: string;
        last_activity_check?: number;
        last_revocation_check?: number;
        last_plan_check?: number;
    }
}
