"use client";
import React, { useState, FormEvent } from 'react'; 
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link'; 
import * as Label from '@radix-ui/react-label';
import * as Form from '@radix-ui/react-form';
import { recoverPassword } from '@product/actions/useRegister';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import toast from 'react-hot-toast';

type FormData = {
  email: string;
};

const MspForgotPassword: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    email: '',
  });

  const router = useRouter();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log('Password reset requested for MSP user:', formData.email);
    
    // Always show success message for security - don't reveal if email exists
    await recoverPassword(formData.email, 'msp');
    toast.success('If an account exists with this email, a password reset link has been sent.');
    router.push(`/auth/check-email?email=${formData.email}&type=forgot_password&portal=msp`);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  return (
    <div className="flex flex-col items-center pt-20 min-h-screen bg-gradient-to-br from-purple-50 via-purple-100 to-indigo-100">
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <div className="inline-block align-middle content-center">
            <Image
              src="/images/avatar-purple-background.png"
              alt="AlgaPSA Logo"
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
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full px-3 py-2 placeholder-gray-400 border border-gray-300 rounded-md shadow-sm appearance-none focus:outline-none focus:ring-[rgb(var(--color-primary-500))] focus:border-[rgb(var(--color-primary-500))] sm:text-sm"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleInputChange}
                />
              </Form.Control>
            </div>
          </Form.Field>
          <div className="flex justify-center">
            <Form.Submit asChild>
              <Button
                id="send-password-reset-button"
                variant="default"
                type="submit"
                className="w-full"
              >
                Send Reset Link
              </Button>
            </Form.Submit>
          </div>
        </Form.Root>
        <div className="text-center">
          <Link href="/auth/msp/signin" className="text-sm font-medium text-purple-600 hover:text-purple-500">
            ← Back to log in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default MspForgotPassword;