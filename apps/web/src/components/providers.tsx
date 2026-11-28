'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BleWatchProvider } from '@/components/ingest/ble-watch-provider';
import { PwaOfflineBanner } from '@/components/pwa-offline-banner';

type Theme = 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    window.localStorage.removeItem('sentinel-theme');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'light', toggleTheme: () => {} }}>
      <QueryClientProvider client={queryClient}>
        <BleWatchProvider>
          <MotionConfig reducedMotion="user">
            <PwaOfflineBanner />
            {children}
          </MotionConfig>
        </BleWatchProvider>
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
