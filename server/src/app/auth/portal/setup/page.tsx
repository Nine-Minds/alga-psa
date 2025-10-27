'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Eye, EyeOff, Lock, User, Building } from 'lucide-react';
import toast from 'react-hot-toast';
import { 
  verifyPortalToken, 
  completePortalSetup 
} from '@product/actions/portal-actions/portalInvitationActions';
import { signIn } from 'next-auth/react';

interface ContactInfo {
  contact_name_id: string;
  full_name: string;
  email: string;
  client_name: string;
}

export default function PortalSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [error, setError] = useState<string>('');
  
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  });

  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecialChar: false,
    passwordsMatch: false
  });

  useEffect(() => {
    if (!token) {
      setError('No invitation token provided');
      setIsLoading(false);
      return;
    }

    verifyToken();
  }, [token]);

  useEffect(() => {
    validatePassword();
  }, [formData.password, formData.confirmPassword]);

  const verifyToken = async () => {
    try {
      const result = await verifyPortalToken(token);
      
      if (result.success && result.contact) {
        setContactInfo(result.contact);
      } else {
        setError(result.error || 'Invalid or expired invitation token');
      }
    } catch (error) {
      console.error('Token verification error:', error);
      setError('Failed to verify invitation token');
    } finally {
      setIsLoading(false);
    }
  };

  const validatePassword = () => {
    const { password, confirmPassword } = formData;
    
    setPasswordRequirements({
      minLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /\d/.test(password),
      hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
      passwordsMatch: password === confirmPassword && password.length > 0
    });
  };

  const isPasswordValid = () => {
    const { minLength, hasUppercase, hasLowercase, hasNumber, hasSpecialChar, passwordsMatch } = passwordRequirements;
    return minLength && hasUppercase && hasLowercase && hasNumber && hasSpecialChar && passwordsMatch;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isPasswordValid()) {
      toast.error('Please ensure all password requirements are met');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await completePortalSetup(token, formData.password);
      
      if (result.success) {
        // Attempt auto sign-in with the new credentials
        try {
          const signinRes = await signIn('credentials', {
            username: result.username,
            password: formData.password,
            redirect: false
          });
          if (signinRes && (signinRes as any).error) {
            // Fallback to manual sign-in if auto sign-in fails
            toast.success('Account ready. Please sign in.');
            router.push('/auth/client-portal/signin?message=Account created successfully. Please sign in.');
          } else {
            toast.success('Welcome to the client portal!');
            router.push('/client-portal/dashboard');
          }
        } catch (e) {
          toast.success('Account ready. Please sign in.');
          router.push('/auth/client-portal/signin?message=Account created successfully. Please sign in.');
        }
      } else {
        toast.error(result.error || 'Failed to create account');
      }
    } catch (error) {
      console.error('Setup completion error:', error);
      toast.error('Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-32 bg-gray-200 rounded"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !contactInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600">Invalid Invitation</CardTitle>
            <CardDescription>
              There was a problem with your portal invitation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                {error || 'The invitation token is invalid or has expired. Please contact your service provider for a new invitation.'}
              </AlertDescription>
            </Alert>
            <Button 
              onClick={() => router.push('/auth/client-portal/signin')}
              id='btn=signin'
              className="w-full"
            >
              Go to Portal Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Set Up Portal Access
          </CardTitle>
          <CardDescription>
            Complete your client portal account setup
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Account Information */}
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4" />
              Account Information
            </div>
            
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span> {contactInfo.full_name}
              </div>
              <div>
                <span className="text-muted-foreground">Email:</span> {contactInfo.email}
              </div>
              <div className="flex items-center gap-1">
                <Building className="h-3 w-3" />
                <span className="text-muted-foreground">Client:</span> {contactInfo.client_name}
              </div>
            </div>
          </div>

          {/* Password Setup Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Enter your password"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  id={showPassword ? 'hide-password-button' : 'show-password-button'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  placeholder="Confirm your password"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Password Requirements */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Password Requirements</Label>
              <div className="space-y-1 text-xs">
                <div className={`flex items-center gap-2 ${passwordRequirements.minLength ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.minLength ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  At least 8 characters
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasUppercase ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasUppercase ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  One uppercase letter
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasLowercase ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasLowercase ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  One lowercase letter
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasNumber ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasNumber ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  One number
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.hasSpecialChar ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.hasSpecialChar ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  One special character
                </div>
                <div className={`flex items-center gap-2 ${passwordRequirements.passwordsMatch ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${passwordRequirements.passwordsMatch ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  Passwords match
                </div>
              </div>
            </div>

            <Button
              id="btn-create-account"
              type="submit"
              className="w-full"
              disabled={!isPasswordValid() || isSubmitting}
            >
              {isSubmitting ? 'Creating Account...' : 'Create Portal Account'}
            </Button>
          </form>

          <div className="text-center text-xs text-muted-foreground">
            Already have an account?{' '}
            <button
              onClick={() => router.push('/auth/client-portal/signin')}
              className="text-blue-600 hover:underline"
            >
              Sign in to portal
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
