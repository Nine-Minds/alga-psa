import React from 'react';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { QuestionMarkCircledIcon } from '@radix-ui/react-icons';

interface GeneralDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

const GeneralDialog: React.FC<GeneralDialogProps> = ({ isOpen, onClose, onConfirm }) => {
    return (
        <AlertDialog.Root open={isOpen}>
        <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 bg-black/50" />
            <AlertDialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden min-w-[300px] max-w-md w-full">
                <div className="p-4 bg-purple-100">
                <div className="flex justify-center">
                    <QuestionMarkCircledIcon className="w-12 h-12 text-purple-600" />
                </div>
                </div>
                <div className="px-4 py-3 text-center">
                <AlertDialog.Title className="text-lg font-semibold text-gray-900">
                    You do not have an account with us
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-sm text-gray-500">
                    Do you want to create one?
                </AlertDialog.Description>
                <div className="mt-4 flex justify-center space-x-2">
                    <AlertDialog.Cancel asChild>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                        Cancel
                    </button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                        Create Account
                    </button>
                    </AlertDialog.Action>
                </div>
                </div>
            </div>
            </AlertDialog.Content>
        </AlertDialog.Portal>
        </AlertDialog.Root>
    );
};

export default GeneralDialog;