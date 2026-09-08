'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function InstagramCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Processing...');
  const [error, setError] = useState('');

  useEffect(() => {
    async function handleCallback() {
      try {
        const code = searchParams.get('code');
        const error_param = searchParams.get('error');
        const error_description = searchParams.get('error_description');

        if (error_param) {
          throw new Error(error_description || error_param);
        }

        if (!code) {
          throw new Error('No authorization code received');
        }

        setStatus('Exchanging code for token...');

        // Get the stored token from localStorage to identify the user
        const token = localStorage.getItem('dream4deals_token');
        if (!token) {
          throw new Error('Please sign in first');
        }

        // Send the code to backend
        const res = await fetch(`${API_URL}/api/auth/instagram-callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ code })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setStatus('✓ Instagram connected successfully!');
        setTimeout(() => {
          router.push('/studio');
        }, 2000);
      } catch (e) {
        setError(e.message);
        setStatus('Connection failed');
      }
    }

    handleCallback();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold mb-6">Instagram Connection</h1>
        <p className="text-lg mb-4">{status}</p>
        {error && <p className="text-red-500">{error}</p>}
      </div>
    </div>
  );
}
