import React from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import Image from 'next/image';

function Error({ statusCode }: { statusCode?: number }) {
    const title = statusCode === 404 ? 'We lost this page' : 'Something went wrong';
    const description = statusCode === 404
        ? "We searched high and low, but couldn't find what you're looking for. Let's find a better place for you to go."
        : "We're sorry, but something went wrong on our end. Please try again later or go back to the home page.";

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-white text-center px-4">
            <div className="mb-8 w-32 h-32 rounded-full overflow-hidden">
                <Image 
                    src="/images/avatar-purple-background.png" 
                    alt={statusCode?.toString() || 'Error'} 
                    width={300}
                    height={300}
                    className="w-full h-full object-cover"
                />
            </div>
            <h2 className="text-1xl font-bold mb-8 text-purple-500">{statusCode || 'Error'}</h2>
            <h1 className="text-4xl font-bold mb-4">{title}</h1>
            <p className="text-gray-600 mb-8 max-w-md">{description}</p>
            <Link
                href="/"
                className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 transition-colors flex items-center"
            >
                <ArrowLeftIcon className="mr-2 h-5 w-5" />
                Go back
            </Link>
        </div>
    );
}

Error.getInitialProps = ({ res, err }: { res: any; err: any }) => {
    const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
    return { statusCode };
};

export default Error;