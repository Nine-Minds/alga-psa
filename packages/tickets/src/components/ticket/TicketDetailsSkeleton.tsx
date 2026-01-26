'use client';

import React from 'react';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';

export function TicketDetailsSkeleton() {
  return (
    <div className="space-y-6 p-4">
      {/* Header skeleton */}
      <div className="flex items-center space-x-5 mb-4">
        <Skeleton className="h-10 w-24" /> {/* Back button */}
        <Skeleton className="h-6 w-20" /> {/* Ticket number */}
        <Skeleton className="h-8 w-64" /> {/* Title */}
      </div>

      {/* Created/Updated info skeleton */}
      <div className="flex items-center space-x-5 mb-5">
        <Skeleton className="h-5 w-40" /> {/* Created info */}
        <Skeleton className="h-5 w-40" /> {/* Updated info */}
      </div>

      <div className="flex gap-6">
        {/* Main content skeleton */}
        <div className="flex-grow col-span-2 space-y-6">
          {/* Ticket info skeleton */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <Skeleton className="h-8 w-48 mb-4" /> {/* Title */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-8 w-32" /> {/* Dropdown */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-8 w-32" /> {/* Dropdown */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-8 w-32" /> {/* Dropdown */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-8 w-32" /> {/* Dropdown */}
              </div>
              <div className="col-span-2">
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-8 w-48" /> {/* Category picker */}
              </div>
            </div>
            <div className="mb-6">
              <Skeleton className="h-6 w-32 mb-2" /> {/* Description label */}
              <Skeleton className="h-24 w-full" /> {/* Description content */}
            </div>
          </div>

          {/* Conversation skeleton */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <Skeleton className="h-7 w-32" /> {/* Comments header */}
              <Skeleton className="h-10 w-32" /> {/* Add comment button */}
            </div>
            <Skeleton className="h-10 w-full mb-4" /> {/* Tabs */}
            <div className="space-y-6">
              {/* Comment items */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex space-x-4">
                  <Skeleton className="h-10 w-10 rounded-full" /> {/* Avatar */}
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-48" /> {/* Name and date */}
                    <Skeleton className="h-20 w-full" /> {/* Comment content */}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar skeleton */}
        <div className="w-96 space-y-6">
          {/* Time entry skeleton */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <Skeleton className="h-6 w-32 mb-2" /> {/* Time entry header */}
            <Skeleton className="h-8 w-full mb-4" /> {/* Timer display */}
            <div className="flex justify-center space-x-2 mb-4">
              <Skeleton className="h-10 w-24" /> {/* Start/pause button */}
              <Skeleton className="h-10 w-24" /> {/* Reset button */}
            </div>
            <Skeleton className="h-5 w-24 mb-2" /> {/* Description label */}
            <Skeleton className="h-10 w-full mb-4" /> {/* Description input */}
            <Skeleton className="h-10 w-full" /> {/* Add time entry button */}
          </div>

          {/* Contact info skeleton */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <Skeleton className="h-6 w-32 mb-2" /> {/* Contact info header */}
            <div className="space-y-4">
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-5 w-48" /> {/* Contact name */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-5 w-48" /> {/* Created by */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-5 w-48" /> {/* Client */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-5 w-48" /> {/* Phone */}
              </div>
              <div>
                <Skeleton className="h-5 w-20 mb-2" /> {/* Label */}
                <Skeleton className="h-5 w-48" /> {/* Email */}
              </div>
            </div>
          </div>

          {/* Agent team skeleton */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <Skeleton className="h-6 w-32 mb-2" /> {/* Agent team header */}
            <div>
              <Skeleton className="h-5 w-32 mb-2" /> {/* Primary agent label */}
              <div className="flex items-center space-x-2 p-2">
                <Skeleton className="h-8 w-8 rounded-full" /> {/* Avatar */}
                <div className="flex flex-col">
                  <Skeleton className="h-5 w-32" /> {/* Agent name */}
                  <Skeleton className="h-4 w-24 mt-1" /> {/* Scheduled hours */}
                </div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-5 w-40" /> {/* Additional agents label */}
                <Skeleton className="h-8 w-8" /> {/* Add button */}
              </div>
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between p-2">
                  <div className="flex items-center space-x-2">
                    <Skeleton className="h-8 w-8 rounded-full" /> {/* Avatar */}
                    <div className="flex flex-col">
                      <Skeleton className="h-5 w-32" /> {/* Agent name */}
                      <Skeleton className="h-4 w-24 mt-1" /> {/* Scheduled hours */}
                    </div>
                  </div>
                  <Skeleton className="h-8 w-16" /> {/* Remove button */}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}