# Email Registration System Documentation

## Overview

The email registration system allows clients to self-register using their company email addresses. The system supports two registration flows:
1. Contact-based registration (existing functionality)
   - Allows existing contacts to create user accounts
   - Automatically assigns client role
   - Validates contact status (active/inactive)
   - Preserves existing company and contact relationships
2. Email suffix-based registration (new functionality)
   - Validates email domain against allowed suffixes
   - Creates new contact and user records
   - Assigns roles based on company context (first user gets client_admin)

## Architecture

### Database Tables

1. `company_email_settings`
   - Stores allowed email suffixes for each company
   - Reference table in CitusDB environment
   - Includes self-registration toggle per suffix

2. `pending_registrations`
   - Tracks registration attempts and their status
   - Distributed table in CitusDB environment
   - Statuses: PENDING_VERIFICATION, VERIFIED, COMPLETED, EXPIRED

3. `verification_tokens`
   - Manages email verification tokens
   - Reference table in CitusDB environment
   - Includes expiration and usage tracking

### Security Measures

1. Rate Limiting
   - Registration attempts: 5 per hour per email
   - Verification attempts: 3 per 5 minutes per token
   - Email sending: 3 per hour per email
   - Includes user-friendly error messages with wait times
   - Memory-based implementation using rate-limiter-flexible

2. Token Security
   - 32-byte random tokens using crypto library
   - Base64URL encoding for URL safety
   - 24-hour expiration
   - One-time use only
   - Validation includes expiration and usage checks
   - Transaction-based token management

3. Audit Logging
   - Security event logging temporarily disabled (tenant context issue)
   - Will log registration attempts, verifications, and completions
   - Includes detailed event context and tenant isolation
   - Uses centralized audit logging system

### Registration Flow

1. User submits registration form
   - Validates rate limits for registration attempts
   - For contacts:
     * Verifies contact exists and is active
     * Checks for existing user account
     * Creates user with contact association
   - For email suffix:
     * Validates email domain against allowed suffixes
     * Determines company from email suffix
     * Creates pending registration with expiration
     * Generates and stores verification token
     * Validates email sending rate limit
     * Sends verification email using templated system

2. User verifies email
   - Clicks link in email with token and registration ID
   - System validates token:
     * Checks rate limits for verification attempts
     * Verifies token exists and hasn't been used
     * Confirms token hasn't expired
     * Validates registration status is PENDING_VERIFICATION
   - Updates token usage timestamp
   - Updates registration status to VERIFIED

3. System completes registration
   - Validates registration exists and is verified
   - Executes in a database transaction:
     * Creates contact record if needed
     * Creates user account
     * Assigns client role to user (client_admin role is managed separately through settings)
     * Updates registration status to COMPLETED
   - Handles rollback on any failure

## Maintenance

### Cleanup Jobs

Two cleanup jobs run hourly:

1. `cleanupExpiredRegistrations`
   - Finds registrations past 24-hour expiration
   - Updates status to EXPIRED
   - Logs cleanup events
   - Maintains registration record for audit purposes

2. `cleanupExpiredTokens`
   - Removes expired verification tokens
   - Only removes tokens that were never used
   - Preserves used tokens for audit trail
   - Runs after registration cleanup

### Monitoring

Monitor these aspects:

1. Registration Attempts
   - Watch for unusual patterns
   - Track success/failure rates
   - Monitor rate limit hits

2. Token Usage
   - Track verification success rates
   - Monitor token expiration patterns
   - Watch for repeated failures

3. Email Delivery
   - Monitor sending success rates
   - Track delivery delays
   - Watch for bounces

### Troubleshooting

Common issues and solutions:

1. Rate Limit Exceeded
   - System provides specific wait time in error message
   - Check logs for abuse patterns
   - Verify limit configurations in rate-limiter-flexible settings
   - Consider adjusting points or duration if needed

2. Token Verification Failures
   - Check token expiration (24-hour limit)
   - Verify email delivery through email service logs
   - Look for multiple verification attempts
   - Check if token was already used
   - Validate registration ID matches token

3. Role Assignment Issues
   - Verify role existence in roles table
   - Check tenant isolation in all related tables
   - Validate company settings and email suffix configuration
   - Verify first-user detection logic

## Administration

### Administration Interface

The system provides two main administration interfaces:

1. Email Registration Settings
   - Email Suffix Management:
     * Add new email suffixes with validation
     * Delete existing suffixes
     * View all configured suffixes in a data table
     * Case-insensitive suffix handling (automatically converted to lowercase)
   - Registration Controls:
     * Toggle self-registration per suffix using switches
     * Immediate effect on registration availability
     * Visual feedback for configuration status
     * Error handling for failed operations
   - User Interface Features:
     * Clean, card-based layout
     * Interactive data table for suffix management
     * Dropdown menus for suffix actions
     * Form validation and error messaging
     * Loading states during operations
   - Error Handling:
     * Displays error alerts for failed operations
     * Validates input before submission
     * Maintains state consistency after errors
     * Provides feedback for all user actions

2. User Management
   - Role Management:
     * View and edit user roles through user details drawer
     * Assign/remove client_admin role as needed
     * Manage role-based permissions
     * Maintain audit trail of role changes
   - User Controls:
     * Edit user details and status
     * Reset passwords (admin only)
     * Enable/disable user accounts
     * View user activity and roles

### Security Settings

Available controls:
- Rate limit configurations
- Token expiration times
- Email sending limits
- IP-based restrictions

## Best Practices

1. Email Suffixes
   - Use specific suffixes when possible
   - Avoid common email providers
   - Regularly review and update

2. Security
   - Monitor audit logs regularly
   - Review rate limits periodically
   - Keep email templates updated

3. Maintenance
   - Check cleanup job logs
   - Monitor database size
   - Review expired registrations

## Deployment

### Prerequisites
- PostgreSQL or CitusDB
- Node.js environment
- Email service configuration

### Configuration Steps
1. Run database migrations
2. Configure email service
3. Set environment variables
4. Enable cleanup jobs

### Rollback Procedures
1. Disable new registrations
2. Revert database migrations
3. Remove email settings

## Troubleshooting Guide

### Common Issues

1. Registration Fails
   - Check email suffix configuration
   - Verify rate limits
   - Check database connectivity

2. Verification Link Invalid
   - Check token expiration
   - Verify token usage
   - Check email delivery logs

3. Role Assignment Fails
   - Verify role existence
   - Check tenant configuration
   - Validate company settings

### Monitoring Checklist

Daily:
- Check registration success rates
- Monitor verification attempts
- Review security logs

Weekly:
- Analyze rate limit patterns
- Check cleanup job effectiveness
- Review expired registrations

Monthly:
- Audit email suffix configurations
- Review security settings
- Check system performance

## Support

For issues:
1. Check audit logs first
2. Review rate limit status
3. Verify email delivery
4. Check database consistency

## Future Improvements

Planned enhancements:
1. Enhanced rate limiting
2. IP-based restrictions
3. Improved monitoring
4. Additional security measures
