export type CaregiverReplyCommand = 'acknowledge' | 'escalate' | 'snooze';

/**
 * Parses caregiver reply text (`OK`, `CALL ME`, `SNOOZE`, `/ok`, `/callme`, `/snooze`).
 */
export function parseCaregiverReplyCommand(text: string): CaregiverReplyCommand | null {
  const firstLine = text.trim().split(/\r?\n/)[0]?.trim().toUpperCase() ?? '';
  const cleaned = firstLine.replace(/^\//, '').trim();
  if (/^(OK|ACK|ACKNOWLEDGE|GOT IT|FINE)\b/.test(cleaned)) return 'acknowledge';
  if (/^(CALL\s*ME|CALLME|ESCALATE|URGENT|HELP)\b/.test(cleaned)) return 'escalate';
  if (/^(SNOOZE|LATER)\b/.test(cleaned)) return 'snooze';
  return null;
}
