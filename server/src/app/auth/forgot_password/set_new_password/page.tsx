"use client";
import React, { useState, FormEvent, useEffect, Suspense  } from 'react'; // React imports

import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link'; // Next.js specific imports
import Image from 'next/image';

import { EyeOpenIcon, EyeClosedIcon, CheckCircledIcon, CrossCircledIcon } from '@radix-ui/react-icons';
import * as Form from '@radix-ui/react-form'; // Third-party library imports
import * as Label from '@radix-ui/react-label';


import { setNewPassword } from 'server/src/lib/actions/useRegister'; // Local imports
import { AlertProps, TPasswordCriteria } from 'server/src/interfaces';
import Alert from 'server/src/components/auth/Alert';


type FormData = {
  password: string;
  confirmPassword: string;
};


const SetNewPasswordContent: React.FC = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<AlertProps>({ type: 'success', title: '', message: '' });


  const searchParams = useSearchParams();
  const token = searchParams!.get('token');
  const router = useRouter();

  const [formData, setFormData] = useState<FormData>({
    password: '',
    confirmPassword: '',
  });

  const [passwordCriteria, setPasswordCriteria] = useState<TPasswordCriteria>({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecial: false,
  });

  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [passwordsMatch, setPasswordsMatch] = useState(true);

  useEffect(() => {
    if (formData.password) {
      setHasStartedTyping(true);
      const newCriteria = {
        minLength: formData.password.length >= 8,
        hasUppercase: /[A-Z]/.test(formData.password),
        hasLowercase: /[a-z]/.test(formData.password),
        hasNumber: /[0-9]/.test(formData.password),
        hasSpecial: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(formData.password),
      };
      setPasswordCriteria(newCriteria);
    }

    if (formData.confirmPassword) {
      setPasswordsMatch(formData.password === formData.confirmPassword);
    }
  }, [formData.password, formData.confirmPassword]);



  const allCriteriaMet = Object.values(passwordCriteria).every(Boolean);

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
    router.push('/auth/forgot_password/password_reset_confirmation'); 
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  const CriteriaIcon = ({ met }: { met: boolean }) => 
    !hasStartedTyping ? null : met ? <CheckCircledIcon className="h-4 w-4 text-green-500" /> : <CrossCircledIcon className="h-4 w-4 text-red-500" />;

  return (
    <div className="flex flex-col items-center pt-20 min-h-screen bg-white">
      <Alert
        type={alertInfo.type}
        title={alertInfo.title}
        message={alertInfo.message}
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
      />

      <div className="w-full max-w-md p-8 space-y-8 bg-white">
        <div className="text-center">
          <div className="inline-block align-middle content-center">
            <Image
              src="/images/avatar-purple-background.png"
              alt="Logo"
              width={60}
              height={60}
              className="rounded-full"
            />
          </div>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">Set new password</h2>
        </div>
        <Form.Root className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <Form.Field name="password">
            <div className="flex flex-col gap-2">
              <Label.Root className="text-sm font-medium text-gray-700" htmlFor="password">
                Password
              </Label.Root>
              <div className="relative">
                <Form.Control asChild>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                    value={formData.password}
                    onChange={handleInputChange}
                  />
                </Form.Control>
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400"
                >
                  {showPassword ? (
                    <EyeOpenIcon className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeClosedIcon className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
          </Form.Field>
          <Form.Field name="confirmPassword">
            <div className="flex flex-col gap-2">
              <Label.Root className="text-sm font-medium text-gray-700" htmlFor="confirmPassword">
                Confirm password
              </Label.Root>
              <div className="relative">
                <Form.Control asChild>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                  />
                </Form.Control>
              </div>
            </div>
          </Form.Field>
          {formData.confirmPassword && (
            <div className="flex items-center text-sm">
              {passwordsMatch ? (
                <CheckCircledIcon className="h-4 w-4 text-green-500 mr-2" />
              ) : (
                <CrossCircledIcon className="h-4 w-4 text-red-500 mr-2" />
              )}
              <span className={passwordsMatch ? "text-green-500" : "text-red-500"}>
                {passwordsMatch ? "Passwords match" : "Passwords do not match"}
              </span>
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-center items-center gap-4 text-xs text-gray-600">
            <div className="flex items-center">
              <CriteriaIcon met={passwordCriteria.minLength} />
              <span className="ml-2">8+ chars</span>
            </div>
            <div className="flex items-center">
              <CriteriaIcon met={passwordCriteria.hasUppercase} />
              <span className="ml-2">Uppercase</span>
            </div>
            <div className="flex items-center">
              <CriteriaIcon met={passwordCriteria.hasLowercase} />
              <span className="ml-2">Lowercase</span>
            </div>
            <div className="flex items-center">
              <CriteriaIcon met={passwordCriteria.hasNumber} />
              <span className="ml-2">Number</span>
            </div>
            <div className="flex items-center">
              <CriteriaIcon met={passwordCriteria.hasSpecial} />
              <span className="ml-2">Special char</span>
            </div>
          </div>
          <Form.Submit asChild>
            <button
              type="submit"
              className="w-full px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              Reset password
            </button>
          </Form.Submit>
        </Form.Root>
        <div className="text-center">
          <Link href="/auth/signin" className="text-sm font-medium text-purple-600 hover:text-purple-500">
            ← Back to log in
          </Link>
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