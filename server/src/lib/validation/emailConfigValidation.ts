import logger from '@alga-psa/core/logger';

/**
 * Validates email provider configuration
 * Returns validation result with warnings for non-critical issues
 */
export function validateEmailConfiguration(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  // Check if email is enabled
  const isEnabled = process.env.EMAIL_ENABLE === 'true';
  
  if (!isEnabled) {
    // Email is explicitly disabled, no warnings needed
    return { valid: true, warnings: [] };
  }

  // Email is enabled, validate provider configuration
  const providerType = process.env.EMAIL_PROVIDER_TYPE;
  
  // Detect provider type if not specified
  const detectedType = !providerType ? detectProviderType() : providerType;
  
  if (!providerType) {
    warnings.push(`EMAIL_PROVIDER_TYPE not specified. Auto-detected provider type: ${detectedType}`);
  }

  // Validate based on provider type
  switch (detectedType) {
    case 'resend':
      validateResendConfig(warnings);
      break;
    case 'smtp':
    default:
      validateSMTPConfig(warnings);
      break;
  }

  // Check for common email configuration
  if (!process.env.EMAIL_FROM) {
    warnings.push('EMAIL_FROM not specified. Default "noreply@localhost" will be used.');
  }

  return {
    valid: true, // Email config is not critical for startup
    warnings
  };
}

/**
 * Detect provider type based on environment variables
 */
function detectProviderType(): 'smtp' | 'resend' {
  // If Resend API key is present, use Resend
  if (process.env.RESEND_API_KEY) {
    return 'resend';
  }

  // Default to SMTP
  return 'smtp';
}

/**
 * Validate SMTP configuration
 */
function validateSMTPConfig(warnings: string[]): void {
  const requiredFields = [
    { key: 'EMAIL_HOST', legacy: 'SMTP_HOST' },
    { key: 'EMAIL_USERNAME', legacy: 'SMTP_USER' },
    { key: 'EMAIL_PASSWORD', legacy: 'SMTP_PASS' }
  ];

  for (const field of requiredFields) {
    if (!process.env[field.key] && !process.env[field.legacy]) {
      warnings.push(`Missing SMTP configuration: ${field.key} or ${field.legacy}`);
    }
  }

  // Check port configuration
  const port = process.env.EMAIL_PORT || process.env.SMTP_PORT;
  if (!port) {
    warnings.push('EMAIL_PORT not specified. Default port 587 will be used.');
  } else {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      warnings.push(`Invalid EMAIL_PORT: ${port}. Must be between 1 and 65535.`);
    }
  }
}

/**
 * Validate Resend configuration
 */
function validateResendConfig(warnings: string[]): void {
  // Check for API key
  const apiKey = process.env.RESEND_API_KEY;
  
  if (!apiKey) {
    warnings.push('Missing Resend API key. Please set RESEND_API_KEY environment variable.');
  } else if (apiKey.length < 10) {
    warnings.push('Resend API key appears to be invalid (too short).');
  } else if (!apiKey.startsWith('re_')) {
    warnings.push('Resend API key should start with "re_" prefix.');
  }

  // Check for from email
  const fromEmail = process.env.EMAIL_FROM;
  
  if (!fromEmail) {
    warnings.push('EMAIL_FROM not specified. A valid email address with a verified domain is required for Resend.');
  } else if (!fromEmail.includes('@')) {
    warnings.push('EMAIL_FROM appears to be invalid (missing @ symbol).');
  } else {
    // Extract and validate domain
    const domainMatch = fromEmail.match(/@(.+)$/);
    if (!domainMatch || !domainMatch[1]) {
      warnings.push('EMAIL_FROM does not contain a valid domain.');
    } else if (!domainMatch[1].includes('.')) {
      warnings.push(`EMAIL_FROM domain '${domainMatch[1]}' appears invalid (missing TLD).`);
    }
  }
}

/**
 * Log email configuration warnings
 */
export function logEmailConfigWarnings(warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  logger.warn('Email Configuration Warnings:');
  logger.warn('================================');
  
  for (const warning of warnings) {
    logger.warn(`⚠️  ${warning}`);
  }
  
  logger.warn('================================');
  logger.warn('Email functionality may be limited or unavailable.');
  logger.warn('To resolve, set the appropriate environment variables.');
  
  // Log provider-specific help
  const providerType = process.env.EMAIL_PROVIDER_TYPE || detectProviderType();
  
  if (providerType === 'resend') {
    logger.warn('\nFor Resend provider, ensure you have:');
    logger.warn('  - RESEND_API_KEY set with a valid API key');
    logger.warn('  - EMAIL_FROM set with an email address using a verified domain');
    logger.warn('  - EMAIL_PROVIDER_TYPE=resend (optional but recommended)');
  } else {
    logger.warn('\nFor SMTP provider, ensure you have:');
    logger.warn('  - EMAIL_HOST (SMTP server hostname)');
    logger.warn('  - EMAIL_USERNAME (SMTP username)');
    logger.warn('  - EMAIL_PASSWORD (SMTP password)');
    logger.warn('  - EMAIL_FROM (sender email address)');
    logger.warn('  - EMAIL_PROVIDER_TYPE=smtp (optional but recommended)');
  }
}