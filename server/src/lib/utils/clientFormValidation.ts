import { z } from 'zod';
import { validateEmail, validateUrl } from '../api/schemas/common';

// Enhanced validation utilities for client forms
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

// Company name validation - must be meaningful, not just numbers/symbols
export function validateCompanyName(name: string): string | null {
  if (!name.trim()) {
    return 'Company name is required';
  }
  
  if (name.trim().length < 2) {
    return 'Company name must be at least 2 characters long';
  }
  
  if (name.trim().length > 100) {
    return 'Company name must be less than 100 characters';
  }
  
  // Check if name is just numbers, symbols, or single character
  const trimmedName = name.trim();
  if (/^[\d\s\-_!@#$%^&*()+=\[\]{}|;':",./<>?`~]+$/.test(trimmedName)) {
    return 'Company name must contain letters and be meaningful';
  }
  
  // Check for minimum meaningful content (at least one letter)
  if (!/[a-zA-Z]/.test(trimmedName)) {
    return 'Company name must contain at least one letter';
  }
  
  return null;
}

// Website URL validation - must be a valid URL format
export function validateWebsiteUrl(url: string): string | null {
  if (!url.trim()) {
    return null; // URL is optional
  }
  
  const trimmedUrl = url.trim();
  
  // Check if it's just "1" or other meaningless values
  if (trimmedUrl === '1' || /^[\d\s\-_!@#$%^&*()+=\[\]{}|;':",./<>?`~]+$/.test(trimmedUrl)) {
    return 'Please enter a valid website URL (e.g., https://example.com)';
  }
  
  // Add protocol if missing
  let fullUrl = trimmedUrl;
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    fullUrl = 'https://' + trimmedUrl;
  }
  
  try {
    const urlObj = new URL(fullUrl);
    
    // Basic domain validation
    if (!urlObj.hostname || urlObj.hostname.length < 3) {
      return 'Please enter a valid website URL';
    }
    
    // Must have a domain extension
    if (!urlObj.hostname.includes('.')) {
      return 'Please enter a valid website URL with a domain extension';
    }
    
    return null;
  } catch {
    return 'Please enter a valid website URL (e.g., https://example.com)';
  }
}

// Email validation with enhanced checks
export function validateEmailAddress(email: string): string | null {
  if (!email.trim()) {
    return null; // Email is optional in some contexts
  }
  
  const trimmedEmail = email.trim();
  
  // Check for emoji or clearly invalid patterns
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedEmail)) {
    return 'Email address cannot contain emojis';
  }
  
  // Basic format validation
  if (!validateEmail(trimmedEmail)) {
    return 'Please enter a valid email address';
  }
  
  // Additional checks for meaningless entries
  if (trimmedEmail === '1@1.1' || trimmedEmail.includes('test@test') || trimmedEmail === 'a@a.a') {
    return 'Please enter a valid business email address';
  }
  
  return null;
}

// Phone number validation
export function validatePhoneNumber(phone: string): string | null {
  if (!phone.trim()) {
    return null; // Phone is optional
  }
  
  const trimmedPhone = phone.trim();
  
  // Check for emoji or clearly invalid patterns
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedPhone)) {
    return 'Phone number cannot contain emojis';
  }
  
  // Remove common formatting characters for validation
  const digitsOnly = trimmedPhone.replace(/[\s\-\(\)\+\.]/g, '');
  
  // Check if it's meaningful (not just "1" or similar)
  if (digitsOnly.length < 7) {
    return 'Please enter a valid phone number';
  }
  
  // Check if it's all the same digit or clearly fake
  if (/^(\d)\1+$/.test(digitsOnly) || digitsOnly === '1234567890') {
    return 'Please enter a valid phone number';
  }
  
  return null;
}

// Postal code validation
export function validatePostalCode(postalCode: string, countryCode: string = 'US'): string | null {
  if (!postalCode.trim()) {
    return null; // Postal code is optional
  }
  
  const trimmedCode = postalCode.trim();
  
  // Check for emoji
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedCode)) {
    return 'Postal code cannot contain emojis';
  }
  
  // Country-specific validation
  switch (countryCode.toUpperCase()) {
    case 'US':
      // US ZIP codes: 12345 or 12345-6789
      if (!/^\d{5}(-\d{4})?$/.test(trimmedCode)) {
        return 'Please enter a valid US ZIP code (e.g., 12345 or 12345-6789)';
      }
      break;
    case 'CA':
      // Canadian postal codes: A1B 2C3
      if (!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(trimmedCode)) {
        return 'Please enter a valid Canadian postal code (e.g., A1B 2C3)';
      }
      break;
    case 'GB':
    case 'UK':
      // UK postal codes (simplified validation)
      if (!/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(trimmedCode)) {
        return 'Please enter a valid UK postal code';
      }
      break;
    default:
      // Generic validation - at least some alphanumeric content
      if (!/^[A-Z0-9\s\-]{3,10}$/i.test(trimmedCode)) {
        return 'Please enter a valid postal code';
      }
  }
  
  return null;
}

// City name validation
export function validateCityName(city: string): string | null {
  if (!city.trim()) {
    return null; // City is optional
  }
  
  const trimmedCity = city.trim();
  
  // Check for emoji
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedCity)) {
    return 'City name cannot contain emojis';
  }
  
  if (trimmedCity.length < 2) {
    return 'City name must be at least 2 characters long';
  }
  
  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(trimmedCity)) {
    return 'City name must contain letters';
  }
  
  // Basic pattern validation (letters, spaces, hyphens, apostrophes)
  if (!/^[a-zA-Z\s\-'\.]+$/.test(trimmedCity)) {
    return 'City name contains invalid characters';
  }
  
  return null;
}

// Address validation
export function validateAddress(address: string): string | null {
  if (!address.trim()) {
    return null; // Address is optional
  }
  
  const trimmedAddress = address.trim();
  
  // Check for emoji
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedAddress)) {
    return 'Address cannot contain emojis';
  }
  
  if (trimmedAddress.length < 5) {
    return 'Address must be at least 5 characters long';
  }
  
  // Must contain at least one letter and one number for a complete address
  if (!/[a-zA-Z]/.test(trimmedAddress) || !/\d/.test(trimmedAddress)) {
    return 'Please enter a complete street address with number and name';
  }
  
  return null;
}

// Contact name validation
export function validateContactName(name: string): string | null {
  if (!name.trim()) {
    return null; // Contact name is optional
  }
  
  const trimmedName = name.trim();
  
  // Check for emoji
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedName)) {
    return 'Contact name cannot contain emojis';
  }
  
  if (trimmedName.length < 2) {
    return 'Contact name must be at least 2 characters long';
  }
  
  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(trimmedName)) {
    return 'Contact name must contain letters';
  }
  
  // Basic pattern validation (letters, spaces, hyphens, apostrophes, periods)
  if (!/^[a-zA-Z\s\-'\.]+$/.test(trimmedName)) {
    return 'Contact name contains invalid characters';
  }
  
  return null;
}

// Industry validation
export function validateIndustry(industry: string): string | null {
  if (!industry.trim()) {
    return null; // Industry is optional
  }
  
  const trimmedIndustry = industry.trim();
  
  // Check for emoji
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedIndustry)) {
    return 'Industry cannot contain emojis';
  }
  
  if (trimmedIndustry.length < 2) {
    return 'Industry must be at least 2 characters long';
  }
  
  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(trimmedIndustry)) {
    return 'Industry must contain letters';
  }
  
  // Prevent meaningless entries
  if (/^[\d\s\-_!@#$%^&*()+=\[\]{}|;':",./<>?`~]+$/.test(trimmedIndustry)) {
    return 'Please enter a valid industry name';
  }
  
  return null;
}

// State/Province validation
export function validateStateProvince(stateProvince: string): string | null {
  if (!stateProvince.trim()) {
    return null; // State is optional
  }
  
  const trimmedState = stateProvince.trim();
  
  // Check for emoji
  if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(trimmedState)) {
    return 'State/Province cannot contain emojis';
  }
  
  if (trimmedState.length < 2) {
    return 'State/Province must be at least 2 characters long';
  }
  
  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(trimmedState)) {
    return 'State/Province must contain letters';
  }
  
  // Basic pattern validation for state/province names
  if (!/^[a-zA-Z\s\-\.]+$/.test(trimmedState)) {
    return 'State/Province contains invalid characters';
  }
  
  return null;
}

// Comprehensive form validation function
export function validateClientForm(formData: {
  companyName: string;
  websiteUrl?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}): ValidationResult {
  const errors: Record<string, string> = {};
  
  // Required field validation
  const companyNameError = validateCompanyName(formData.companyName);
  if (companyNameError) {
    errors.companyName = companyNameError;
  }
  
  // Optional field validation
  if (formData.websiteUrl) {
    const websiteError = validateWebsiteUrl(formData.websiteUrl);
    if (websiteError) {
      errors.websiteUrl = websiteError;
    }
  }
  
  if (formData.email) {
    const emailError = validateEmailAddress(formData.email);
    if (emailError) {
      errors.email = emailError;
    }
  }
  
  if (formData.phone) {
    const phoneError = validatePhoneNumber(formData.phone);
    if (phoneError) {
      errors.phone = phoneError;
    }
  }
  
  if (formData.address) {
    const addressError = validateAddress(formData.address);
    if (addressError) {
      errors.address = addressError;
    }
  }
  
  if (formData.city) {
    const cityError = validateCityName(formData.city);
    if (cityError) {
      errors.city = cityError;
    }
  }
  
  if (formData.postalCode) {
    const postalError = validatePostalCode(formData.postalCode, formData.countryCode);
    if (postalError) {
      errors.postalCode = postalError;
    }
  }
  
  if (formData.contactName) {
    const contactNameError = validateContactName(formData.contactName);
    if (contactNameError) {
      errors.contactName = contactNameError;
    }
  }
  
  if (formData.contactEmail) {
    const contactEmailError = validateEmailAddress(formData.contactEmail);
    if (contactEmailError) {
      errors.contactEmail = contactEmailError;
    }
  }
  
  if (formData.contactPhone) {
    const contactPhoneError = validatePhoneNumber(formData.contactPhone);
    if (contactPhoneError) {
      errors.contactPhone = contactPhoneError;
    }
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

// Zod schemas for type-safe validation
export const clientFormSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters long').max(100, 'Company name must be less than 100 characters').refine(
    (name) => {
      const trimmedName = name.trim();
      return /[a-zA-Z]/.test(trimmedName) && !/^[\d\s\-_!@#$%^&*()+=\[\]{}|;':",./<>?`~]+$/.test(trimmedName);
    },
    'Company name must contain letters and be meaningful'
  ),
  websiteUrl: z.string().optional().refine(
    (url) => {
      if (!url || !url.trim()) return true;
      return validateWebsiteUrl(url) === null;
    },
    'Please enter a valid website URL'
  ),
  email: z.string().optional().refine(
    (email) => {
      if (!email || !email.trim()) return true;
      return validateEmailAddress(email) === null;
    },
    'Please enter a valid email address'
  ),
  phone: z.string().optional().refine(
    (phone) => {
      if (!phone || !phone.trim()) return true;
      return validatePhoneNumber(phone) === null;
    },
    'Please enter a valid phone number'
  ),
  address: z.string().optional().refine(
    (address) => {
      if (!address || !address.trim()) return true;
      return validateAddress(address) === null;
    },
    'Please enter a valid address'
  ),
  city: z.string().optional().refine(
    (city) => {
      if (!city || !city.trim()) return true;
      return validateCityName(city) === null;
    },
    'Please enter a valid city name'
  ),
  postalCode: z.string().optional(),
  countryCode: z.string().optional(),
  contactName: z.string().optional().refine(
    (name) => {
      if (!name || !name.trim()) return true;
      return validateContactName(name) === null;
    },
    'Please enter a valid contact name'
  ),
  contactEmail: z.string().optional().refine(
    (email) => {
      if (!email || !email.trim()) return true;
      return validateEmailAddress(email) === null;
    },
    'Please enter a valid email address'
  ),
  contactPhone: z.string().optional().refine(
    (phone) => {
      if (!phone || !phone.trim()) return true;
      return validatePhoneNumber(phone) === null;
    },
    'Please enter a valid phone number'
  )
});