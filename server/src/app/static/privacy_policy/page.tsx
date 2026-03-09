"use client";
import { useRouter } from 'next/navigation';

import * as Dialog from '@radix-ui/react-dialog';

export default function PrivacyPolicy() {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-2xl">
        <h1 className="text-3xl font-bold text-blue-600 mb-4">Privacy Policy</h1>
        <p className="text-gray-700 mb-6">
          Your privacy is important to us. This privacy policy explains what personal data we collect and how we use it. Please read the following information carefully to understand our practices regarding your personal data and how we treat it.
        </p>
        <ul className="list-disc list-inside mb-6 text-gray-700">
          <li>Collection: We collect information you provide directly to us.</li>
          <li>Usage: We use your information to provide, maintain, and improve our services.</li>
          <li>Sharing: We do not share your personal information with third parties without your consent, except as required by law.</li>
          <li>Security: We implement security measures to protect your information.</li>
        </ul>

        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button className="mt-4 mr-4 px-4 py-2 bg-indigo-600 text-white rounded-md shadow hover:bg-indigo-700 transition">
              More Details
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/30" />
            <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-md shadow-lg max-w-sm">
              <Dialog.Title className="text-lg font-medium mb-2">Detailed Privacy Policy</Dialog.Title>
              <Dialog.Description className="text-sm text-gray-600 mb-4">
                For further details on how we handle your data, please contact our support team or visit our support page for comprehensive information.
              </Dialog.Description>
              <Dialog.Close asChild>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition">
                  Close
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <button
          onClick={handleBack}
          className="mt-6 px-4 py-2 bg-gray-600 text-white rounded-md shadow hover:bg-gray-700 transition"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
