import { z } from 'zod';

export const RoleSchema = z.enum(['patient', 'caregiver', 'clinician', 'org_admin']);
export type Role = z.infer<typeof RoleSchema>;

export const LocaleSchema = z.enum(['en', 'kn', 'hi']);
export type Locale = z.infer<typeof LocaleSchema>;

export const ConditionModuleSchema = z.enum([
  'general_frailty',
  'heart_failure',
  'copd',
  'hypertension',
  'diabetes',
]);
export type ConditionModule = z.infer<typeof ConditionModuleSchema>;

export const MetricTypeSchema = z.enum([
  'heart_rate',
  'resting_heart_rate',
  'hrv_rmssd',
  'spo2',
  'respiratory_rate',
  'skin_temp_deviation',
  'body_temperature',
  'steps',
  'sleep_duration_min',
  'sleep_efficiency',
  'sleep_awakenings',
  'systolic_bp',
  'blood_glucose',
  'weight_kg',
  'afib_burden',
]);
export type MetricType = z.infer<typeof MetricTypeSchema>;

export const ActivityContextSchema = z.enum([
  'sleep',
  'rest',
  'light_activity',
  'exercise',
  'unknown',
]);
export type ActivityContext = z.infer<typeof ActivityContextSchema>;

export const QualityFlagSchema = z.enum([
  'ok',
  'motion_artifact',
  'low_perfusion',
  'out_of_bounds',
  'duplicate',
  'gap_interpolated',
  'off_wrist',
  'device_silent',
  'unit_converted',
]);
export type QualityFlag = z.infer<typeof QualityFlagSchema>;

export const AlertLevelSchema = z.enum(['stable', 'watch', 'warning', 'urgent']);
export type AlertLevel = z.infer<typeof AlertLevelSchema>;

export const ConsentScopeSchema = z.enum([
  'vitals_read',
  'alerts_receive',
  'checkin_view',
  'clinician_export',
]);
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;

export const ChannelTypeSchema = z.enum([
  'in_app',
  'web_push',
  'email',
  'telegram',
  'ntfy',
  'sms_flag',
]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ProviderSourceSchema = z.enum([
  'apple_health_xml',
  'google_takeout',
  'fitbit_takeout',
  'csv_import',
  'open_wearables',
  'google_health_api',
  'open_ingest_api',
  'manual_checkin',
  'synthetic_sim',
]);
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

export const VitalSampleInputSchema = z.object({
  metricType: MetricTypeSchema,
  value: z.number().finite(),
  unit: z.string().min(1).max(32),
  recordedAt: z.string().datetime({ offset: true }),
  windowSeconds: z.number().int().nonnegative().max(86400).optional(),
  context: ActivityContextSchema.default('unknown'),
  source: ProviderSourceSchema,
  deviceModel: z.string().max(120).optional(),
  externalId: z.string().max(160).optional(),
  isSynthetic: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type VitalSampleInput = z.infer<typeof VitalSampleInputSchema>;

export const IngestBatchSchema = z.object({
  patientId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
  samples: z.array(VitalSampleInputSchema).min(1).max(5000),
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

export const CheckInEventSchema = z.object({
  patientId: z.string().uuid(),
  kind: z.enum(['ok_tap', 'unwell_tap', 'voice_checkin', 'call_caregiver']),
  locale: LocaleSchema.default('en'),
  transcript: z.string().max(2000).optional(),
  symptoms: z.array(z.string().max(64)).max(20).default([]),
  severity: z.enum(['none', 'mild', 'moderate', 'severe']).default('none'),
  recordedAt: z.string().datetime({ offset: true }).optional(),
  isSynthetic: z.boolean().default(false),
});
export type CheckInEvent = z.infer<typeof CheckInEventSchema>;

export const ConsentGrantMutationSchema = z.object({
  granteeUserId: z.string().min(1),
  relationship: z.enum(['caregiver', 'clinician', 'researcher']),
  scopes: z.array(ConsentScopeSchema).min(1),
  action: z.enum(['grant', 'withdraw']),
  reason: z.string().max(240).optional(),
});
export type ConsentGrantMutation = z.infer<typeof ConsentGrantMutationSchema>;

export const EscalationActionSchema = z.object({
  action: z.enum(['acknowledge', 'snooze', 'false_alarm', 'escalate_now']),
  snoozeMinutes: z.number().int().min(15).max(720).optional(),
  note: z.string().max(500).optional(),
  channel: ChannelTypeSchema.default('in_app'),
});
export type EscalationAction = z.infer<typeof EscalationActionSchema>;

export const SignalContributionSchema = z.object({
  metricType: MetricTypeSchema,
  observedValue: z.number(),
  baselineMedian: z.number().nullable(),
  baselineMad: z.number().nullable(),
  zScore: z.number(),
  layerContribution: z.number().min(0).max(100),
  windowHours: z.number().positive(),
  direction: z.enum(['high', 'low', 'irregular', 'normal']),
  summary: z.string(),
});
export type SignalContribution = z.infer<typeof SignalContributionSchema>;
