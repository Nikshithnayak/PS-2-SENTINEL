'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './providers';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
    >
      {theme === 'light' ? (
        <>
          <Moon className="h-4 w-4" aria-hidden="true" />
          <span>Dark</span>
        </>
      ) : (
        <>
          <Sun className="h-4 w-4" aria-hidden="true" />
          <span>Light</span>
        </>
      )}
    </button>
  );
}
