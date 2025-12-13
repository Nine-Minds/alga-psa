# Configuration Standards

## Module System
- All JavaScript/TypeScript files use ES Modules
- Use `.js` extension with ES Module syntax
- Import statements should use the `.js` extension explicitly
- No mixing of CommonJS and ES Modules

## Environment Variables

### Naming Convention
All environment variables must use SCREAMING_SNAKE_CASE format with clear category prefixes:

- **APP_**: Application settings
  - APP_NAME
  - APP_ENV
  - APP_VERSION
  - APP_HOST
  - APP_PORT

- **DB_**: Database settings
  - DB_HOST
  - DB_PORT
  - DB_NAME
  - DB_USER
  - DB_PASSWORD (managed via Docker secrets)

- **REDIS_**: Redis settings
  - REDIS_HOST
  - REDIS_PORT
  - REDIS_PASSWORD (managed via Docker secrets)

- **EMAIL_**: Email settings
  - EMAIL_HOST
  - EMAIL_PORT
  - EMAIL_USER
  - EMAIL_PASSWORD (managed via Docker secrets)

- **AUTH_**: Authentication settings
  - AUTH_SECRET (replaces NEXTAUTH_SECRET)
  - AUTH_URL (replaces NEXTAUTH_URL)
  - AUTH_SESSION_EXPIRES
  - AUTH_GOOGLE_CLIENT_ID (managed via Docker secrets)
  - AUTH_GOOGLE_CLIENT_SECRET (managed via Docker secrets)

- **CRYPTO_**: Cryptographic settings
  - CRYPTO_KEY (managed via Docker secrets)
  - CRYPTO_SALT_BYTES
  - CRYPTO_ITERATIONS
  - CRYPTO_KEY_LENGTH
  - CRYPTO_ALGORITHM

### Variable Usage Guidelines
1. Use descriptive names that clearly indicate purpose
2. Group related variables with consistent prefixes
3. Use boolean flags with IS_ or HAS_ prefix (e.g., IS_PRODUCTION, HAS_FEATURE_X)
4. Sensitive values should be managed through Docker secrets
5. Default values should be provided in .env.example
6. Environment-specific values go in .env.development or .env.production

## Configuration Files
- Use .env files for environment variables
- Use config.ini for application configuration
- Use docker-compose.yaml for Docker configuration
- Keep secrets in the secrets/ directory
- Use consistent indentation (2 spaces) in all configuration files

## Best Practices
1. Never commit sensitive data to version control
2. Document all configuration options
3. Validate environment variables at startup
4. Use strong typing for configuration objects
5. Centralize configuration management
6. Follow the principle of least privilege
7. Use meaningful default values
8. Keep configuration DRY (Don't Repeat Yourself)
