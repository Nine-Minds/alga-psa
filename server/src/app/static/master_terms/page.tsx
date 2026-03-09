"use client";
import { useRouter } from 'next/navigation';

import * as Dialog from '@radix-ui/react-dialog';

export default function MasterTerms() {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-2xl">
        <h1 className="text-3xl font-bold text-blue-600 mb-4">Master Terms</h1>
        <p className="text-gray-700 mb-6">
          Welcome to our master terms page. Here we outline the general terms and conditions that govern your use of our services. Please read through these terms carefully and contact us if you have any questions.
        </p>
        <ul className="list-disc list-inside mb-6 text-gray-700">
          <li>Term 1: Lorem ipsum dolor sit amet, consectetur adipiscing elit.</li>
          <li>Term 2: Quisque ac eros vel justo venenatis fermentum.</li>
          <li>Term 3: Curabitur non justo nec mauris commodo aliquet.</li>
          <li>Term 4: Aliquam erat volutpat. Sed consequat libero at tortor cursus suscipit.</li>
        </ul>

        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button className="mt-4 mr-4 px-4 py-2 bg-indigo-600 text-white rounded-md shadow hover:bg-indigo-700 transition">
              Learn More
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/30" />
            <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-md shadow-lg max-w-sm">
              <Dialog.Title className="text-lg font-medium mb-2">More Details</Dialog.Title>
              <Dialog.Description className="text-sm text-gray-600 mb-4">
                For further details on each term, please visit our FAQ page or contact support for personalized assistance.
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
