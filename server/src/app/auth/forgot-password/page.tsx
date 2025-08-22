'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { ArrowLeft, Mail, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { requestPasswordReset } from 'server/src/lib/actions/auth-actions/passwordResetActions';
import CustomSelect from 'server/src/components/ui/CustomSelect';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState('');
  const [userType, setUserType] = useState<'msp' | 'client'>('msp');

  const userTypeOptions = [
    { value: 'msp', label: 'Staff User' },
    { value: 'client', label: 'Client Portal User' }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset(email, userType);
      
      if (result.success) {
        setSubmitted(true);
        toast.success(result.message);
      } else {
        toast.error(result.error || 'Failed to send reset email');
      }
    } catch (error) {
      console.error('Password reset request error:', error);
      toast.error('An error occurred. Please try again later.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToLogin = () => {
    if (userType === 'client') {
      router.push('/client-portal/dashboard');
    } else {
      router.push('/');
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Check Your Email
            </CardTitle>
            <CardDescription>
              We've sent you a password reset link
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <Alert>
              <AlertDescription>
                If an account exists with the email address <strong>{email}</strong>, 
                you will receive a password reset link shortly.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">What's next?</h4>
                <ol className="text-sm text-gray-600 space-y-1">
                  <li>1. Check your email inbox</li>
                  <li>2. Click the reset link in the email</li>
                  <li>3. Set your new password</li>
                </ol>
              </div>

              <div className="p-4 bg-yellow-50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Didn't receive the email?</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Check your spam or junk folder</li>
                  <li>• Make sure you entered the correct email</li>
                  <li>• The link expires in 1 hour</li>
                </ul>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => {
                  setSubmitted(false);
                  setEmail('');
                }}
                variant="outline"
                className="w-full"
              >
                Request Another Link
              </Button>
              
              <Button
                onClick={handleBackToLogin}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </div>
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
            <Shield className="h-5 w-5" />
            Forgot Password
          </CardTitle>
          <CardDescription>
            Enter your email address and we'll send you a link to reset your password
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="userType">Account Type</Label>
              <CustomSelect
                options={userTypeOptions}
                value={userType}
                onValueChange={(value) => setUserType(value as 'msp' | 'client')}
                placeholder="Select account type"
              />
              <p className="text-xs text-muted-foreground">
                Select whether you're a staff member or a client portal user
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                autoComplete="email"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending Reset Link...' : 'Send Reset Link'}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            onClick={handleBackToLogin}
            variant="outline"
            className="w-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sign In
          </Button>

          <div className="text-center text-xs text-muted-foreground">
            Remember your password?{' '}
            <button
              onClick={handleBackToLogin}
              className="text-blue-600 hover:underline"
            >
              Sign in here
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}