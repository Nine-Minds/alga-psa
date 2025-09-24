'use client';

import React from 'react';
import { Ticket, FileText, Eye, History } from 'lucide-react';
import Image from 'next/image';

interface SignInPagePreviewProps {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  companyName: string;
}

export default function SignInPagePreview({ logoUrl, primaryColor, secondaryColor, companyName }: SignInPagePreviewProps) {
  // Convert hex to RGB
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  // Generate gradient style
  const getGradientStyle = () => {
    const primaryRgb = hexToRgb(primaryColor);
    const secondaryRgb = hexToRgb(secondaryColor);

    if (primaryRgb && secondaryRgb) {
      return {
        background: `linear-gradient(to bottom right,
          rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.05),
          rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.1),
          rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.1))`
      };
    }

    return {};
  };

  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-200 shadow-lg">
      {/* Preview container with custom gradient */}
      <div className="min-h-[400px]" style={getGradientStyle()}>
        {/* Header */}
        <div className="p-4 flex items-center">
          <div className="flex items-center">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName || 'Company Logo'}
                width={32}
                height={32}
                className="rounded-full mr-3 object-contain"
              />
            ) : (
              <Image
                src="/images/avatar-purple-background.png"
                alt="Logo"
                width={32}
                height={32}
                className="rounded-full mr-3"
              />
            )}
            <span className="text-lg font-bold text-gray-800">
              {companyName ? `${companyName} Client Portal` : 'Client Portal'}
            </span>
          </div>
        </div>

        <div className="flex">
          {/* Left side - miniature features */}
          <div className="w-1/2 p-4">
            <div className="bg-white rounded-full p-3 mb-3 mx-auto w-20 h-20 flex items-center justify-center shadow">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyName || 'Company Logo'}
                  className="w-12 h-12 object-contain"
                />
              ) : (
                <Ticket className="w-10 h-10" style={{ color: primaryColor }} />
              )}
            </div>
            <p className="text-xs font-semibold text-center text-gray-800 mb-2">Welcome to Your Client Portal</p>
            <div className="space-y-1">
              <div className="flex items-start space-x-1">
                <Ticket className="w-3 h-3 mt-0.5" style={{ color: primaryColor }} />
                <p className="text-xs text-gray-600">Submit Tickets</p>
              </div>
              <div className="flex items-start space-x-1">
                <Eye className="w-3 h-3 mt-0.5" style={{ color: primaryColor }} />
                <p className="text-xs text-gray-600">Track Status</p>
              </div>
              <div className="flex items-start space-x-1">
                <History className="w-3 h-3 mt-0.5" style={{ color: primaryColor }} />
                <p className="text-xs text-gray-600">Ticket History</p>
              </div>
              <div className="flex items-start space-x-1">
                <FileText className="w-3 h-3 mt-0.5" style={{ color: primaryColor }} />
                <p className="text-xs text-gray-600">Documentation</p>
              </div>
            </div>
          </div>

          {/* Right side - miniature sign in form */}
          <div className="w-1/2 p-4">
            <div className="bg-white rounded-lg shadow-md p-3">
              <h3 className="text-sm font-bold mb-2">Sign In</h3>
              <div className="space-y-2">
                <div className="h-6 bg-gray-100 rounded"></div>
                <div className="h-6 bg-gray-100 rounded"></div>
                <div className="h-6 rounded" style={{ backgroundColor: primaryColor, opacity: 0.8 }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}