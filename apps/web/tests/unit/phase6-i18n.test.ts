import { describe, expect, it } from 'vitest';
import { getCatalog } from '@/lib/i18n/catalog';

describe('Phase 6 Structured i18n Catalogs (EN / KN / HI)', () => {
  it('provides complete parity across English, Kannada, and Hindi dictionaries', () => {
    const en = getCatalog('en');
    const kn = getCatalog('kn');
    const hi = getCatalog('hi');

    for (const key of ['stable', 'watch', 'warning', 'urgent'] as const) {
      expect(en.status[key].length).toBeGreaterThan(5);
      expect(kn.status[key].length).toBeGreaterThan(5);
      expect(hi.status[key].length).toBeGreaterThan(5);
    }

    for (const act of ['feelOkay', 'notWell', 'why', 'readAloud', 'emergencyHelp'] as const) {
      expect(en.actions[act].length).toBeGreaterThan(3);
      expect(kn.actions[act].length).toBeGreaterThan(3);
      expect(hi.actions[act].length).toBeGreaterThan(3);
    }

    expect(kn.offlineBanner).toContain('112');
    expect(hi.offlineBanner).toContain('112');
  });
});
