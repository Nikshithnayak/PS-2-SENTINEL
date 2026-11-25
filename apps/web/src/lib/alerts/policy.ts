import type { AlertLevel } from '@sentinel/shared';

export interface PolicyAlertInput {
  deteriorationIndex: number;
  level: AlertLevel;
  l1Score: number;
  l2Score: number;
  deviceSilent: boolean;
  ruleKey: string;
  isSynthetic: boolean;
}

export interface PolicyPatientSettings {
  quietHoursStart: string; // "HH:MM"
  quietHoursEnd: string;   // "HH:MM"
  timezone: string;
  dailyAlertBudget: number;
  sensitivityOffset: number; // clamped [-0.25, +0.25]
}

export interface PolicyHistoryContext {
  recentAssessmentLevels: AlertLevel[]; // newest first
  recentAlerts24h: Array<{
    id: string;
    ruleKey: string;
    level: AlertLevel;
    status: string;
    createdAt: Date;
    snoozedUntil: Date | null;
  }>;
  now?: Date;
}

export interface PolicyDecision {
  outcome: 'fire' | 'upgrade_existing' | 'auto_resolve' | 'suppress';
  reason: string;
  effectiveIndex: number;
  effectiveLevel: AlertLevel;
  existingAlertId?: string;
}

const COOLDOWN_MINUTES: Record<AlertLevel, number> = {
  stable: 0,
  watch: 240,
  warning: 90,
  urgent: 30,
};

const LEVEL_RANK: Record<AlertLevel, number> = {
  stable: 0,
  watch: 1,
  warning: 2,
  urgent: 3,
};

export function parseHhMmToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return ((h % 24) * 60 + (m % 60) + 1440) % 1440;
}

export function isWithinQuietHours(now: Date, startHhMm: string, endHhMm: string, timeZone: string): boolean {
  let localHhMm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  try {
    localHhMm = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(now);
  } catch {
    // Keep UTC fallback if invalid timezone string
  }
  const cur = parseHhMmToMinutes(localHhMm);
  const start = parseHhMmToMinutes(startHhMm);
  const end = parseHhMmToMinutes(endHhMm);
  if (start === end) return false;
  if (start < end) {
    return cur >= start && cur < end;
  }
  // Wraps midnight (e.g. 22:00 -> 06:00)
  return cur >= start || cur < end;
}

/**
 * Bounded adaptive feedback tuning: never nudges > 0.05 per feedback and stays within [-0.25, +0.25].
 */
export function computeBoundedSensitivityUpdate(
  currentOffset: number,
  feedback: 'helpful' | 'false_alarm' | 'expected_activity' | 'missed_symptom',
): number {
  const delta =
    feedback === 'false_alarm' || feedback === 'expected_activity'
      ? -0.05
      : feedback === 'missed_symptom'
        ? 0.05
        : 0.02;
  const next = Math.max(-0.25, Math.min(0.25, currentOffset + delta));
  return Number(next.toFixed(3));
}

/**
 * Evaluates anti-fatigue alerting rules:
 * 1. Bounded sensitivity offset (never blunting critical L1 >= 80 alerts)
 * 2. Hysteresis (< 24 auto-resolves open alerts; 24..30 holds without churn)
 * 3. N-of-M persistence (2-of-3 required for mild watch)
 * 4. Deduplication & cooldown with immediate upgrade path
 * 5. Daily alert budget & quiet hours (always bypassed by Urgent)
 */
export function evaluateAlertPolicy(
  input: PolicyAlertInput,
  settings: PolicyPatientSettings,
  history: PolicyHistoryContext,
  options?: { bypassPersistence?: boolean },
): PolicyDecision {
  const now = history.now ?? new Date();
  const clampedOffset = Math.max(-0.25, Math.min(0.25, settings.sensitivityOffset));

  // L1 severe safety bounds are NEVER suppressed downward by false-alarm sensitivity tuning
  const effectiveIndex =
    input.l1Score >= 80
      ? input.deteriorationIndex
      : Math.max(0, Math.min(100, Number((input.deteriorationIndex + clampedOffset * 20).toFixed(1))));

  const effectiveLevel: AlertLevel =
    effectiveIndex >= 80 || input.l1Score >= 82
      ? 'urgent'
      : effectiveIndex >= 55
        ? 'warning'
        : effectiveIndex >= 30 || input.deviceSilent
          ? 'watch'
          : 'stable';

  const openSameRule = history.recentAlerts24h.find(
    (a) => a.ruleKey === input.ruleKey && (a.status === 'open' || a.status === 'escalated'),
  );

  // Hysteresis auto-resolve when signal recovers comfortably below 24 (< 30 - 6pt hysteresis band)
  if (effectiveIndex < 24 && !input.deviceSilent) {
    if (openSameRule) {
      return {
        outcome: 'auto_resolve',
        reason: 'hysteresis_recovery_below_24',
        effectiveIndex,
        effectiveLevel: 'stable',
        existingAlertId: openSameRule.id,
      };
    }
    return {
      outcome: 'suppress',
      reason: 'below_threshold_stable',
      effectiveIndex,
      effectiveLevel: 'stable',
    };
  }

  if (effectiveLevel === 'stable') {
    return {
      outcome: 'suppress',
      reason: 'hysteresis_hold_zone',
      effectiveIndex,
      effectiveLevel: 'stable',
    };
  }

  // Respect active snooze except for Urgent escalation
  const snoozed = history.recentAlerts24h.find(
    (a) =>
      a.ruleKey === input.ruleKey &&
      a.status === 'snoozed' &&
      a.snoozedUntil &&
      a.snoozedUntil.getTime() > now.getTime(),
  );
  if (snoozed && effectiveLevel !== 'urgent') {
    return {
      outcome: 'suppress',
      reason: 'snoozed_until_expiry',
      effectiveIndex,
      effectiveLevel,
    };
  }

  // Upgrade existing open alert immediately if severity worsened
  if (openSameRule) {
    if (LEVEL_RANK[effectiveLevel] > LEVEL_RANK[openSameRule.level]) {
      return {
        outcome: 'upgrade_existing',
        reason: `severity_upgraded_${openSameRule.level}_to_${effectiveLevel}`,
        effectiveIndex,
        effectiveLevel,
        existingAlertId: openSameRule.id,
      };
    }
    return {
      outcome: 'suppress',
      reason: 'deduplicated_open_alert',
      effectiveIndex,
      effectiveLevel,
      existingAlertId: openSameRule.id,
    };
  }

  // Check cooldown on recently closed alerts with identical ruleKey
  const recentSameRule = history.recentAlerts24h.find((a) => a.ruleKey === input.ruleKey);
  if (recentSameRule) {
    const ageMin = (now.getTime() - recentSameRule.createdAt.getTime()) / 60_000;
    const reqCooldown = COOLDOWN_MINUTES[effectiveLevel];
    if (ageMin < reqCooldown && LEVEL_RANK[effectiveLevel] <= LEVEL_RANK[recentSameRule.level]) {
      return {
        outcome: 'suppress',
        reason: `cooldown_active_${Math.round(ageMin)}m_of_${reqCooldown}m`,
        effectiveIndex,
        effectiveLevel,
      };
    }
  }

  // N-of-M persistence: urgent triggers 1-of-1; warning triggers immediately on strong L2 (>=65)
  // or 2-of-3 recent; watch requires 2-of-3 (or deviceSilent notice)
  if (!options?.bypassPersistence && effectiveLevel === 'watch' && !input.deviceSilent) {
    const elevatedCount =
      1 +
      history.recentAssessmentLevels
        .slice(0, 2)
        .filter((lvl) => LEVEL_RANK[lvl] >= LEVEL_RANK.watch).length;
    if (elevatedCount < 2) {
      return {
        outcome: 'suppress',
        reason: 'nofm_persistence_waiting_for_confirmation',
        effectiveIndex,
        effectiveLevel,
      };
    }
  }

  // Daily budget & quiet hours (Urgent ALWAYS bypasses both!)
  if (effectiveLevel !== 'urgent') {
    if (history.recentAlerts24h.length >= settings.dailyAlertBudget) {
      return {
        outcome: 'suppress',
        reason: 'daily_alert_budget_reached',
        effectiveIndex,
        effectiveLevel,
      };
    }
    if (isWithinQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd, settings.timezone)) {
      return {
        outcome: 'suppress',
        reason: 'quiet_hours_non_urgent_deferred',
        effectiveIndex,
        effectiveLevel,
      };
    }
  }

  return {
    outcome: 'fire',
    reason: effectiveLevel === 'urgent' ? 'urgent_immediate_rule' : 'persistence_and_budget_passed',
    effectiveIndex,
    effectiveLevel,
  };
}
