/**
 * Restrained signature physiological hero visual:
 * - Zero continuous WebGL shader loop or GPU blur overhead so scrolling stays smooth.
 * - Matches the aqua-mint baseline tolerance ribbon and calm rhythm curve.
 */
export function PulseHeroVisual() {
  return (
    <div
      aria-label="Calm physiological personal baseline visualization"
      data-testid="pulse-static-fallback"
      className="relative h-56 w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-gradient-to-br from-[#1B3C53]/12 via-[#CBEAE5]/70 to-[#E3EEF5] sm:h-64"
    >
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

      <div className="pointer-events-none absolute bottom-3 left-4 z-10 rounded-full bg-[var(--bg-surface)] px-3 py-1 font-[family-name:var(--font-mono)] text-xs font-semibold">
        Calm Baseline · Tolerance Ribbon
      </div>
    </div>
  );
}
