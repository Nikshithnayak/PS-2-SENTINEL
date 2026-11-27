import { expect, type Page } from '@playwright/test';

export async function signUpViaUi(
  page: Page,
  opts: {
    name: string;
    email: string;
    password: string;
    role: 'patient' | 'caregiver' | 'clinician' | 'org_admin';
    expectedUrlPart: string;
  },
) {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Full Name').fill(opts.name);
  await page.getByLabel('Account Role').selectOption(opts.role);
  await page.getByLabel('Email Address').fill(opts.email);
  await page.getByLabel('Password').fill(opts.password);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.waitForURL(`**${opts.expectedUrlPart}*`);
}

export async function signInViaUi(
  page: Page,
  opts: {
    email: string;
    password: string;
    expectedUrlPart: string;
  },
) {
  await page.goto('/auth');
  await page.getByLabel('Email Address').fill(opts.email);
  await page.getByLabel('Password').fill(opts.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL(`**${opts.expectedUrlPart}*`);
}

/**
 * Generates realistic multi-day physiological telemetry CSV rows for real CSV import E2E flows
 * so the Python 3-layer baseline & Partial NEWS2 engine evaluates without any synthetic simulator.
 */
export function buildRealisticVitalsCsv(profile: 'febrile' | 'respiratory'): string {
  const lines = ['timestamp,metric,value,unit,context'];
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const totalDays = 16;
  const startMs = now.getTime() - totalDays * 24 * 3_600_000;

  for (let h = 0; h <= totalDays * 24; h += 2) {
    const ts = new Date(startMs + h * 3_600_000);
    const iso = ts.toISOString();
    const isRecent = h >= totalDays * 24 - 16;
    const isSleep = ts.getUTCHours() >= 17 || ts.getUTCHours() < 1;

    const rhr = isRecent
      ? profile === 'febrile'
        ? 86 + (h % 4)
        : 92 + (h % 3)
      : 63 + (isSleep ? -3 : 2) + (h % 3);
    const hrv = isRecent ? 18 : 36 + (h % 4);
    const spo2 = isRecent
      ? profile === 'respiratory'
        ? 89
        : 95
      : profile === 'respiratory'
        ? 95
        : 98;
    const rr = isRecent ? (profile === 'respiratory' ? 26 : 22) : 15;
    const temp = isRecent ? (profile === 'febrile' ? 1.3 : 0.6) : 0.0;
    const steps = isRecent ? 10 : isSleep ? 0 : 320;

    lines.push(`${iso},resting_heart_rate,${rhr},bpm,rest`);
    lines.push(`${iso},hrv_rmssd,${hrv},ms,rest`);
    lines.push(`${iso},spo2,${spo2},%,rest`);
    lines.push(`${iso},respiratory_rate,${rr},breaths/min,rest`);
    lines.push(`${iso},skin_temp_deviation,${temp},degC,rest`);
    lines.push(`${iso},steps,${steps},count,${isSleep ? 'sleep' : 'light_activity'}`);
  }

  return lines.join('\n');
}

export async function setupPatientCaregiverClinician(page: Page, suffix: string) {
  const password = 'SentinelReal#2026!';
  const patientEmail = `patient-${suffix}@example.com`;
  const caregiverEmail = `caregiver-${suffix}@example.com`;
  const clinicianEmail = `clinician-${suffix}@example.com`;

  await signUpViaUi(page, {
    name: 'Asha Menon',
    email: patientEmail,
    password,
    role: 'patient',
    expectedUrlPart: '/today',
  });

  // Invite caregiver + clinician on Care Circle BEFORE they sign up (tests auto-linking on registration)
  await page.goto('/settings/consent');
  await expect(page.getByText('DPDP Act 2023 Granular Consent Ledger')).toBeVisible();

  await page.getByLabel('Caregiver or clinician email').fill(caregiverEmail);
  await page.getByLabel('Relationship').selectOption('primary_caregiver');
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(caregiverEmail)).toBeVisible();

  await page.getByLabel('Caregiver or clinician email').fill(clinicianEmail);
  await page.getByLabel('Relationship').selectOption('clinician');
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(clinicianEmail)).toBeVisible();

  return { password, patientEmail, caregiverEmail, clinicianEmail };
}
