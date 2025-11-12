"use server";

interface AuthorizeSsoLinkingInput {
  password: string;
  twoFactorCode?: string;
}

export async function authorizeSsoLinkingAction(
  _input: AuthorizeSsoLinkingInput
): Promise<{ success: false; error: string }> {
  return {
    success: false,
    error: "Single sign-on linking is only available in Enterprise Edition.",
  };
}
