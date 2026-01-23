"use server";

interface GetLinkedSsoProvidersInput {
  email: string;
  userType: "internal" | "client";
  tenantSlug?: string;
}

export async function getLinkedSsoProvidersAction(
  _input: GetLinkedSsoProvidersInput
): Promise<{ success: boolean; providers: string[]; twoFactorEnabled: boolean }> {
  return {
    success: true,
    providers: [],
    twoFactorEnabled: false,
  };
}
