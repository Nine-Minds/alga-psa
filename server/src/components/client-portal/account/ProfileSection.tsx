'use client';

import { Card } from "server/src/components/ui/Card";
import { Input } from "server/src/components/ui/Input";
import { TextArea } from "server/src/components/ui/TextArea";
import { Button } from "server/src/components/ui/Button";
import { PhoneInput } from "server/src/components/ui/PhoneInput";
import { useState, useEffect } from 'react';
import { getCompanyProfile, updateCompanyProfile, type CompanyProfile } from "server/src/lib/actions/account";
import { validateCompanyName, validateEmailAddress, validatePhoneNumber, validateAddress } from "server/src/lib/utils/clientFormValidation";

interface ValidationErrors {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export default function ProfileSection() {
  const [profile, setProfile] = useState<CompanyProfile>({
    name: '',
    email: '',
    phone: '',
    address: '',
    notes: ''
  });
  const [phoneCountryCode, setPhoneCountryCode] = useState(() => {
    // Default country detection for phone input
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split('-');
      const detectedCountry = parts[parts.length - 1]?.toUpperCase();
      return detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry) ? detectedCountry : 'US';
    } catch (e) {
      return 'US';
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await getCompanyProfile();
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, []);

  const validateProfile = (): boolean => {
    const errors: ValidationErrors = {};
    let isValid = true;

    // Required fields - enterprise validation
    const nameError = validateCompanyName(profile.name);
    if (nameError) {
      errors.name = nameError;
      isValid = false;
    }

    // Email validation - enterprise grade
    const emailError = validateEmailAddress(profile.email);
    if (emailError) {
      errors.email = emailError;
      isValid = false;
    }

    // Phone validation - enterprise grade (optional but must be valid if provided)
    if (profile.phone && profile.phone.trim()) {
      const phoneError = validatePhoneNumber(profile.phone);
      if (phoneError) {
        errors.phone = phoneError;
        isValid = false;
      }
    }

    // Address validation - enterprise grade (optional but must be valid if provided)
    if (profile.address && profile.address.trim()) {
      const addressError = validateAddress(profile.address);
      if (addressError) {
        errors.address = addressError;
        isValid = false;
      }
    }

    setValidationErrors(errors);
    return isValid;
  };

  const sanitizeInput = (input: string): string => {
    // Remove any HTML tags
    return input.replace(/<[^>]*>/g, '')
      // Convert special characters to HTML entities
      .replace(/[&<>"']/g, (char) => {
        const entities: { [key: string]: string } = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        };
        return entities[char];
      })
      // Trim whitespace
      .trim();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    
    if (!validateProfile()) {
      return;
    }

    setIsSaving(true);

    try {
      // Sanitize all inputs before saving
      const sanitizedProfile = {
        ...profile,
        name: sanitizeInput(profile.name),
        email: sanitizeInput(profile.email),
        phone: sanitizeInput(profile.phone),
        address: sanitizeInput(profile.address),
        notes: sanitizeInput(profile.notes)
      };

      await updateCompanyProfile(sanitizedProfile);
      setSuccessMessage('Profile updated successfully');
      setProfile(sanitizedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading profile...</div>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="p-6">
        <div className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Company Name *
            </label>
            <Input
              id="name"
              value={profile.name}
              onChange={(e) => {
                setProfile(prev => ({ ...prev, name: e.target.value }));
                if (validationErrors.name) {
                  setValidationErrors(prev => ({ ...prev, name: undefined }));
                }
              }}
              className={validationErrors.name ? 'border-red-500' : ''}
            />
            {validationErrors.name && (
              <p className="mt-1 text-sm text-red-500">{validationErrors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email Address *
            </label>
            <Input
              id="email"
              type="email"
              value={profile.email}
              onChange={(e) => {
                setProfile(prev => ({ ...prev, email: e.target.value }));
                if (validationErrors.email) {
                  setValidationErrors(prev => ({ ...prev, email: undefined }));
                }
              }}
              className={validationErrors.email ? 'border-red-500' : ''}
            />
            {validationErrors.email && (
              <p className="mt-1 text-sm text-red-500">{validationErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              Phone Number
            </label>
            <PhoneInput
              value={profile.phone}
              onChange={(value) => {
                setProfile(prev => ({ ...prev, phone: value }));
                if (validationErrors.phone) {
                  setValidationErrors(prev => ({ ...prev, phone: undefined }));
                }
              }}
              countryCode={phoneCountryCode}
              onCountryChange={(countryCode) => setPhoneCountryCode(countryCode)}
              error={!!validationErrors.phone}
            />
            {validationErrors.phone && (
              <p className="mt-1 text-sm text-red-500">{validationErrors.phone}</p>
            )}
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium mb-1">
              Address
            </label>
            <Input
              id="address"
              value={profile.address}
              onChange={(e) => {
                setProfile(prev => ({ ...prev, address: e.target.value }));
                if (validationErrors.address) {
                  setValidationErrors(prev => ({ ...prev, address: undefined }));
                }
              }}
              className={validationErrors.address ? 'border-red-500' : ''}
            />
            {validationErrors.address && (
              <p className="mt-1 text-sm text-red-500">{validationErrors.address}</p>
            )}
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-medium mb-1">
              Notes
            </label>
            <TextArea
              id="notes"
              value={profile.notes}
              onChange={(e) => setProfile(prev => ({ ...prev, notes: e.target.value }))}
              rows={4}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {successMessage && (
            <p className="text-sm text-green-500">{successMessage}</p>
          )}

          <div className="flex justify-end">
            <Button
              id="save-profile-button"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
