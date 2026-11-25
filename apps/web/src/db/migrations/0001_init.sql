-- SENTINEL Initial PostgreSQL Schema + Partitioned Time-Series + RLS + Append-Only Audit Chain
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Better Auth tables
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  role text NOT NULL DEFAULT 'patient',
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Patient & Care Circle Tables
CREATE TABLE IF NOT EXISTS patient_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  display_code text NOT NULL UNIQUE,
  full_name_enc text NOT NULL,
  phone_enc text,
  emergency_contact_enc text,
  age_band text NOT NULL DEFAULT '70-74',
  sex text NOT NULL DEFAULT 'male',
  condition_modules jsonb NOT NULL DEFAULT '["general_frailty"]'::jsonb,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  locale text NOT NULL DEFAULT 'en',
  city text NOT NULL DEFAULT 'Mangaluru',
  region_lat double precision NOT NULL DEFAULT 12.91,
  region_lon double precision NOT NULL DEFAULT 74.86,
  emergency_number text NOT NULL DEFAULT '112',
  ambulance_number text NOT NULL DEFAULT '108',
  silent_alert_hours integer NOT NULL DEFAULT 12,
  quiet_hours_start integer NOT NULL DEFAULT 22,
  quiet_hours_end integer NOT NULL DEFAULT 7,
  daily_alert_budget integer NOT NULL DEFAULT 3,
  sensitivity_offset double precision NOT NULL DEFAULT 0,
  is_synthetic boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS care_circle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  member_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  invited_email text,
  relationship text NOT NULL,
  priority_order integer NOT NULL DEFAULT 1,
  invite_token_hash text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  grantee_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  relationship text NOT NULL,
  scopes jsonb NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  reason text
);
CREATE INDEX IF NOT EXISTS idx_consent_active ON consent_grants(patient_id, grantee_user_id) WHERE withdrawn_at IS NULL;

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '["ingest:write"]'::jsonb,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  idempotency_key text,
  records_received integer NOT NULL DEFAULT 0,
  records_accepted integer NOT NULL DEFAULT 0,
  records_skipped integer NOT NULL DEFAULT 0,
  skip_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_batch_idem
  ON ingest_batches(patient_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Native PostgreSQL Range-Partitioned Time-Series Table
CREATE TABLE IF NOT EXISTS vital_samples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES ingest_batches(id) ON DELETE SET NULL,
  metric_type text NOT NULL,
  value double precision NOT NULL,
  unit text NOT NULL,
  recorded_at timestamptz NOT NULL,
  window_seconds integer NOT NULL DEFAULT 60,
  context text NOT NULL DEFAULT 'unknown',
  source text NOT NULL,
  device_model text,
  source_hash text NOT NULL,
  quality_flags jsonb NOT NULL DEFAULT '["ok"]'::jsonb,
  data_confidence double precision NOT NULL DEFAULT 1.0,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS vital_samples_2026_10 PARTITION OF vital_samples
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS vital_samples_2026_11 PARTITION OF vital_samples
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS vital_samples_2026_12 PARTITION OF vital_samples
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE IF NOT EXISTS vital_samples_default PARTITION OF vital_samples DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vital_samples_dedup
  ON vital_samples(patient_id, metric_type, recorded_at, source_hash);
CREATE INDEX IF NOT EXISTS idx_vital_samples_lookup
  ON vital_samples(patient_id, metric_type, recorded_at DESC);

CREATE TABLE IF NOT EXISTS vital_rollups_hourly (
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  metric_type text NOT NULL,
  context text NOT NULL DEFAULT 'unknown',
  sample_count integer NOT NULL,
  mean_val double precision NOT NULL,
  median_val double precision NOT NULL,
  min_val double precision NOT NULL,
  max_val double precision NOT NULL,
  wear_fraction double precision NOT NULL DEFAULT 1.0,
  confidence double precision NOT NULL DEFAULT 1.0,
  is_synthetic boolean NOT NULL DEFAULT false,
  PRIMARY KEY (patient_id, bucket_start, metric_type, context)
);

CREATE TABLE IF NOT EXISTS baseline_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  metric_type text NOT NULL,
  context text NOT NULL DEFAULT 'rest',
  model_version text NOT NULL DEFAULT 'sentinel-v1',
  calibration_days integer NOT NULL DEFAULT 0,
  valid_days integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'learning',
  median_val double precision NOT NULL,
  mad_val double precision NOT NULL,
  prior_mean double precision NOT NULL,
  prior_std double precision NOT NULL,
  circadian_offsets jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_baseline_unique
  ON baseline_states(patient_id, metric_type, context, model_version);

CREATE TABLE IF NOT EXISTS excluded_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text NOT NULL,
  note text,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  deterioration_index double precision NOT NULL,
  level text NOT NULL,
  confidence double precision NOT NULL,
  l1_score double precision NOT NULL DEFAULT 0,
  l2_score double precision NOT NULL DEFAULT 0,
  l3_score double precision NOT NULL DEFAULT 0,
  partial_news2 jsonb NOT NULL DEFAULT '{}'::jsonb,
  contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  trend_72h jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation_en text NOT NULL,
  explanation_kn text,
  explanation_hi text,
  is_synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_risk_latest ON risk_assessments(patient_id, assessed_at DESC);

CREATE TABLE IF NOT EXISTS detector_decision_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  model_version text NOT NULL DEFAULT 'sentinel-v1',
  fired_alert boolean NOT NULL DEFAULT false,
  suppression_reason text,
  decision_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  risk_assessment_id uuid REFERENCES risk_assessments(id) ON DELETE SET NULL,
  alert_type text NOT NULL,
  level text NOT NULL,
  rule_key text NOT NULL,
  summary_en text NOT NULL,
  summary_kn text,
  summary_hi text,
  status text NOT NULL DEFAULT 'open',
  escalation_step integer NOT NULL DEFAULT 1,
  next_escalation_at timestamptz,
  snoozed_until timestamptz,
  acknowledged_by text REFERENCES "user"(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  acknowledgement_note text,
  feedback text,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_patient_status ON alerts(patient_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  recipient_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  channel text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_receipt text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  transcript text,
  symptoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text NOT NULL DEFAULT 'none',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  is_synthetic boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  rxcui text,
  dosage text NOT NULL,
  schedule_times jsonb NOT NULL DEFAULT '["08:00"]'::jsonb,
  affects_heart_rate boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  status text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  region_lat double precision NOT NULL,
  region_lon double precision NOT NULL,
  temp_c double precision NOT NULL,
  apparent_temp_c double precision NOT NULL,
  humidity_pct double precision NOT NULL,
  pm25 double precision,
  heat_risk_level text NOT NULL DEFAULT 'normal',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_queue_poll ON job_queue(status, run_after);

-- Append-Only Hash-Chained Audit Ledger
CREATE TABLE IF NOT EXISTS audit_logs (
  seq bigint PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prev_hash text NOT NULL,
  entry_hash text NOT NULL,
  actor_user_id text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  payload_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ALTER COLUMN seq DROP IDENTITY IF EXISTS;

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is strictly append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Row-Level Security (enforced via non-superuser role + app.current_user_id + consent_grants)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_app') THEN
    CREATE ROLE sentinel_app NOLOGIN NOBYPASSRLS;
  END IF;
  BEGIN
    EXECUTE format('GRANT sentinel_app TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

GRANT USAGE ON SCHEMA public TO sentinel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sentinel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sentinel_app;

CREATE OR REPLACE FUNCTION sentinel_has_patient_access(target_patient_id uuid, required_scope text) RETURNS boolean AS $$
DECLARE
  uid text := current_setting('app.current_user_id', true);
  bypass text := current_setting('app.rls_bypass', true);
  is_owner boolean;
  has_consent boolean;
BEGIN
  IF bypass = 'true' THEN
    RETURN true;
  END IF;
  IF uid IS NULL OR uid = '' THEN
    RETURN false;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM patient_profiles p WHERE p.id = target_patient_id AND p.user_id = uid
  ) INTO is_owner;
  IF is_owner THEN
    RETURN true;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM consent_grants cg
    WHERE cg.patient_id = target_patient_id
      AND cg.grantee_user_id = uid
      AND cg.withdrawn_at IS NULL
      AND cg.scopes ? required_scope
  ) INTO has_consent;
  RETURN has_consent;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE patient_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE vital_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE vital_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE checkin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_profiles_rls ON patient_profiles;
CREATE POLICY patient_profiles_rls ON patient_profiles
  USING (
    current_setting('app.rls_bypass', true) = 'true'
    OR user_id = current_setting('app.current_user_id', true)
    OR sentinel_has_patient_access(id, 'vitals_read')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'true'
    OR user_id = current_setting('app.current_user_id', true)
  );

DROP POLICY IF EXISTS vital_samples_rls ON vital_samples;
CREATE POLICY vital_samples_rls ON vital_samples
  USING (sentinel_has_patient_access(patient_id, 'vitals_read'))
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'true'
    OR sentinel_has_patient_access(patient_id, 'vitals_read')
  );

DROP POLICY IF EXISTS alerts_rls ON alerts;
CREATE POLICY alerts_rls ON alerts
  USING (sentinel_has_patient_access(patient_id, 'alerts_receive'))
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'true'
    OR sentinel_has_patient_access(patient_id, 'alerts_receive')
  );

DROP POLICY IF EXISTS checkin_events_rls ON checkin_events;
CREATE POLICY checkin_events_rls ON checkin_events
  USING (sentinel_has_patient_access(patient_id, 'checkin_view'))
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'true'
    OR sentinel_has_patient_access(patient_id, 'checkin_view')
  );
