'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name') as string,
      email: form.get('email') as string,
      company: form.get('company') as string || undefined,
    };

    try {
      const res = await fetch('/api/trials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start trial');
      }

      const { id } = await res.json();
      router.push(`/trial/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-lg w-full">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-3">
            Try Alga PSA
          </h1>
          <p className="text-lg text-gray-600">
            Get your own private instance of Alga PSA — the open-source PSA platform for MSPs.
            No credit card required. Your trial environment will be ready in minutes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white shadow-sm rounded-xl border border-gray-200 p-8 space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Your Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Work Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="jane@company.com"
            />
          </div>

          <div>
            <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1">
              Company <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="company"
              name="company"
              type="text"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Acme IT Services"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg px-4 py-3 text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? 'Starting your trial...' : 'Start Free Trial'}
          </button>

          <p className="text-xs text-gray-500 text-center">
            Your trial instance runs for 72 hours and is automatically cleaned up afterward.
          </p>
        </form>
      </div>
    </main>
  );
}
