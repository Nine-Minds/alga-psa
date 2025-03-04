import { describe, it, expect, afterEach, vi, Mock } from 'vitest';
import { IUserRegister } from 'server/src/interfaces';
import jwt from 'jsonwebtoken';
import { createToken, getInfoFromToken } from 'server/src/utils';

vi.mock('jsonwebtoken', () => {
    class MockTokenExpiredError extends Error {
        expiredAt: Date;
        constructor(message: string, expiredAt: Date) {
            super(message);
            this.name = 'TokenExpiredError';
            this.expiredAt = expiredAt;
            Object.setPrototypeOf(this, new.target.prototype);
        }
    }

    class MockJsonWebTokenError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'JsonWebTokenError';
            Object.setPrototypeOf(this, new.target.prototype);
        }
    }

    class MockNotBeforeError extends Error {
        date: Date;
        constructor(message: string, date: Date) {
            super(message);
            this.name = 'NotBeforeError';
            this.date = date;
            Object.setPrototypeOf(this, new.target.prototype);
        }
    }

    // Create prototype chains
    Object.setPrototypeOf(MockTokenExpiredError, Error);
    Object.setPrototypeOf(MockTokenExpiredError.prototype, Error.prototype);
    Object.setPrototypeOf(MockJsonWebTokenError, Error);
    Object.setPrototypeOf(MockJsonWebTokenError.prototype, Error.prototype);
    Object.setPrototypeOf(MockNotBeforeError, Error);
    Object.setPrototypeOf(MockNotBeforeError.prototype, Error.prototype);

    return {
        __esModule: true,
        default: {
            sign: vi.fn(),
            verify: vi.fn(),
            TokenExpiredError: MockTokenExpiredError,
            JsonWebTokenError: MockJsonWebTokenError,
            NotBeforeError: MockNotBeforeError
        },
        sign: vi.fn(),
        verify: vi.fn(),
        TokenExpiredError: MockTokenExpiredError,
        JsonWebTokenError: MockJsonWebTokenError,
        NotBeforeError: MockNotBeforeError
    };
});

vi.mock('@/utils/logger', () => {
    const mockLogger = {
        system: vi.fn(),
        error: vi.fn()
    };
    return {
        default: mockLogger
    };
});

describe('Auth Functions', () => {
    const mockUser: IUserRegister = {
        username: 'testUser',
        email: 'test@example.com',
        password: 'password123',
        companyName: 'TestCompany'
    };

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('createToken', () => {
        it('should create a valid JWT token', () => {
            const mockToken = 'mockToken';
            (jwt.sign as Mock).mockReturnValue(mockToken);

            const token = createToken(mockUser);

            expect(jwt.sign).toHaveBeenCalledWith({
                username: mockUser.username,
                email: mockUser.email,
                password: mockUser.password,
                companyName: mockUser.companyName
            }, expect.any(String), { expiresIn: expect.any(String) });

            expect(token).toBe(mockToken);
        });
    });

    describe('getInfoFromToken', () => {
        it('should return user info when token is valid', () => {
            (jwt.verify as Mock).mockReturnValue(mockUser);

            const result = getInfoFromToken('validToken');

            expect(jwt.verify).toHaveBeenCalledWith('validToken', expect.any(String));
            expect(result.userInfo).toEqual(mockUser);
            expect(result.errorType).toBeNull();
        });

        it('should handle TokenExpiredError', () => {
            const error = new jwt.TokenExpiredError('jwt expired', new Date());
            (jwt.verify as Mock).mockImplementation(() => {
                throw error;
            });

            const result = getInfoFromToken('expiredToken');

            expect(result.errorType).toBe('Token Expired Error');
            expect(result.userInfo).toBeNull();
        });

        it('should handle JsonWebTokenError', () => {
            const error = new jwt.JsonWebTokenError('invalid token');
            (jwt.verify as Mock).mockImplementation(() => {
                throw error;
            });

            const result = getInfoFromToken('invalidToken');

            expect(result.errorType).toBe('Json Web Token Error');
            expect(result.userInfo).toBeNull();
        });

        it('should handle NotBeforeError', () => {
            const error = new jwt.NotBeforeError('jwt not active', new Date());
            (jwt.verify as Mock).mockImplementation(() => {
                throw error;
            });

            const result = getInfoFromToken('notBeforeToken');

            expect(result.errorType).toBe('Not Before Error');
            expect(result.userInfo).toBeNull();
        });

        it('should handle unknown errors', () => {
            (jwt.verify as Mock).mockImplementation(() => {
                throw new Error('Unknown error');
            });

            const result = getInfoFromToken('unknownErrorToken');

            expect(result.errorType).toBe('Unknown Error');
            expect(result.userInfo).toBeNull();
        });
    });
});
