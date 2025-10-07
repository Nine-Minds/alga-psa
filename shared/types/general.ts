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
    userInfo: {
        username: string;
        email: string;
        password: string;
        clientName: string;
        user_type: string;
    } | null;
}