'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Eye, EyeOff, Lock, User, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { 
  verifyPasswordResetToken, 
  completePasswordReset 
} from 'server/src/lib/actions/auth-actions/passwordResetActions';

interface UserInfo {
  user_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name?: string;
  user_type: 'internal' | 'client';
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string>('');
  const [resetComplete, setResetComplete] = useState(false);
  
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
      setError('No reset token provided');
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
      const result = await verifyPasswordResetToken(token);
      
      if (result.success && result.user) {
        setUserInfo(result.user);
      } else {
        setError(result.error || 'Invalid or expired reset token');
      }
    } catch (error) {
      console.error('Token verification error:', error);
      setError('Failed to verify reset token');
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
      const result = await completePasswordReset(token, formData.password);
      
      if (result.success) {
        setResetComplete(true);
        toast.success(result.message);
      } else {
        toast.error(result.error || 'Failed to reset password');
      }
    } catch (error) {
      console.error('Password reset error:', error);
      toast.error('Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToLogin = () => {
    if (userInfo?.user_type === 'client') {
      router.push('/client-portal/dashboard');
    } else {
      router.push('/');
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

  if (error || !userInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600">Invalid Reset Link</CardTitle>
            <CardDescription>
              There was a problem with your password reset link
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                {error || 'The reset link is invalid or has expired. Please request a new password reset.'}
              </AlertDescription>
            </Alert>
            <Button 
              id="request-new-link-button"
              onClick={() => router.push('/auth/forgot-password')}
              className="w-full"
            >
              Request New Reset Link
            </Button>
            <Button
              id="back-to-sign-in-button"
              onClick={handleBackToLogin}
              variant="outline"
              className="w-full"
            >
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (resetComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 font-bold">
              <CheckCircle className="h-5 w-5" />
              Password Reset Complete
            </CardTitle>
            <CardDescription>
              Your password has been successfully reset
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-green-900">Success!</h4>
                  <p className="text-sm text-green-700">
                    Your password has been successfully updated. You can now sign in with your new password.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-purple-50 rounded-lg">
              <h4 className="font-medium text-sm mb-2 text-purple-900">What's next?</h4>
              <ul className="text-sm text-purple-700 space-y-1">
                <li>• Return to the sign in page</li>
                <li>• Use your new password to access your account</li>
                <li>• Contact support if you have any issues</li>
              </ul>
            </div>

            <Button 
              id="go-to-sign-in-button"
              onClick={handleBackToLogin}
              className="w-full"
            >
              Go to Sign In
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
            Reset Your Password
          </CardTitle>
          <CardDescription>
            Set a new password for your account
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* User Information */}
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4" />
              Account Information
            </div>
            
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span> {userInfo.first_name} {userInfo.last_name || ''}
              </div>
              <div>
                <span className="text-muted-foreground">Email:</span> {userInfo.email}
              </div>
              <div>
                <span className="text-muted-foreground">Username:</span> {userInfo.username}
              </div>
              <div>
                <span className="text-muted-foreground">Account Type:</span> {userInfo.user_type === 'client' ? 'Client Portal' : 'MSP User'}
              </div>
            </div>
          </div>

          {/* Password Reset Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Enter your new password"
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
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  placeholder="Confirm your new password"
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
              id="btn-reset-password"
              type="submit"
              className="w-full"
              disabled={!isPasswordValid() || isSubmitting}
            >
              {isSubmitting ? 'Resetting Password...' : 'Reset Password'}
            </Button>
          </form>

          <div className="text-center text-xs text-muted-foreground">
            Remember your password?{' '}
            <button
              onClick={handleBackToLogin}
              className="text-blue-600 hover:underline"
            >
              Sign in instead
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}