/**
 * Client-safe privacy helper methods
 * This file contains only methods that can be safely used in client components
 */
export class PrivacyHelper {
  /**
   * Simple hash function for browser environments
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Anonymize an email address by hashing the local part
   */
  static anonymizeEmail(email: string): string {
    if (!email || !email.includes('@')) return 'anonymous@example.com';
    
    const [local, domain] = email.split('@');
    const hashedLocal = this.simpleHash(local).substring(0, 8);
    return `${hashedLocal}@${domain}`;
  }
  
  /**
   * Anonymize an IP address
   */
  static anonymizeIP(ip: string): string {
    if (!ip) return '0.0.0.0';
    
    if (ip.includes(':')) {
      // IPv6 - zero out last 80 bits
      const parts = ip.split(':');
      return parts.slice(0, 3).join(':') + '::';
    } else {
      // IPv4 - zero out last octet
      const parts = ip.split('.');
      return parts.slice(0, 3).join('.') + '.0';
    }
  }
  
  /**
   * Hash a string for consistent anonymization
   */
  static hashString(input: string): string {
    return this.simpleHash(input).substring(0, 16);
  }
  
  /**
   * Sanitize properties to remove PII
   */
  static sanitizeProperties(props: Record<string, any>): Record<string, any> {
    const sanitized = { ...props };
    
    // Remove common PII fields
    const piiFields = [
      'email', 'emails', 'email_address',
      'name', 'names', 'full_name', 'first_name', 'last_name', 'username',
      'phone', 'phone_number', 'mobile', 'telephone',
      'address', 'street', 'city', 'state', 'zip', 'postal_code', 'country',
      'ssn', 'social_security_number', 'tax_id',
      'credit_card', 'card_number', 'cvv', 'card_holder',
      'password', 'token', 'api_key', 'secret',
      'ip_address', 'ip', 'user_agent',
      'date_of_birth', 'dob', 'birthday',
      'bank_account', 'routing_number', 'iban',
    ];
    
    // Remove fields recursively
    const removeFields = (obj: any, fields: string[]): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(item => removeFields(item, fields));
      }
      
      const cleaned = { ...obj };
      
      for (const key of Object.keys(cleaned)) {
        const lowerKey = key.toLowerCase();
        
        // Check if key matches any PII field
        if (fields.some(field => lowerKey.includes(field))) {
          delete cleaned[key];
        } else if (typeof cleaned[key] === 'object') {
          cleaned[key] = removeFields(cleaned[key], fields);
        }
      }
      
      return cleaned;
    };
    
    return removeFields(sanitized, piiFields);
  }
  
  /**
   * Check if usage statistics should be collected
   */
  static shouldCollectTelemetry(): boolean {
    // In browser, we can't access process.env directly
    // This would need to be passed from the server or configured differently
    return true;
  }
  
  /**
   * Get deployment type
   */
  static getDeploymentType(): 'hosted' | 'on-premise' {
    // In browser, default to on-premise
    return 'on-premise';
  }
  
  /**
   * Get instance identifier (hashed for privacy)
   * Client-safe version that uses browser or hostname
   */
  static getInstanceId(): string {
    const instanceId = typeof window !== 'undefined' ? 
      window.location.hostname : 'server';
    return this.hashString(instanceId);
  }
}