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
