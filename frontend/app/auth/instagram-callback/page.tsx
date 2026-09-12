'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = '';

export default function InstagramCallbackPage() {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState('Processing...');
  const [error, setError] = useState('');

  useEffect(() => {
    async function handleCallback() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const error_param = params.get('error');
        const error_description = params.get('error_description');

        if (error_param) {
          throw new Error(error_description || error_param);
        }

        if (!code) {
          throw new Error('No authorization code received');
        }

        setStatus('Exchanging code for token...');

        const state = params.get('state');
        if (!state) throw new Error('Missing OAuth state. Please try connecting again.');

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(`${API_URL}/api/auth/instagram-callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code, state }),
          signal: controller.signal,
        });
        window.clearTimeout(timeout);

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        localStorage.setItem('dream4deals_token', data.token);

        setStatus('✓ Instagram connected successfully!');
        setTimeout(() => {
          router.push('/studio');
        }, 2000);
      } catch (e) {
        setError(e instanceof Error && e.name === 'AbortError'
          ? 'Dream4Deals did not respond within 20 seconds. Confirm the frontend and backend are running, then try again.'
          : e instanceof Error ? e.message : 'Instagram connection failed.');
        setStatus('Connection failed');
      }
    }

    if (started.current) return;
    started.current = true;
    handleCallback();
  }, [router]);

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
