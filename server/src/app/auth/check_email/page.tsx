"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { recoverPassword } from 'server/src/lib/actions/useRegister';

const CheckEmailContent: React.FC = () => {
  const [message, setMessage] = useState({
    title: '',
    text: '',
    subText: '',
    buttonText: ''
  });

  const searchParams = useSearchParams();
  const email = searchParams!.get('email');
  const type = searchParams!.get('type');

  useEffect(() => {
    if (type === 'forgot_password') {
      setMessage({
        title: 'Check your email',
        text: `We sent a password reset link to ${email || 'your email'}`,
        subText: "Didn't receive the email?",
        buttonText: 'Open Gmail'
      });
    } else if (type === 'register') {
      setMessage({
        title: 'Check your email',
        text: `We sent a verification link to ${email || 'your email'}`,
        subText: "Didn't receive the email? Contact Us",
        buttonText: 'Open Gmail'
      });
    }
  }, [type, email]);

  const handleOpenGmail = () => {
    window.open('https://mail.google.com', '_blank');
  };

  const resend = async () => {
    console.log('Resend email');
    if (!email) return;
    await recoverPassword(email);
  };

  return (
    <div className="flex flex-col items-center pt-20 min-h-screen bg-white">
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
          <h2 className="mt-6 text-2xl font-bold text-gray-900">{message.title}</h2>
          <p className="mt-2 text-sm text-gray-600">{message.text}</p>
        </div>
        <div className="mt-8 space-y-6">
          <button
            onClick={handleOpenGmail}
            className="flex justify-center w-full px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            {message.buttonText}
          </button>
          <p className="text-center text-sm text-gray-600">
            {message.subText}{' '}
            {type === 'forgot_password' && (
              <button onClick={resend} className="font-medium text-purple-600 hover:text-purple-500">
                Click to resend
              </button>
            )}
          </p>
        </div>
        <div className="text-center">
          <Link href="/auth/signin" className="text-sm font-medium text-purple-600 hover:text-purple-500">
            ← Back to log in
          </Link>
        </div>
      </div>
    </div>
  );
};

const CheckEmail: React.FC = () => {
    return (
        <Suspense fallback={<div>Loading...</div>}>
        <CheckEmailContent />
        </Suspense>
    );
};

export default CheckEmail;