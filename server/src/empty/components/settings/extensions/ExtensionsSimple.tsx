/**
 * Empty Extensions Component for Community Edition
 * 
 * This component is used when the EE Extensions system is not available
 */
'use client';

import React from 'react';

export default function Extensions() {
  return (
    <div className="text-center py-8">
      <h3 className="text-lg font-medium text-gray-900 mb-2">Extensions Not Available</h3>
      <p className="text-gray-600">
        Extension management is available in the Enterprise Edition of Alga PSA.
      </p>
    </div>
  );
}