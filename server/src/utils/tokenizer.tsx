import jwt, { TokenExpiredError, JsonWebTokenError, NotBeforeError } from 'jsonwebtoken'; 

import { IUserRegister, TokenResponse } from '@/interfaces'; 

import logger from '@/utils/logger';


const secretKey = process.env.SECRET_KEY || 'default';
const token_expires = process.env.TOKEN_EXPIRES || '1h';


export function createToken(userRegister: IUserRegister ) {
    logger.system('Creating token');
    const { username, email, password, companyName } = userRegister;

    const token = jwt.sign({ username, email, password, companyName }, secretKey, {
        expiresIn: token_expires, 
    });

    return token;
}


export function getInfoFromToken(token: string): TokenResponse{
    try {
        logger.system('Getting user info from token');
        const decoded = jwt.verify(token, secretKey) as IUserRegister;
        return {
            errorType: null, 
            userInfo: {
                username: decoded.username,
                email: decoded.email,
                password: decoded.password,
                companyName: decoded.companyName,
                user_type: decoded.user_type
            }
        };
    } catch (err) {
        let errorType = '';
        if (err instanceof TokenExpiredError) {
            logger.error('Error decoding token: TokenExpiredError - JWT expired');
            errorType = 'Token Expired Error';
        } else if (err instanceof JsonWebTokenError) {
            logger.error('Error decoding token: JsonWebTokenError - Invalid JWT');
            errorType = 'Json Web Token Error';
        } else if (err instanceof NotBeforeError) {
            logger.error('Error decoding token: NotBeforeError - JWT not active');
            errorType = 'Not Before Error';
        } else {
            logger.error('Error decoding token:', err);
            errorType = 'Unknown Error';
        }
        return {
            errorType,
            userInfo: null
        };
    }
}


export function decodeToken(token: string): jwt.JwtPayload | null {
    try {
        const decoded = jwt.decode(token);
        if (!decoded) {
            throw new Error('Failed to decode token');
        }
        return decoded as jwt.JwtPayload;
    } catch (err) {
        console.error('Error decoding token:', err);
        if (err instanceof TokenExpiredError) {
            logger.error('Error decoding token: TokenExpiredError - JWT expired');
        } else if (err instanceof JsonWebTokenError) {
            logger.error('Error decoding token: JsonWebTokenError - Invalid JWT');
        } else if (err instanceof NotBeforeError) {
            logger.error('Error decoding token: NotBeforeError - JWT not active');
        } else {
            logger.error('Error decoding token:', err);
        }
        return null;
    }
}