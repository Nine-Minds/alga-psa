import speakeasy from 'speakeasy';
import qrcode from 'qrcode';


export function QRCode( ): any {
    const secret = speakeasy.generateSecret({
        name: 'MSP - Sebastian',
        length: 20,
        symbols: false,
        qr_codes: true
    });

    const otpauth_url = secret.otpauth_url;
    
    if (!otpauth_url) {
        console.log('Error generating otpauth URL');
        return;
    }
    let code = '';
    qrcode.toDataURL(otpauth_url, function(err, data_url) {
        code = data_url;
    });
    return code;
}

export function verifyAuthenticator( token: string, secret: string ): boolean {
    return speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token
    });
}

export interface TotpEnrollmentMaterial {
    /** Base32 secret; shown to the user for manual entry. */
    secret: string;
    otpauthUrl: string;
    /** PNG data URL of the QR code for `otpauthUrl`. */
    qrDataUrl: string;
}

/** Base32 secrets produced by `generateTotpEnrollment` (20 random bytes -> 32 chars). */
export const TOTP_SECRET_PATTERN = /^[A-Z2-7]{32}$/;

export async function generateTotpEnrollment(accountLabel: string, issuer = 'Alga PSA'): Promise<TotpEnrollmentMaterial> {
    const generated = speakeasy.generateSecret({ length: 20, symbols: false, name: accountLabel, issuer });
    const secret = generated.base32;
    const otpauthUrl = speakeasy.otpauthURL({ secret, label: accountLabel, issuer, encoding: 'base32' });
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrDataUrl };
}
