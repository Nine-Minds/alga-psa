import NextAuth from "next-auth";

declare module "next-auth" {
    interface User {
        username: string;
        proToken: string;
        tenant?: string;
        user_type: string;
        companyId?: string;
        contactId?: string;
    }

    interface Session {
        user: {
            id: string;
            email: string;
            name: string;
            username: string;
            image?: string;
            proToken: string;
            tenant?: string;
            user_type: string;
            companyId?: string;
            contactId?: string;
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
        user_type: string;
        companyId?: string;
        contactId?: string;
    }
}