"use client";
import React, { useState, FormEvent, useEffect, Suspense  } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { CheckCircledIcon, CrossCircledIcon } from '@radix-ui/react-icons';
import * as Form from '@radix-ui/react-form';
import { setNewPassword, getAccountInfoFromToken } from 'server/src/lib/actions/useRegister';
import { AlertProps, TPasswordCriteria } from 'server/src/interfaces';
import { Alert } from '@alga-psa/auth/client';
import { Alert as UIAlert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { User, Lock } from 'lucide-react';


type FormData = {
  password: string;
  confirmPassword: string;
};


const SetNewPasswordContent: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<AlertProps>({ type: 'success', title: '', message: '' });
  const [accountInfo, setAccountInfo] = useState<{
    name: string;
    email: string;
    username: string;
    accountType: string;
  } | null>(null);

  const searchParams = useSearchParams();
  const token = searchParams!.get('token');
  const portal = searchParams!.get('portal') || 'msp';
  const router = useRouter();

  const [formData, setFormData] = useState<FormData>({
    password: '',
    confirmPassword: '',
  });

  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecialChar: false,
    passwordsMatch: false
  });

  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [passwordsMatch, setPasswordsMatch] = useState(true);

  // Load account info from token
  useEffect(() => {
    const loadAccountInfo = async () => {
      if (token) {
        const info = await getAccountInfoFromToken(token, portal);
        if (info) {
          setAccountInfo(info);
        }
      }
    };
    loadAccountInfo();
  }, [token, portal]);

  useEffect(() => {
    if (formData.password) {
      setHasStartedTyping(true);
    }
    
    const newRequirements = {
      minLength: formData.password.length >= 8,
      hasUppercase: /[A-Z]/.test(formData.password),
      hasLowercase: /[a-z]/.test(formData.password),
      hasNumber: /[0-9]/.test(formData.password),
      hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(formData.password),
      passwordsMatch: formData.password !== '' && formData.confirmPassword !== '' && formData.password === formData.confirmPassword
    };
    
    setPasswordRequirements(newRequirements);
    setPasswordsMatch(formData.password === formData.confirmPassword);
  }, [formData.password, formData.confirmPassword]);



  const allCriteriaMet = Object.values(passwordRequirements).every(Boolean);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      console.log('Passwords do not match');
      setIsAlertOpen(true);
      setAlertInfo({
          type: 'error',
          title: 'Password ',
          message: 'Please ensure your password match.',
        });
      return;
    }
    if (!allCriteriaMet) {
      console.log('All password criteria must be met');
      setIsAlertOpen(true);
      setAlertInfo({
          type: 'error',
          title: 'Password ',
          message: 'Please ensure your password meets all the specified criteria.',
        });
      return;
    }

    if (!token) { 
      setIsAlertOpen(true);
      setAlertInfo({
          type: 'error',
          title: 'Warning!!!',
          message: 'It is missing client information.',
        });
      return; 
    }
    const wasSuccess = await setNewPassword(formData.password, token);
    if (!wasSuccess) { 
      setIsAlertOpen(true);
        setAlertInfo({
          type: 'error',
          title: 'Failed !!!',
          message: 'Please try again. If the error persist please contact support',
        });
      return; 
    }
    console.log('New password set')
    router.push(`/auth/password-reset/confirmation?portal=${portal}`); 
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  const themeColor = portal === 'client' ? 'blue' : 'purple';
  const bgGradient = portal === 'client' 
    ? 'bg-gradient-to-br from-blue-50 to-indigo-100' 
    : 'bg-gradient-to-br from-purple-50 via-purple-100 to-indigo-100';

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${bgGradient}`}>
      <Alert
        type={alertInfo.type}
        title={alertInfo.title}
        message={alertInfo.message}
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
      />

      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          
          <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2 flex items-center justify-center gap-2">
            <Lock className="w-6 h-6" />
              Reset Your Password</h2>
            <p className="text-gray-600 mt-1">Set a new password for your account</p>
          </div>

          {/* Account Information Section */}
          {accountInfo && (
            <UIAlert variant="info" className="mb-6">
              <User className="h-4 w-4" />
              <AlertDescription>
                <h3 className="font-semibold mb-3">Account Information</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex">
                    <span className="text-gray-500 w-28">Name:</span>
                    <span className="font-medium">{accountInfo.name}</span>
                  </div>
                  <div className="flex">
                    <span className="text-gray-500 w-28">Email:</span>
                    <span className="font-medium">{accountInfo.email}</span>
                  </div>
                  <div className="flex">
                    <span className="text-gray-500 w-28">Username:</span>
                    <span className="font-medium">{accountInfo.username}</span>
                  </div>
                  <div className="flex">
                    <span className="text-gray-500 w-28">Account Type:</span>
                    <span className="font-medium">{accountInfo.accountType}</span>
                  </div>
                </div>
              </AlertDescription>
            </UIAlert>
          )}

          <Form.Root className="space-y-4" onSubmit={handleSubmit}>
            {/* New Password Field */}
            <Form.Field name="password">
              <div className="space-y-2">
                <Label
                className="text-sm font-medium text-gray-700" htmlFor="password">
                  New Password
                </Label>
                <div className="relative">
                  <Form.Control asChild>
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-1 focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))]"
                      value={formData.password}
                      onChange={handleInputChange}
                    />
                  </Form.Control>
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </Form.Field>

            {/* Confirm Password Field */}
            <Form.Field name="confirmPassword">
              <div className="space-y-2">
                <Label
                 className="text-sm font-medium text-gray-700" htmlFor="confirmPassword">
                  Confirm New Password
                </Label>
                <div className="relative">
                  <Form.Control asChild>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      placeholder="Confirm your new password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-1 focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))]"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                    />
                  </Form.Control>
                  <button 
                    type="button" 
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </Form.Field>

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

            {/* Submit Button */}
            <Form.Submit asChild>
              <Button
                id="reset-password-button"
                type="submit"
                className="w-full"
                disabled={!allCriteriaMet || !passwordsMatch || !formData.confirmPassword}
              >
                Reset Password
              </Button>
            </Form.Submit>
          </Form.Root>

          {/* Back to sign in link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Remember your password?{' '}
              <Link 
                href={portal === 'client' ? '/auth/client-portal/signin' : '/auth/msp/signin'} 
                className={`font-medium ${
                  themeColor === 'blue' 
                    ? 'text-blue-600 hover:text-blue-500' 
                    : 'text-purple-600 hover:text-purple-500'
                }`}
              >
                Sign in instead
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};


const SetNewPassword: React.FC = () => {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SetNewPasswordContent />
    </Suspense>
  );
};

export default SetNewPassword;
