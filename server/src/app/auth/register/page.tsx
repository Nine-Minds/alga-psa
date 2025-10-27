"use client";
import { useState, useEffect } from 'react';

import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { EyeOpenIcon, EyeClosedIcon, CheckCircledIcon, CrossCircledIcon } from '@radix-ui/react-icons';
import * as Label from '@radix-ui/react-label';
import { AlertProps, TPasswordCriteria } from 'server/src/interfaces';
import { registerUser } from '@product/actions/useRegister';
import Alert from 'server/src/components/auth/Alert';
import { Input } from 'server/src/components/ui/Input';



export default function Register() {
  const [showPassword, setShowPassword] = useState(false);
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [passwordCriteria, setPasswordCriteria] = useState<TPasswordCriteria>({
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSpecial: false,
  });
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<AlertProps>({ type: 'success', title: '', message: '' });

  const router = useRouter();
  const [formData, setFormData] = useState({
    clientName: '',
    userName: '',
    email: '',
    password: '',
  });


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

  }, [formData.password]);



  const allCriteriaMet = Object.values(passwordCriteria).every(Boolean);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
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
      const wasSuccess = await registerUser({
        username: formData.userName,
        email: formData.email,
        password: formData.password,
        clientName: formData.clientName,
        user_type: 'internal'
      });
      if (wasSuccess) {
        router.push(`/auth/check-email?email=${formData.email}&type=register`);
      } else {
        setIsAlertOpen(true);
        setAlertInfo({
          type: 'error',
          title: 'Failed !!!',
          message: 'Please try again',
        });
      }
    } catch (error) {
      // Handle unexpected errors
    }
  };


  const handleGoogleSignIn = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      e.preventDefault();
      // In Next Auth v5, signIn triggers a redirect and doesn't return a result
      await signIn('google');
      // If we reach here, sign-in was initiated successfully
      console.log('Sign-up initiated, redirecting...');
    } catch (error) {
      console.error('Unexpected error during sign-in:', error);
      // Handle unexpected errors
    }
  };



  const CriteriaIcon = ({ met }: { met: boolean }) =>
    !hasStartedTyping ? null : met ? <CheckCircledIcon className="h-4 w-4 text-green-500" /> : <CrossCircledIcon className="h-4 w-4 text-red-500" />;

  return (
    <div className="flex min-h-screen bg-gray-100">

    <Alert
        type={alertInfo.type}
        title={alertInfo.title}
        message={alertInfo.message}
        isOpen={isAlertOpen}
        onClose={() => setIsAlertOpen(false)}
      />

      <div className="absolute top-4 left-8 flex items-center">
        <Image
                src="/images/avatar-purple-background.png"
                alt="Pippa Wilkinson"
                width={50}
                height={50}
                className="rounded-full mr-4 "
              />
          <span className="text-lg font-semibold text-gray-800">AI-Enhanced PSA Platform for MSPs</span>
        </div>

      {/* Left side with logo */}
      <div className="hidden lg:flex lg:w-1/2 bg-white p-12 flex-col justify-center items-center">
        <Image
          src="/images/avatar-purple-big.png"
          alt="Client Logo"
          width={200}
          height={200}
          className="rounded-full"
        />
        <p className="mt-4 text-center text-2xl font-bold text-gray-700">
          An open source PSA, <br />
          empowering the future of MSPs <br />
          with AI-driven insights and automation.
        </p>
      </div>

      {/* Right side with sign up form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center">
        <div className="max-w-md w-full space-y-8 p-8">
          <div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900 text-center">Sign up</h2>
            <p className="mt-2 text-sm text-gray-600 text-center">Start to use Alga MSP.</p>
          </div>
          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="space-y-4">
              <div>
                <Label.Root className="block text-sm font-medium text-gray-700">
                  Client name
                </Label.Root>
                <Input
                  type="text"
                  name="clientName"
                  value={formData.clientName}
                  onChange={handleChange}
                  required
                  placeholder="Enter your client name"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))] sm:text-sm"
                />
              </div>
              <div>
                <Label.Root className="block text-sm font-medium text-gray-700">
                  User Name
                </Label.Root>
                <Input
                  type="text"
                  name="userName"
                  value={formData.userName}
                  onChange={handleChange}
                  required
                  placeholder="Enter your user name"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))] sm:text-sm"
                />
              </div>
              <div>
                <Label.Root className="block text-sm font-medium text-gray-700">
                  Email
                </Label.Root>
                <Input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="Enter your email"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))] sm:text-sm"
                />
              </div>
              <div>

                <Label.Root className="block text-sm font-medium text-gray-700">
                  Password
                </Label.Root>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    placeholder="Create a password"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))] sm:text-sm"
                  />
                  <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showPassword ? (
                        <EyeOpenIcon className="h-5 w-5 text-gray-400" />
                      ) : (
                        <EyeClosedIcon className="h-5 w-5 text-gray-400" />
                      )}
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap justify-center items-center gap-3 text-xs text-gray-600">
                  <div className="flex items-center">
                    <CriteriaIcon met={passwordCriteria.minLength} />
                    <span className="ml-1">8+ chars</span>
                  </div>
                  <div className="flex items-center">
                    <CriteriaIcon met={passwordCriteria.hasUppercase} />
                    <span className="ml-1">Uppercase</span>
                  </div>
                  <div className="flex items-center">
                    <CriteriaIcon met={passwordCriteria.hasLowercase} />
                    <span className="ml-1">Lowercase</span>
                  </div>
                  <div className="flex items-center">
                    <CriteriaIcon met={passwordCriteria.hasNumber} />
                    <span className="ml-1">Number</span>
                  </div>
                  <div className="flex items-center">
                    <CriteriaIcon met={passwordCriteria.hasSpecial} />
                    <span className="ml-1">Special char</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[rgb(var(--color-primary-600))] hover:bg-[rgb(var(--color-primary-700))] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[rgb(var(--color-primary-500))]"
              >
                Sign up
              </button>
            </div>
          </form>

          {/* <div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[rgb(var(--color-primary-500))]"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.3081 10.2303C20.3081 9.55056 20.253 8.86711 20.1354 8.19836H10.7031V12.0492H16.1046C15.8804 13.2911 15.1602 14.3898 14.1057 15.0879V17.5866H17.3282C19.2205 15.8449 20.3081 13.2728 20.3081 10.2303Z" fill="#3F83F8"/>
                <path d="M10.7019 20.0006C13.3989 20.0006 15.6734 19.1151 17.3306 17.5865L14.1081 15.0879C13.2115 15.6979 12.0541 16.0433 10.7056 16.0433C8.09669 16.0433 5.88468 14.2832 5.091 11.9169H1.76562V14.4927C3.46322 17.8695 6.92087 20.0006 10.7019 20.0006V20.0006Z" fill="#34A853"/>
                <path d="M5.08857 11.9169C4.66969 10.6749 4.66969 9.33008 5.08857 8.08811V5.51233H1.76688C0.348541 8.33798 0.348541 11.667 1.76688 14.4927L5.08857 11.9169V11.9169Z" fill="#FBBC04"/>
                <path d="M10.7019 3.95805C12.1276 3.936 13.5055 4.47247 14.538 5.45722L17.393 2.60218C15.5852 0.904587 13.1858 -0.0287217 10.7019 0.000673888C6.92087 0.000673888 3.46322 2.13185 1.76562 5.51234L5.08732 8.08813C5.87733 5.71811 8.09302 3.95805 10.7019 3.95805V3.95805Z" fill="#EA4335"/>
              </svg>
              Sign up with Google
            </button>
          </div> */}

          <p className="mt-2 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link href="/auth/msp/signin" className="font-medium text-purple-600 hover:text-purple-500">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
