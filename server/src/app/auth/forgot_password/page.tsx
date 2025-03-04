"use client";
import React, { useState, FormEvent } from 'react'; 

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link'; 

import * as Label from '@radix-ui/react-label';
import * as Form from '@radix-ui/react-form';

import { recoverPassword } from 'server/src/lib/actions/useRegister';


type FormData = {
  email: string;
};

const ForgotPassword: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    email: '',
  });

  const router = useRouter();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log('Password reset requested for:', formData.email);
    await recoverPassword(formData.email);
    router.push(`/auth/check_email?email=${formData.email}&type=forgot_password`);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  return (
    <div className="flex flex-col items-center pt-20 min-h-screen bg-white">
      <div className="w-full max-w-md p-8 space-y-8 bg-white">
        <div className="text-center">
          <div className="inline-block align-middle content-center">
            <Image
              src="/images/avatar-purple-background.png"
              alt="Pippa Wilkinson"
              width={60}
              height={60}
              className="rounded-full"
            />
          </div>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">Forgot password?</h2>
          <p className="mt-2 text-sm text-gray-600">No worries, we&apos;ll send you reset instructions.</p>
        </div>
        <Form.Root className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <Form.Field name="email">
            <div className="flex flex-col gap-2">
              <Label.Root className="text-sm font-medium text-gray-700" htmlFor="email">
                Email
              </Label.Root>
              <Form.Control asChild>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full px-3 py-2 placeholder-gray-400 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleInputChange}
                />
              </Form.Control>
            </div>
          </Form.Field>
          <Form.Submit asChild>
            <button
              type="submit"
              className="flex justify-center w-full px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
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

export default ForgotPassword;