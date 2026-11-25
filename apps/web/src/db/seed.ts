import { encryptPhi, hashApiKey } from '@sentinel/shared';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from './index.ts';
import {
  account,
  apiKeys,
  careCircleMembers,
  consentGrants,
  medications,
  patientProfiles,
  user,
} from './schema.ts';

const DEFAULT_PHI_KEY =
  process.env.PHI_ENCRYPTION_KEY ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const SEED_IDS = {
  patientUserId: 'usr-patient-ramesh',
  caregiverUserId: 'usr-caregiver-kavitha',
  secondaryCaregiverUserId: 'usr-caregiver-arjun',
  clinicianUserId: 'usr-clinician-shetty',
  adminUserId: 'usr-admin-nitte',
  unlinkedUserId: 'usr-caregiver-unlinked',
  patientProfileId: '11111111-1111-4111-8111-111111111111',
  demoIngestApiKey: 'snt_live_demo_ramesh_ingest_key_2026',
};

export async function seedDatabase(): Promise<{ seeded: boolean }> {
  return withSystemDb(async (tx) => {
    const demoPasswordHash = await hashPassword(
      process.env.SEED_DEMO_PASSWORD ?? 'SentinelDemo#2026',
    );

    const existing = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, SEED_IDS.patientProfileId))
      .limit(1);

    if (existing.length > 0) {
      const demoIds = [
        SEED_IDS.patientUserId,
        SEED_IDS.caregiverUserId,
        SEED_IDS.secondaryCaregiverUserId,
        SEED_IDS.clinicianUserId,
        SEED_IDS.adminUserId,
        SEED_IDS.unlinkedUserId,
      ];
      await tx
        .delete(account)
        .where(and(eq(account.providerId, 'credential'), inArray(account.userId, demoIds)));

      for (const uid of demoIds) {
        await tx.insert(account).values({
          id: `acc-seed-${uid}`,
          accountId: uid,
          providerId: 'credential',
          userId: uid,
          password: demoPasswordHash,
        });
      }
      return { seeded: false };
    }

    const demoUsers = [
      {
        id: SEED_IDS.patientUserId,
        name: 'Ramesh Pai',
        email: 'ramesh@sentinel.local',
        role: 'patient',
        locale: 'kn',
      },
      {
        id: SEED_IDS.caregiverUserId,
        name: 'Kavitha Pai',
        email: 'kavitha@sentinel.local',
        role: 'caregiver',
        locale: 'en',
      },
      {
        id: SEED_IDS.secondaryCaregiverUserId,
        name: 'Arjun Pai',
        email: 'arjun@sentinel.local',
        role: 'caregiver',
        locale: 'en',
      },
      {
        id: SEED_IDS.clinicianUserId,
        name: 'Dr. Arvind Shetty',
        email: 'dr.shetty@sentinel.local',
        role: 'clinician',
        locale: 'en',
      },
      {
        id: SEED_IDS.adminUserId,
        name: 'Nitte Pharma R&D',
        email: 'research@sentinel.local',
        role: 'org_admin',
        locale: 'en',
      },
      {
        id: SEED_IDS.unlinkedUserId,
        name: 'Unlinked Observer',
        email: 'unlinked@sentinel.local',
        role: 'caregiver',
        locale: 'en',
      },
    ];

    for (const u of demoUsers) {
      await tx
        .insert(user)
        .values({
          id: u.id,
          name: u.name,
          email: u.email,
          emailVerified: true,
          role: u.role,
          locale: u.locale,
        })
        .onConflictDoNothing();

      await tx
        .insert(account)
        .values({
          id: `acc-seed-${u.id}`,
          accountId: u.id,
          providerId: 'credential',
          userId: u.id,
          password: demoPasswordHash,
        })
        .onConflictDoUpdate({
          target: account.id,
          set: { password: demoPasswordHash },
        });
    }

    await tx.insert(patientProfiles).values({
      id: SEED_IDS.patientProfileId,
      userId: SEED_IDS.patientUserId,
      displayCode: 'NITTE-PAT-001',
      fullNameEnc: encryptPhi('Ramesh Pai', DEFAULT_PHI_KEY),
      phoneEnc: encryptPhi('+91 98450 11201', DEFAULT_PHI_KEY),
      emergencyContactEnc: encryptPhi('Kavitha Pai (+91 98450 22302)', DEFAULT_PHI_KEY),
      ageBand: '70-74',
      sex: 'male',
      conditionModules: ['heart_failure', 'hypertension'],
      timezone: 'Asia/Kolkata',
      locale: 'kn',
      city: 'Mangaluru',
      regionLat: 12.91,
      regionLon: 74.86,
      emergencyNumber: '112',
      ambulanceNumber: '108',
      silentAlertHours: 12,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      dailyAlertBudget: 3,
      isSynthetic: false,
    });

    await tx.insert(careCircleMembers).values([
      {
        patientId: SEED_IDS.patientProfileId,
        memberUserId: SEED_IDS.caregiverUserId,
        invitedEmail: 'kavitha@sentinel.local',
        relationship: 'primary_caregiver',
        priorityOrder: 1,
        status: 'active',
      },
      {
        patientId: SEED_IDS.patientProfileId,
        memberUserId: SEED_IDS.secondaryCaregiverUserId,
        invitedEmail: 'arjun@sentinel.local',
        relationship: 'secondary_caregiver',
        priorityOrder: 2,
        status: 'active',
      },
      {
        patientId: SEED_IDS.patientProfileId,
        memberUserId: SEED_IDS.clinicianUserId,
        invitedEmail: 'dr.shetty@sentinel.local',
        relationship: 'clinician',
        priorityOrder: 3,
        status: 'active',
      },
    ]);

    await tx.insert(consentGrants).values([
      {
        patientId: SEED_IDS.patientProfileId,
        granteeUserId: SEED_IDS.caregiverUserId,
        relationship: 'caregiver',
        scopes: ['vitals_read', 'alerts_receive', 'checkin_view'],
        reason: 'Primary family caregiver consent',
      },
      {
        patientId: SEED_IDS.patientProfileId,
        granteeUserId: SEED_IDS.secondaryCaregiverUserId,
        relationship: 'caregiver',
        scopes: ['vitals_read', 'alerts_receive'],
        reason: 'Secondary family caregiver backup',
      },
      {
        patientId: SEED_IDS.patientProfileId,
        granteeUserId: SEED_IDS.clinicianUserId,
        relationship: 'clinician',
        scopes: ['vitals_read', 'alerts_receive', 'checkin_view', 'clinician_export'],
        reason: 'Outpatient cardiology review consent',
      },
    ]);

    await tx.insert(apiKeys).values({
      patientId: SEED_IDS.patientProfileId,
      name: 'Default Watch Bridge Key',
      keyPrefix: SEED_IDS.demoIngestApiKey.slice(0, 16),
      keyHash: hashApiKey(SEED_IDS.demoIngestApiKey),
      scopes: ['ingest:write'],
    });

    await tx.insert(medications).values([
      {
        patientId: SEED_IDS.patientProfileId,
        name: 'Metoprolol Succinate',
        rxcui: '866924',
        dosage: '25 mg once daily',
        scheduleTimes: ['08:00'],
        affectsHeartRate: true,
        active: true,
      },
      {
        patientId: SEED_IDS.patientProfileId,
        name: 'Furosemide',
        rxcui: '310429',
        dosage: '20 mg morning',
        scheduleTimes: ['08:00'],
        affectsHeartRate: false,
        active: true,
      },
    ]);

    await appendAuditLog(tx, {
      actorUserId: SEED_IDS.patientUserId,
      action: 'system.seed',
      targetType: 'patient_profile',
      targetId: SEED_IDS.patientProfileId,
      payload: {
        message: 'Initial clinical profile and consent ledger created',
        consentCount: 3,
      },
    });

    return { seeded: true };
  });
}
