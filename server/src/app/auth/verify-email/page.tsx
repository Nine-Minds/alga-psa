"use client";
import { useEffect, useState, useRef, Suspense  } from 'react'; 

import { useRouter, useSearchParams } from 'next/navigation'; 

import { verifyRegisterUser } from '@alga-psa/auth/actions';


const VerifyEmailContent = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams!.get('token');
    const [countdown, setCountdown] = useState(5);
    const [verificationSuccess, setVerificationSuccess] = useState(false);
    const [verificationMessage, setVerificationMessage] = useState('');
    const hasRun = useRef(false);


    useEffect(() => {
        const verifyToken = async () => {
            if (token && !hasRun.current) {
                hasRun.current = true;
                try {
                    const {message, wasSuccess} = await verifyRegisterUser(token);
                    setVerificationSuccess(wasSuccess);
                    setVerificationMessage(message);
                } catch (error) {
                    console.error("Verification failed:", error);
                    setVerificationSuccess(false);
                    setVerificationMessage('Unknow error verifying token');
                }
            }
        };

        verifyToken();
    }, [token]);


    useEffect(() => {
        const interval = setInterval(() => {
        setCountdown((prev) => prev - 1);
        }, 1000);

        // Redirect after 10 seconds
        if (countdown <= 0) {
        clearInterval(interval);
        router.push('/auth/msp/signin');
        }

        return () => clearInterval(interval);
    }, [countdown, router]);

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
            
            {
                token
                ?
                verificationSuccess
                ?
                <>
                    <h1 className="text-3xl font-bold text-blue-600 mb-4">Welcome!</h1>
                    <p className="text-gray-700 mb-6">
                    Your email has been successfully verified. You will be redirected to the sign in page shortly.
                    </p>
                </>
                :
                <>
                    <h1 className="text-3xl font-bold text-blue-600 mb-4">Process Error!</h1>
                    <p className="text-gray-700 mb-6">
                        {verificationMessage}
                    </p>
                </>
                :
                <>
                    <h1 className="text-3xl font-bold text-blue-600 mb-4">Error!</h1>
                    <p className="text-gray-700 mb-6">
                    Verification process required a token. Please try again.
                    </p>
                </>
            }
            <p className="text-gray-500 mb-4">Redirecting in {countdown} seconds...</p>
            <button
            onClick={() => router.push('/auth/msp/signin')}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md shadow hover:bg-indigo-700 transition"
            >
            Go to Sign In
            </button>
        </div>
        </div>
    );
};

const VerifyEmail: React.FC = () => {
    return (
    <Suspense fallback={<div>Loading...</div>}>
        <VerifyEmailContent />
    </Suspense>
    );
};

export default VerifyEmail;
