export type AlertType = 'error' | 'success' | 'warning';

export interface AlertProps {
    type: AlertType;
    title: string;
    message: string;
    isOpen?: boolean;
    onClose?: () => void;
}

export interface TokenResponse {
    errorType: string | null;
    messageKey?: string;
    userInfo: {
        username: string;
        email: string;
        password: string;
        clientName: string;
        user_type: string;
        /** Tenant the token's user belongs to (password-reset tokens). */
        tenant?: string;
        /** The token's user (password-reset tokens). */
        user_id?: string;
    } | null;
}