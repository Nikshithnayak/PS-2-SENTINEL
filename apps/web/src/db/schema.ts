import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Better Auth core tables
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('patient'),
  locale: text('locale').notNull().default('en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Clinical & Patient Domain Tables
export const patientProfiles = pgTable('patient_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  displayCode: text('display_code').notNull().unique(),
  fullNameEnc: text('full_name_enc').notNull(),
  phoneEnc: text('phone_enc'),
  emergencyContactEnc: text('emergency_contact_enc'),
  ageBand: text('age_band').notNull().default('70-74'),
  sex: text('sex').notNull().default('male'),
  conditionModules: jsonb('condition_modules').$type<string[]>().notNull().default(['general_frailty']),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  locale: text('locale').notNull().default('en'),
  city: text('city').notNull().default('Mangaluru'),
  regionLat: doublePrecision('region_lat').notNull().default(12.91),
  regionLon: doublePrecision('region_lon').notNull().default(74.86),
  emergencyNumber: text('emergency_number').notNull().default('112'),
  ambulanceNumber: text('ambulance_number').notNull().default('108'),
  silentAlertHours: integer('silent_alert_hours').notNull().default(12),
  quietHoursStart: integer('quiet_hours_start').notNull().default(22),
  quietHoursEnd: integer('quiet_hours_end').notNull().default(7),
  dailyAlertBudget: integer('daily_alert_budget').notNull().default(3),
  sensitivityOffset: doublePrecision('sensitivity_offset').notNull().default(0),
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const careCircleMembers = pgTable('care_circle_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  memberUserId: text('member_user_id').references(() => user.id, { onDelete: 'cascade' }),
  invitedEmail: text('invited_email'),
  relationship: text('relationship').notNull(), // primary_caregiver, secondary_caregiver, clinician, researcher
  priorityOrder: integer('priority_order').notNull().default(1),
  inviteTokenHash: text('invite_token_hash'),
  status: text('status').notNull().default('active'), // pending, active, revoked
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consentGrants = pgTable('consent_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  granteeUserId: text('grantee_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  relationship: text('relationship').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  reason: text('reason'),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default(['ingest:write']),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestBatches = pgTable('ingest_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  idempotencyKey: text('idempotency_key'),
  recordsReceived: integer('records_received').notNull().default(0),
  recordsAccepted: integer('records_accepted').notNull().default(0),
  recordsSkipped: integer('records_skipped').notNull().default(0),
  skipReasons: jsonb('skip_reasons').$type<Record<string, number>>().notNull().default({}),
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Range-partitioned by recorded_at in 0001_init.sql
export const vitalSamples = pgTable(
  'vital_samples',
  {
    id: uuid('id').notNull().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patientProfiles.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').references(() => ingestBatches.id, { onDelete: 'set null' }),
    metricType: text('metric_type').notNull(),
    value: doublePrecision('value').notNull(),
    unit: text('unit').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    windowSeconds: integer('window_seconds').notNull().default(60),
    context: text('context').notNull().default('unknown'),
    source: text('source').notNull(),
    deviceModel: text('device_model'),
    sourceHash: text('source_hash').notNull(),
    qualityFlags: jsonb('quality_flags').$type<string[]>().notNull().default(['ok']),
    dataConfidence: doublePrecision('data_confidence').notNull().default(1.0),
    isSynthetic: boolean('is_synthetic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.recordedAt] })],
);

export const vitalRollupsHourly = pgTable(
  'vital_rollups_hourly',
  {
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patientProfiles.id, { onDelete: 'cascade' }),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    metricType: text('metric_type').notNull(),
    context: text('context').notNull().default('unknown'),
    sampleCount: integer('sample_count').notNull(),
    meanVal: doublePrecision('mean_val').notNull(),
    medianVal: doublePrecision('median_val').notNull(),
    minVal: doublePrecision('min_val').notNull(),
    maxVal: doublePrecision('max_val').notNull(),
    wearFraction: doublePrecision('wear_fraction').notNull().default(1.0),
    confidence: doublePrecision('confidence').notNull().default(1.0),
    isSynthetic: boolean('is_synthetic').notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.patientId, table.bucketStart, table.metricType, table.context] })],
);

export const baselineStates = pgTable('baseline_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  metricType: text('metric_type').notNull(),
  context: text('context').notNull().default('rest'),
  modelVersion: text('model_version').notNull().default('sentinel-v1'),
  calibrationDays: integer('calibration_days').notNull().default(0),
  validDays: integer('valid_days').notNull().default(0),
  status: text('status').notNull().default('learning'), // learning, calibrated
  medianVal: doublePrecision('median_val').notNull(),
  madVal: doublePrecision('mad_val').notNull(),
  priorMean: doublePrecision('prior_mean').notNull(),
  priorStd: doublePrecision('prior_std').notNull(),
  circadianOffsets: jsonb('circadian_offsets').$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const excludedPeriods = pgTable('excluded_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(), // illness, travel, medication_change, device_repair
  note: text('note'),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskAssessments = pgTable('risk_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
  deteriorationIndex: doublePrecision('deterioration_index').notNull(),
  level: text('level').notNull(), // stable, watch, warning, urgent
  confidence: doublePrecision('confidence').notNull(),
  l1Score: doublePrecision('l1_score').notNull().default(0),
  l2Score: doublePrecision('l2_score').notNull().default(0),
  l3Score: doublePrecision('l3_score').notNull().default(0),
  partialNews2: jsonb('partial_news2').$type<Record<string, unknown>>().notNull().default({}),
  contributions: jsonb('contributions').$type<Array<Record<string, unknown>>>().notNull().default([]),
  trend72h: jsonb('trend_72h').$type<Array<{ ts: string; index: number }>>().notNull().default([]),
  explanationEn: text('explanation_en').notNull(),
  explanationKn: text('explanation_kn'),
  explanationHi: text('explanation_hi'),
  isSynthetic: boolean('is_synthetic').notNull().default(false),
});

export const detectorDecisionLogs = pgTable('detector_decision_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
  modelVersion: text('model_version').notNull().default('sentinel-v1'),
  firedAlert: boolean('fired_alert').notNull().default(false),
  suppressionReason: text('suppression_reason'),
  decisionPayload: jsonb('decision_payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  riskAssessmentId: uuid('risk_assessment_id').references(() => riskAssessments.id, {
    onDelete: 'set null',
  }),
  alertType: text('alert_type').notNull(), // deterioration, safety_l1, device_silent, elder_unwell
  level: text('level').notNull(), // watch, warning, urgent
  ruleKey: text('rule_key').notNull(),
  summaryEn: text('summary_en').notNull(),
  summaryKn: text('summary_kn'),
  summaryHi: text('summary_hi'),
  status: text('status').notNull().default('open'), // open, acknowledged, snoozed, resolved, false_alarm
  escalationStep: integer('escalation_step').notNull().default(1),
  nextEscalationAt: timestamp('next_escalation_at', { withTimezone: true }),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  acknowledgedBy: text('acknowledged_by').references(() => user.id, { onDelete: 'set null' }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgementNote: text('acknowledgement_note'),
  feedback: text('feedback'), // helpful, false_alarm, confirmed_illness
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertDeliveries = pgTable('alert_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  alertId: uuid('alert_id')
    .notNull()
    .references(() => alerts.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  recipientUserId: text('recipient_user_id').references(() => user.id, { onDelete: 'set null' }),
  channel: text('channel').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending, sent, failed, skipped
  attemptCount: integer('attempt_count').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  providerReceipt: text('provider_receipt'),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const checkinEvents = pgTable('checkin_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  locale: text('locale').notNull().default('en'),
  transcript: text('transcript'),
  symptoms: jsonb('symptoms').$type<string[]>().notNull().default([]),
  severity: text('severity').notNull().default('none'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  isSynthetic: boolean('is_synthetic').notNull().default(false),
});

export const medications = pgTable('medications', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rxcui: text('rxcui'),
  dosage: text('dosage').notNull(),
  scheduleTimes: jsonb('schedule_times').$type<string[]>().notNull().default(['08:00']),
  affectsHeartRate: boolean('affects_heart_rate').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const medicationEvents = pgTable('medication_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  medicationId: uuid('medication_id')
    .notNull()
    .references(() => medications.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patientProfiles.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // taken, missed, skipped
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const environmentSnapshots = pgTable('environment_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  city: text('city').notNull(),
  regionLat: doublePrecision('region_lat').notNull(),
  regionLon: doublePrecision('region_lon').notNull(),
  tempC: doublePrecision('temp_c').notNull(),
  apparentTempC: doublePrecision('apparent_temp_c').notNull(),
  humidityPct: doublePrecision('humidity_pct').notNull(),
  pm25: doublePrecision('pm25'),
  heatRiskLevel: text('heat_risk_level').notNull().default('normal'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface OpdSoapNoteData {
  chiefComplaint: string;
  subjectiveHpi: string;
  objectiveExam: string;
  vitalsSummary: string;
  assessment: string;
  planAndFollowUp: string;
  languagesDetected: string[];
  redFlags: string[];
  investigations: string[];
}

export interface OpdPrescriptionItemData {
  drugName: string;
  strength: string;
  route: string;
  frequency: string;
  timing: string;
  durationDays: number;
  instructions: string;
  rxcui: string | null;
  affectsHeartRate: boolean;
}

export interface OpdPatientSummaryData {
  en: string;
  kn: string;
  hi: string;
  followUpWhen: string;
  warningSigns: string[];
}

export const opdConsultations = pgTable('opd_consultations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicianUserId: text('clinician_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => patientProfiles.id, { onDelete: 'set null' }),
  patientLabel: text('patient_label').notNull(),
  languageMix: text('language_mix').notNull().default('en_kn_hi'),
  transcript: text('transcript').notNull(),
  soapNote: jsonb('soap_note').$type<OpdSoapNoteData>().notNull(),
  prescriptionDraft: jsonb('prescription_draft').$type<OpdPrescriptionItemData[]>().notNull().default([]),
  patientSummary: jsonb('patient_summary').$type<OpdPatientSummaryData>().notNull(),
  generatorSource: text('generator_source').notNull().default('deterministic_opd_nlp'),
  status: text('status').notNull().default('draft'), // draft, approved
  syncedMedicationsCount: integer('synced_medications_count').notNull().default(0),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobQueue = pgTable('job_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('queued'), // queued, running, completed, failed
  attempts: integer('attempts').notNull().default(0),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only hash-chained audit ledger
export const auditLogs = pgTable('audit_logs', {
  seq: bigint('seq', { mode: 'number' }).primaryKey(),
  id: uuid('id').notNull().defaultRandom(),
  prevHash: text('prev_hash').notNull(),
  entryHash: text('entry_hash').notNull(),
  actorUserId: text('actor_user_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
