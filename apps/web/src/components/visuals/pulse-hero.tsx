'use client';

import { useEffect, useRef, useState } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';

/**
 * Restrained signature physiological hero visual:
 * - Strict max 1 WebGL context on landing page, never behind clinical charts/tables.
 * - Pauses automatically via IntersectionObserver when scrolled off-screen.
 * - Renders static accessible SVG pulse + baseline ribbon when `prefers-reduced-motion: reduce`
 *   is active or WebGL is unavailable.
 */
export function PulseHeroVisual() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [webglReady, setWebglReady] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(mq.matches);
    syncMotion();
    mq.addEventListener('change', syncMotion);

    let hasWebgl = false;
    try {
      const testCanvas = document.createElement('canvas');
      hasWebgl = Boolean(
        testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'),
      );
    } catch {
      hasWebgl = false;
    }
    setWebglReady(hasWebgl);

    const el = containerRef.current;
    let observer: IntersectionObserver | null = null;
    if (el && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry) setInView(entry.isIntersecting);
        },
        { threshold: 0.1 },
      );
      observer.observe(el);
    }

    return () => {
      mq.removeEventListener('change', syncMotion);
      observer?.disconnect();
    };
  }, []);

  const showShader = !reducedMotion && webglReady;

  return (
    <div
      ref={containerRef}
      aria-label="Calm physiological personal baseline visualization"
      className="relative h-56 w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] sm:h-64"
    >
      {showShader ? (
        <div data-testid="pulse-webgl-canvas" className="absolute inset-0">
          <MeshGradient
            colors={['#0F766E', '#115E59', '#FAF8F4', '#D97706']}
            speed={inView ? 0.25 : 0}
            style={{ width: '100%', height: '100%', opacity: 0.32 }}
          />
        </div>
      ) : (
        <div
          data-testid="pulse-static-fallback"
          className="absolute inset-0 bg-gradient-to-br from-[var(--status-stable-bg)] via-[var(--bg-surface)] to-[var(--bg-elevated)]"
        />
      )}

      {/* Calm physiological waveform & personal normal tolerance band overlay */}
      <svg
        viewBox="0 0 600 180"
        role="img"
        aria-label="Personal baseline normal tolerance ribbon and calm rhythm trace"
        className="relative z-10 h-full w-full p-4"
      >
        <rect
          x="16"
          y="58"
          width="568"
          height="64"
          rx="12"
          fill="currentColor"
          className="text-[var(--brand-primary)] opacity-10"
        />
        <line
          x1="16"
          y1="90"
          x2="584"
          y2="90"
          stroke="currentColor"
          strokeDasharray="6 6"
          strokeWidth="1.5"
          className="text-[var(--brand-primary)] opacity-45"
        />
        <path
          d="M 16 92 C 70 86, 110 95, 160 88 C 210 80, 240 66, 260 66 C 280 66, 300 102, 330 94 C 375 84, 420 96, 470 87 C 520 79, 555 91, 584 89"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="text-[var(--brand-primary)]"
        />
        <circle cx="260" cy="66" r="5" fill="currentColor" className="text-[var(--status-watch)]" />
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-4 z-10 rounded-full bg-[var(--bg-surface)]/90 px-3 py-1 font-[family-name:var(--font-mono)] text-xs font-semibold backdrop-blur-sm">
        {showShader ? 'Ambient Rhythm · WebGL Active' : 'Static Rhythm · Reduced Motion Safe'}
      </div>
    </div>
  );
}
