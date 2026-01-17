import jwt, { TokenExpiredError, JsonWebTokenError, NotBeforeError, SignOptions, Secret } from 'jsonwebtoken'; 

import { IUserRegister, TokenResponse } from 'server/src/interfaces'; 

import logger from 'server/src/utils/logger';
import { getSecretProviderInstance } from '@alga-psa/core';


async function getSecretKey(): Promise<Secret> {
    const secretProvider = await getSecretProviderInstance();
    const secretKey = await secretProvider.getAppSecret('SECRET_KEY');
    return secretKey || process.env.SECRET_KEY || 'default';
}


export async function createToken(userRegister: IUserRegister) {
    logger.debug('Creating token');
    const { username, email, password, clientName, user_type } = userRegister;
    const secretKey = await getSecretKey();

    // expiresIn can be a number (seconds) or a string like '1h', '7d', etc.
    const expiresIn: string | number = process.env.TOKEN_EXPIRES || '1h';
    
    const token = jwt.sign(
        { username, email, password, clientName, user_type },
        secretKey,
        { 
            expiresIn
        } as SignOptions
    );

    return token;
}


export async function getInfoFromToken(token: string): Promise<TokenResponse> {
    try {
        logger.debug('Getting user info from token');
        const secretKey = await getSecretKey();
        const decoded = jwt.verify(token, secretKey) as IUserRegister;
        return {
            errorType: null, 
            userInfo: {
                username: decoded.username,
                email: decoded.email,
                password: decoded.password,
                clientName: decoded.clientName,
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