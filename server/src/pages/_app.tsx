import type { AppProps } from 'next/app';
import '../app/globals.css';
import { PostHogProvider } from '../components/PostHogProvider';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <PostHogProvider>
      <Component {...pageProps} />
    </PostHogProvider>
  );
}