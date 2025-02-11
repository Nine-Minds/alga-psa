import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req });
    
    if (!token) {
      return NextResponse.json({ isValid: false }, { status: 401 });
    }

    // Return user type and tenant information from token
    return NextResponse.json({
      isValid: true,
      userType: token.user_type as string,
      tenant: token.tenant as string
    });
  } catch (error) {
    console.error('Token validation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}