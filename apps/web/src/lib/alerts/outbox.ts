import { randomBytes } from 'node:crypto';
import type { AlertLevel, ChannelType } from '@sentinel/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import {
  alertDeliveries,
  alerts,
  careCircleMembers,
  consentGrants,
  jobQueue,
  patientProfiles,
  pushSubscriptions,
  riskAssessments,
  user,
} from '@/db/schema';
import type { EngineEvaluationResult } from '@/lib/engine/client';
import { resolveChannelEnvReadiness, type ChannelEnvReadiness } from '@/lib/alerts/env-config';
import { dispatchChannelDelivery } from '@/lib/alerts/adapters';
import { publishPatientEvent } from '@/lib/alerts/events';
import { computeBoundedSensitivityUpdate, evaluateAlertPolicy } from '@/lib/alerts/policy';

interface RecipientTarget {
  userId: string;
  name: string;
  email: string | null;
  roleLabel: string;
  channels: ChannelType[];
}

function escalationDelayMinutes(level: AlertLevel, nextStep: number): number {
  if (level === 'urgent') {
    return nextStep <= 2 ? 5 : 8;
  }
  if (level === 'warning') {
    return nextStep <= 2 ? 15 : 20;
  }
  return 30;
}

async function resolveRecipientsForStep(
  patientId: string,
  step: number,
  level: AlertLevel,
): Promise<RecipientTarget[]> {
  return withSystemDb(async (tx) => {
    const [profile] = await tx
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);
    if (!profile) return [];

    const [patientUser] = await tx
      .select()
      .from(user)
      .where(eq(user.id, profile.userId))
      .limit(1);

    const targets: RecipientTarget[] = [];

    if (step === 0 || (step === 1 && level !== 'watch')) {
      if (patientUser) {
        targets.push({
          userId: patientUser.id,
          name: patientUser.name,
          email: patientUser.email,
          roleLabel: 'patient',
          channels: ['in_app', 'web_push'],
        });
      }
    }

    if (step >= 1) {
      const grants = await tx
        .select()
        .from(consentGrants)
        .where(and(eq(consentGrants.patientId, patientId), isNull(consentGrants.withdrawnAt)));

      const consentedAlertUsers = new Set(
        grants
          .filter((g) => (g.scopes as string[]).includes('alerts_receive'))
          .map((g) => g.granteeUserId),
      );

      const members = await tx
        .select({
          memberUserId: careCircleMembers.memberUserId,
          relationship: careCircleMembers.relationship,
          priorityOrder: careCircleMembers.priorityOrder,
          name: user.name,
          email: user.email,
          role: user.role,
        })
        .from(careCircleMembers)
        .innerJoin(user, eq(careCircleMembers.memberUserId, user.id))
        .where(and(eq(careCircleMembers.patientId, patientId), eq(careCircleMembers.status, 'active')))
        .orderBy(asc(careCircleMembers.priorityOrder));

      const activeWithUser = members.filter(
        (m): m is typeof m & { memberUserId: string } => m.memberUserId !== null,
      );
      const caregivers = activeWithUser.filter(
        (m) => m.role !== 'clinician' && consentedAlertUsers.has(m.memberUserId),
      );
      const clinicians = activeWithUser.filter(
        (m) => m.role === 'clinician' && consentedAlertUsers.has(m.memberUserId),
      );

      if (step === 1 || step === 4) {
        const primary = caregivers[0];
        if (primary) {
          targets.push({
            userId: primary.memberUserId,
            name: primary.name,
            email: primary.email,
            roleLabel: 'primary_caregiver',
            channels: ['in_app', 'email', 'web_push', 'ntfy', 'telegram', 'sms_flag'],
          });
        }
      }

      if (step === 2) {
        const secondary = caregivers[1] ?? caregivers[0];
        if (secondary) {
          targets.push({
            userId: secondary.memberUserId,
            name: secondary.name,
            email: secondary.email,
            roleLabel: 'secondary_caregiver',
            channels: ['in_app', 'email', 'web_push', 'ntfy', 'telegram'],
          });
        }
      }

      if (step >= 3 && clinicians[0]) {
        targets.push({
          userId: clinicians[0].memberUserId,
          name: clinicians[0].name,
          email: clinicians[0].email,
          roleLabel: 'clinician',
          channels: ['in_app', 'email', 'web_push', 'ntfy'],
        });
      }
    }

    return targets;
  });
}

async function enqueueDeliveriesForAlertStep(params: {
  alertId: string;
  patientId: string;
  step: number;
  level: AlertLevel;
  subject: string;
  bodyText: string;
  isSynthetic: boolean;
}): Promise<void> {
  const targets = await resolveRecipientsForStep(params.patientId, params.step, params.level);
  if (targets.length === 0) return;

  await withSystemDb(async (tx) => {
    for (const target of targets) {
      for (const ch of target.channels) {
        const idempotencyKey = `${params.alertId}:${target.userId}:${ch}:step${params.step}`;
        const existing = await tx
          .select({ id: alertDeliveries.id })
          .from(alertDeliveries)
          .where(eq(alertDeliveries.idempotencyKey, idempotencyKey))
          .limit(1);
        if (existing[0]) continue;

        const actionToken = randomBytes(6).toString('hex');
        await tx.insert(alertDeliveries).values({
          alertId: params.alertId,
          patientId: params.patientId,
          recipientUserId: target.userId,
          channel: ch,
          idempotencyKey,
          status: 'queued',
          attemptCount: 0,
          payload: {
            recipientName: target.name,
            recipientEmail: target.email,
            roleLabel: target.roleLabel,
            subject: params.subject,
            bodyText: params.bodyText,
            actionToken,
            step: params.step,
            isSynthetic: params.isSynthetic,
          },
        });
      }
    }
  });
}

/**
 * Processes pending or retry-due deliveries in `alert_deliveries` idempotently.
 */
export async function processOutboxBatch(patientId?: string): Promise<{
  processed: number;
  delivered: number;
  capturedLocal: number;
  failed: number;
}> {
  const now = new Date();
  const rows = await withSystemDb((tx) => {
    const conds = [
      inArray(alertDeliveries.status, ['queued', 'failed']),
      or(isNull(alertDeliveries.nextRetryAt), lte(alertDeliveries.nextRetryAt, now)),
    ];
    if (patientId) {
      conds.push(eq(alertDeliveries.patientId, patientId));
    }
    return tx
      .select()
      .from(alertDeliveries)
      .where(and(...conds))
      .orderBy(asc(alertDeliveries.createdAt))
      .limit(50);
  });

  let delivered = 0;
  let capturedLocal = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.attemptCount >= 4 && row.status === 'failed') continue;

    const payload = row.payload as {
      recipientName?: string;
      recipientEmail?: string | null;
      subject?: string;
      bodyText?: string;
      actionToken?: string;
    };

    const baseDispatch = {
      channel: row.channel as ChannelType,
      alertId: row.alertId,
      recipientEmail: payload.recipientEmail ?? null,
      recipientName: payload.recipientName ?? 'Care Circle Member',
      subject: payload.subject ?? 'SENTINEL Health Awareness Notice',
      bodyText: payload.bodyText ?? 'Changes from personal normal detected.',
      actionToken: payload.actionToken ?? 'ok',
    };

    let res;
    if (row.channel === 'web_push' && row.recipientUserId) {
      const subs = await withSystemDb((tx) =>
        tx
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, row.recipientUserId!)),
      );
      if (subs.length === 0) {
        res = await dispatchChannelDelivery({ ...baseDispatch, pushSubscription: null });
      } else {
        const subResults = await Promise.all(
          subs.map(async (sub) => {
            const subRes = await dispatchChannelDelivery({
              ...baseDispatch,
              pushSubscription: {
                endpoint: sub.endpoint,
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            });
            if (subRes.status === 'failed' && /404|410|unsubscribed|expired/i.test(subRes.error ?? '')) {
              await withSystemDb((tx) =>
                tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)),
              );
            }
            return subRes;
          }),
        );
        const firstSuccess = subResults.find((r) => r.status === 'delivered');
        res = firstSuccess ?? subResults[0]!;
        if (firstSuccess && subResults.length > 1) {
          const deliveredCount = subResults.filter((r) => r.status === 'delivered').length;
          res = {
            ...firstSuccess,
            receipt: `vapid://${row.alertId} (${deliveredCount}/${subResults.length} devices)`,
          };
        }
      }
    } else {
      res = await dispatchChannelDelivery({ ...baseDispatch, pushSubscription: null });
    }

    if (res.status === 'delivered') delivered += 1;
    else if (res.status === 'captured_local') capturedLocal += 1;
    else if (res.status === 'failed') failed += 1;

    const backoffMs = 30_000 * Math.pow(2, row.attemptCount);
    await withSystemDb((tx) =>
      tx
        .update(alertDeliveries)
        .set({
          status: res.status,
          attemptCount: row.attemptCount + 1,
          nextRetryAt: res.status === 'failed' ? new Date(Date.now() + backoffMs) : null,
          providerReceipt: res.receipt,
          lastError: res.error,
          deliveredAt: res.status === 'delivered' || res.status === 'captured_local' ? new Date() : null,
        })
        .where(eq(alertDeliveries.id, row.id)),
    );
  }

  return {
    processed: rows.length,
    delivered,
    capturedLocal,
    failed,
  };
}

/**
 * Feeds an EngineEvaluationResult through anti-fatigue rules and transactional outbox.
 */
export async function maybeTriggerAlertFromEvaluation(params: {
  evaluation: EngineEvaluationResult;
  actorUserId?: string | null;
  bypassPersistence?: boolean;
  now?: Date;
}): Promise<{
  outcome: 'fire' | 'upgrade_existing' | 'auto_resolve' | 'suppress';
  reason: string;
  alertId: string | null;
  outboxStats?: Awaited<ReturnType<typeof processOutboxBatch>>;
}> {
  const { evaluation, actorUserId = null, bypassPersistence = false } = params;
  const now = params.now ?? new Date();
  const since24h = new Date(now.getTime() - 24 * 3_600_000);

  const ctx = await withSystemDb(async (tx) => {
    const [profile] = await tx
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, evaluation.patientId))
      .limit(1);

    if (!profile) {
      throw new Error(`Patient ${evaluation.patientId} not found`);
    }

    const recentAssessments = await tx
      .select({ level: riskAssessments.level })
      .from(riskAssessments)
      .where(eq(riskAssessments.patientId, evaluation.patientId))
      .orderBy(desc(riskAssessments.assessedAt))
      .limit(4);

    const recentAlerts = await tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.patientId, evaluation.patientId), gte(alerts.createdAt, since24h)))
      .orderBy(desc(alerts.createdAt));

    return { profile, recentAssessments, recentAlerts };
  });

  const primaryMetric = evaluation.contributions[0]?.metricType ?? 'multi_signal';
  const ruleKey = evaluation.deviceSilent ? 'device_silent' : `deterioration:${primaryMetric}`;

  const decision = evaluateAlertPolicy(
    {
      deteriorationIndex: evaluation.deteriorationIndex,
      level: evaluation.level,
      l1Score: evaluation.l1Score,
      l2Score: evaluation.l2Score,
      deviceSilent: evaluation.deviceSilent,
      ruleKey,
      isSynthetic: evaluation.isSynthetic,
    },
    {
      quietHoursStart: `${String(ctx.profile.quietHoursStart).padStart(2, '0')}:00`,
      quietHoursEnd: `${String(ctx.profile.quietHoursEnd).padStart(2, '0')}:00`,
      timezone: ctx.profile.timezone,
      dailyAlertBudget: ctx.profile.dailyAlertBudget,
      sensitivityOffset: ctx.profile.sensitivityOffset,
    },
    {
      recentAssessmentLevels: ctx.recentAssessments
        .slice(1)
        .map((a) => a.level as AlertLevel),
      recentAlerts24h: ctx.recentAlerts.map((a) => ({
        id: a.id,
        ruleKey: a.ruleKey,
        level: a.level as AlertLevel,
        status: a.status,
        createdAt: a.createdAt,
        snoozedUntil: a.snoozedUntil,
      })),
      now,
    },
    { bypassPersistence },
  );

  if (decision.outcome === 'auto_resolve' && decision.existingAlertId) {
    await withSystemDb(async (tx) => {
      await tx
        .update(alerts)
        .set({
          status: 'auto_resolved',
          updatedAt: now,
        })
        .where(eq(alerts.id, decision.existingAlertId!));
      await appendAuditLog(tx, {
        actorUserId,
        action: 'alert.auto_resolved',
        targetType: 'alert',
        targetId: decision.existingAlertId!,
        payload: { patientId: evaluation.patientId, reason: decision.reason },
      });
    });
    publishPatientEvent({
      type: 'alert.resolved',
      patientId: evaluation.patientId,
      timestamp: now.toISOString(),
      data: { alertId: decision.existingAlertId, reason: decision.reason },
    });
    return {
      outcome: decision.outcome,
      reason: decision.reason,
      alertId: decision.existingAlertId,
    };
  }

  if (decision.outcome === 'suppress') {
    publishPatientEvent({
      type: 'engine.evaluated',
      patientId: evaluation.patientId,
      timestamp: now.toISOString(),
      data: {
        deteriorationIndex: evaluation.deteriorationIndex,
        level: evaluation.level,
        policyReason: decision.reason,
      },
    });
    return {
      outcome: 'suppress',
      reason: decision.reason,
      alertId: decision.existingAlertId ?? null,
    };
  }

  const initialStep = decision.effectiveLevel === 'watch' ? 0 : 1;
  const nextStepDelay = escalationDelayMinutes(decision.effectiveLevel, initialStep + 1);
  const nextEscalationAt = new Date(now.getTime() + nextStepDelay * 60_000);
  const syntheticPrefix = evaluation.isSynthetic ? '[SYNTHETIC] ' : '';
  const subject = `${syntheticPrefix}Sachet · SENTINEL ${decision.effectiveLevel.toUpperCase()} Notice (Index ${decision.effectiveIndex})`;
  const emergencyNote =
    decision.effectiveLevel === 'urgent'
      ? ` If unresponsive or severe symptoms: call Emergency ${ctx.profile.emergencyNumber} or Ambulance ${ctx.profile.ambulanceNumber}.`
      : '';

  const leadDriver = evaluation.contributions[0];
  const driverDetail = leadDriver
    ? ` Primary signal: ${leadDriver.label} at ${leadDriver.observed}${leadDriver.unit ? ` ${leadDriver.unit}` : ''} (personal normal ${leadDriver.normalLow}–${leadDriver.normalHigh}${leadDriver.unit ? ` ${leadDriver.unit}` : ''}).`
    : '';
  const activeLayers: string[] = [];
  if (evaluation.l1Score >= 20) activeLayers.push('L1 Safety');
  if (evaluation.l2Score >= 20) activeLayers.push('L2 Personal Temporal');
  if (evaluation.l3Score >= 20) activeLayers.push('L3 Multivariate');
  const layerDetail = activeLayers.length ? ` Layers: ${activeLayers.join(' + ')}.` : '';
  const firstNoticeIso = evaluation.changePoints?.[0];
  const firstNoticeDetail = firstNoticeIso
    ? ` First shift noticed ${firstNoticeIso.slice(0, 16).replace('T', ' ')} UTC.`
    : '';
  const nextActionNote =
    decision.effectiveLevel === 'urgent'
      ? ' Please check how the person feels right away and arrange clinician review (early awareness notice, not a medical diagnosis).'
      : decision.effectiveLevel === 'warning'
        ? ' Next step: rest comfortably, re-check readings after sitting quietly, and update a caregiver or doctor if symptoms are present (early awareness notice, not a diagnosis).'
        : ' Next step: keep wearing the sensor calmly and re-check on the next reading (early awareness notice, not a diagnosis).';

  const summaryEn = evaluation.deviceSilent
    ? 'No recent wearable readings synced — check watch battery, Bluetooth, or phone Health Connect sync. SENTINEL only monitors telemetry and never diagnoses medical conditions.'
    : `${evaluation.summaryText}${driverDetail}${layerDetail}${firstNoticeDetail}${nextActionNote}${emergencyNote}`;
  const bodyText = summaryEn;

  let alertId = decision.existingAlertId ?? null;

  if (decision.outcome === 'upgrade_existing' && alertId) {
    await withSystemDb(async (tx) => {
      await tx
        .update(alerts)
        .set({
          level: decision.effectiveLevel,
          riskAssessmentId: evaluation.riskAssessmentId ?? null,
          summaryEn,
          summaryKn: evaluation.explanationKn,
          summaryHi: evaluation.explanationHi,
          escalationStep: initialStep,
          nextEscalationAt,
          updatedAt: now,
        })
        .where(eq(alerts.id, alertId!));

      await appendAuditLog(tx, {
        actorUserId,
        action: 'alert.upgraded',
        targetType: 'alert',
        targetId: alertId!,
        payload: {
          patientId: evaluation.patientId,
          level: decision.effectiveLevel,
          effectiveIndex: decision.effectiveIndex,
        },
      });
    });
  } else {
    alertId = await withSystemDb(async (tx) => {
      const [created] = await tx
        .insert(alerts)
        .values({
          patientId: evaluation.patientId,
          riskAssessmentId: evaluation.riskAssessmentId ?? null,
          alertType: evaluation.deviceSilent ? 'device_silent' : 'deterioration',
          level: decision.effectiveLevel,
          ruleKey,
          summaryEn,
          summaryKn: evaluation.explanationKn,
          summaryHi: evaluation.explanationHi,
          status: 'open',
          escalationStep: initialStep,
          nextEscalationAt,
          isSynthetic: evaluation.isSynthetic,
        })
        .returning({ id: alerts.id });

      if (!created) throw new Error('Failed to create alert row');

      await tx.insert(jobQueue).values({
        jobType: 'alert.escalate',
        payload: { alertId: created.id, patientId: evaluation.patientId, nextStep: initialStep + 1 },
        status: 'pending',
        runAfter: nextEscalationAt,
      });

      await appendAuditLog(tx, {
        actorUserId,
        action: 'alert.created',
        targetType: 'alert',
        targetId: created.id,
        payload: {
          patientId: evaluation.patientId,
          level: decision.effectiveLevel,
          effectiveIndex: decision.effectiveIndex,
          isSynthetic: evaluation.isSynthetic,
          reason: decision.reason,
        },
      });
      return created.id;
    });
  }

  await enqueueDeliveriesForAlertStep({
    alertId: alertId!,
    patientId: evaluation.patientId,
    step: initialStep,
    level: decision.effectiveLevel,
    subject,
    bodyText,
    isSynthetic: evaluation.isSynthetic,
  });

  const outboxStats = await processOutboxBatch(evaluation.patientId);

  publishPatientEvent({
    type: 'alert.created',
    patientId: evaluation.patientId,
    timestamp: now.toISOString(),
    data: {
      alertId,
      level: decision.effectiveLevel,
      deteriorationIndex: decision.effectiveIndex,
      escalationStep: initialStep,
      isSynthetic: evaluation.isSynthetic,
      outboxStats,
    },
  });

  return {
    outcome: decision.outcome,
    reason: decision.reason,
    alertId,
    outboxStats,
  };
}

/**
 * Advances timed or manual escalation steps (1 Primary -> 2 Secondary -> 3 Clinician -> 4 Emergency).
 */
export async function escalateAlerts(params: {
  patientId?: string;
  alertId?: string;
  forceImmediate?: boolean;
  actorUserId?: string | null;
}): Promise<{ escalatedCount: number; alerts: Array<{ id: string; newStep: number }> }> {
  const now = new Date();
  const isManualSingleTarget = Boolean(params.forceImmediate && params.alertId);
  const eligibleStatuses = isManualSingleTarget
    ? ['open', 'escalated', 'acknowledged', 'snoozed']
    : ['open', 'escalated'];

  const candidates = await withSystemDb((tx) => {
    const conds = [inArray(alerts.status, eligibleStatuses)];
    if (params.patientId) conds.push(eq(alerts.patientId, params.patientId));
    if (params.alertId) conds.push(eq(alerts.id, params.alertId));
    if (!params.forceImmediate) {
      conds.push(lte(alerts.nextEscalationAt, now));
    }
    return tx
      .select()
      .from(alerts)
      .where(and(...conds))
      .orderBy(asc(alerts.createdAt));
  });

  const moved: Array<{ id: string; newStep: number }> = [];

  for (const al of candidates) {
    if (al.escalationStep >= 4 && !isManualSingleTarget) continue;
    const nextStep = al.escalationStep >= 4 ? 4 : Math.min(4, al.escalationStep + 1);
    const delayMin = escalationDelayMinutes(al.level as AlertLevel, nextStep + 1);
    const nextAt = nextStep < 4 ? new Date(now.getTime() + delayMin * 60_000) : null;

    await withSystemDb(async (tx) => {
      await tx
        .update(alerts)
        .set({
          status: 'escalated',
          snoozedUntil: null,
          escalationStep: nextStep,
          nextEscalationAt: nextAt,
          updatedAt: now,
        })
        .where(eq(alerts.id, al.id));

      await appendAuditLog(tx, {
        actorUserId: params.actorUserId ?? null,
        action: 'alert.escalated',
        targetType: 'alert',
        targetId: al.id,
        payload: {
          patientId: al.patientId,
          fromStep: al.escalationStep,
          toStep: nextStep,
          forced: Boolean(params.forceImmediate),
        },
      });
    });

    const prefix = al.isSynthetic ? '[SYNTHETIC] ' : '';
    const stepLabels = [
      'Patient Check',
      'Primary Caregiver Notice',
      'Secondary Caregiver Escalation',
      'Clinician Review Escalation',
      'EMERGENCY SAFETY PATH (112 / 108)',
    ];
    await enqueueDeliveriesForAlertStep({
      alertId: al.id,
      patientId: al.patientId,
      step: nextStep,
      level: al.level as AlertLevel,
      subject: `${prefix}ESCALATED Step ${nextStep}: ${stepLabels[nextStep]}`,
      bodyText: al.summaryEn,
      isSynthetic: al.isSynthetic,
    });
    await processOutboxBatch(al.patientId);

    publishPatientEvent({
      type: 'alert.escalated',
      patientId: al.patientId,
      timestamp: now.toISOString(),
      data: { alertId: al.id, step: nextStep },
    });

    moved.push({ id: al.id, newStep: nextStep });
  }

  return { escalatedCount: moved.length, alerts: moved };
}

/**
 * Applies Acknowledge / Snooze / Escalate / Resolve / Feedback action with bounded tuning.
 */
export async function applyAlertAction(params: {
  alertId: string;
  actorUserId: string | null;
  action: 'acknowledge' | 'snooze' | 'escalate' | 'resolve';
  note?: string;
  feedback?: 'helpful' | 'false_alarm' | 'expected_activity' | 'missed_symptom';
  snoozeMinutes?: number;
}): Promise<{
  alertId: string;
  status: string;
  escalationStep: number;
  message: string;
  updatedSensitivityOffset: number | null;
}> {
  const now = new Date();
  const [alertRow] = await withSystemDb((tx) =>
    tx.select().from(alerts).where(eq(alerts.id, params.alertId)).limit(1),
  );
  if (!alertRow) {
    throw new Error('Alert not found');
  }

  if (params.action === 'escalate') {
    const res = await escalateAlerts({
      alertId: alertRow.id,
      forceImmediate: true,
      actorUserId: params.actorUserId,
    });
    const nextStep = res.alerts[0]?.newStep ?? alertRow.escalationStep;
    const status = res.escalatedCount > 0 ? 'escalated' : alertRow.status;
    return {
      alertId: alertRow.id,
      status,
      escalationStep: nextStep,
      message:
        nextStep >= 4
          ? 'Emergency Step 4 active — emergency escalation dispatched (call 112 / 108 if urgent).'
          : `Alert escalated to Step ${nextStep}.`,
      updatedSensitivityOffset: null,
    };
  }

  let newStatus = 'acknowledged';
  let snoozedUntil: Date | null = null;
  if (params.action === 'snooze') {
    newStatus = 'snoozed';
    snoozedUntil = new Date(now.getTime() + (params.snoozeMinutes ?? 120) * 60_000);
  } else if (params.action === 'resolve') {
    newStatus = 'resolved';
  }

  const updatedOffset = await withSystemDb(async (tx) => {
    await tx
      .update(alerts)
      .set({
        status: newStatus,
        snoozedUntil,
        nextEscalationAt: null,
        acknowledgedBy: params.actorUserId,
        acknowledgedAt: now,
        acknowledgementNote: params.note ?? null,
        feedback: params.feedback ?? alertRow.feedback,
        updatedAt: now,
      })
      .where(eq(alerts.id, alertRow.id));

    let nextOffset: number | null = null;
    if (params.feedback) {
      const [profile] = await tx
        .select({ sensitivityOffset: patientProfiles.sensitivityOffset })
        .from(patientProfiles)
        .where(eq(patientProfiles.id, alertRow.patientId))
        .limit(1);
      if (profile) {
        nextOffset = computeBoundedSensitivityUpdate(profile.sensitivityOffset, params.feedback);
        await tx
          .update(patientProfiles)
          .set({ sensitivityOffset: nextOffset })
          .where(eq(patientProfiles.id, alertRow.patientId));
      }
    }

    await appendAuditLog(tx, {
      actorUserId: params.actorUserId,
      action: `alert.${params.action}`,
      targetType: 'alert',
      targetId: alertRow.id,
      payload: {
        patientId: alertRow.patientId,
        status: newStatus,
        feedback: params.feedback ?? null,
        updatedSensitivityOffset: nextOffset,
      },
    });

    return nextOffset;
  });

  publishPatientEvent({
    type: newStatus === 'resolved' ? 'alert.resolved' : 'alert.acknowledged',
    patientId: alertRow.patientId,
    timestamp: now.toISOString(),
    data: { alertId: alertRow.id, status: newStatus, updatedSensitivityOffset: updatedOffset },
  });

  return {
    alertId: alertRow.id,
    status: newStatus,
    escalationStep: alertRow.escalationStep,
    message:
      newStatus === 'snoozed'
        ? `Alert snoozed for ${params.snoozeMinutes ?? 120} minutes.`
        : newStatus === 'resolved'
          ? 'Alert marked resolved.'
          : 'Alert acknowledged and logged.',
    updatedSensitivityOffset: updatedOffset,
  };
}

/**
 * Creates a Step-1 clinical/support alert from a manual check-in ("I Don't Feel Well")
 * or a voice red-flag/callback request, enqueues Step 1 multi-channel deliveries
 * (patient + primary caregiver), processes the outbox immediately, and emits SSE.
 */
export async function triggerDirectCheckinAlert(params: {
  patientId: string;
  actorUserId?: string | null;
  alertType: 'checkin_unwell' | 'voice_checkin_urgent';
  level: 'warning' | 'urgent';
  ruleKey: string;
  summaryEn: string;
  summaryKn: string;
  summaryHi: string;
  isSynthetic?: boolean;
  now?: Date;
}): Promise<{
  alertId: string;
  outboxStats: Awaited<ReturnType<typeof processOutboxBatch>>;
}> {
  const now = params.now ?? new Date();
  const isSynthetic = Boolean(params.isSynthetic);
  const nextDelayMin = escalationDelayMinutes(params.level, 2);
  const nextEscalationAt = new Date(now.getTime() + nextDelayMin * 60_000);

  const alertId = await withSystemDb(async (tx) => {
    const [created] = await tx
      .insert(alerts)
      .values({
        patientId: params.patientId,
        alertType: params.alertType,
        level: params.level,
        ruleKey: params.ruleKey,
        summaryEn: params.summaryEn,
        summaryKn: params.summaryKn,
        summaryHi: params.summaryHi,
        status: 'open',
        escalationStep: 1,
        nextEscalationAt,
        isSynthetic,
      })
      .returning({ id: alerts.id });

    if (!created) throw new Error('Failed to create check-in alert row');

    await tx.insert(jobQueue).values({
      jobType: 'alert.escalate',
      payload: { alertId: created.id, patientId: params.patientId, nextStep: 2 },
      status: 'pending',
      runAfter: nextEscalationAt,
    });

    await appendAuditLog(tx, {
      actorUserId: params.actorUserId ?? null,
      action: 'alert.created',
      targetType: 'alert',
      targetId: created.id,
      payload: {
        patientId: params.patientId,
        alertType: params.alertType,
        level: params.level,
        isSynthetic,
      },
    });

    return created.id;
  });

  const prefix = isSynthetic ? '[SYNTHETIC] ' : '';
  const subject = `${prefix}Sachet - SENTINEL ${params.level.toUpperCase()} Caregiver Check-In Alert`;

  await enqueueDeliveriesForAlertStep({
    alertId,
    patientId: params.patientId,
    step: 1,
    level: params.level,
    subject,
    bodyText: params.summaryEn,
    isSynthetic,
  });

  const outboxStats = await processOutboxBatch(params.patientId);

  publishPatientEvent({
    type: 'alert.created',
    patientId: params.patientId,
    timestamp: now.toISOString(),
    data: {
      alertId,
      level: params.level,
      escalationStep: 1,
      source: params.alertType,
      isSynthetic,
      outboxStats,
    },
  });

  return { alertId, outboxStats };
}

const lastMaintenanceCheck = new Map<string, number>();

/**
 * Opportunistically advances overdue timed escalations (`nextEscalationAt <= now`)
 * and processes pending outbox retries without requiring external cron jobs.
 */
export async function processDueEscalationsIfNeeded(patientId?: string): Promise<void> {
  const key = patientId ?? '__all__';
  const nowMs = Date.now();
  const prev = lastMaintenanceCheck.get(key) ?? 0;
  if (nowMs - prev < 15_000) return;
  lastMaintenanceCheck.set(key, nowMs);

  try {
    const due = await withSystemDb((tx) => {
      const conds = [
        inArray(alerts.status, ['open', 'escalated']),
        lte(alerts.nextEscalationAt, new Date(nowMs)),
      ];
      if (patientId) conds.push(eq(alerts.patientId, patientId));
      return tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(and(...conds))
        .limit(5);
    });
    if (due.length > 0) {
      await escalateAlerts({ patientId });
    } else if (patientId) {
      await processOutboxBatch(patientId);
    }
  } catch {
    // Non-fatal background maintenance check
  }
}

export interface NotificationReadinessSummary {
  patientId: string | null;
  activeCaregivers: number;
  pendingCaregivers: number;
  userPushSubscriptions: number;
  recipientPushSubscriptions: number;
  channels: ChannelEnvReadiness;
}

/**
 * Returns truthful live configuration & Care Circle recipient readiness for all alert channels.
 */
export async function getNotificationReadiness(params: {
  userId: string;
  patientId: string | null;
}): Promise<NotificationReadinessSummary> {
  const channels = resolveChannelEnvReadiness();

  const dbStats = await withSystemDb(async (tx) => {
    const userSubs = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, params.userId));

    if (!params.patientId) {
      return {
        activeCaregivers: 0,
        pendingCaregivers: 0,
        userPushSubscriptions: userSubs.length,
        recipientPushSubscriptions: userSubs.length,
      };
    }

    const [profile] = await tx
      .select({ userId: patientProfiles.userId })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, params.patientId))
      .limit(1);

    const members = await tx
      .select({
        memberUserId: careCircleMembers.memberUserId,
        status: careCircleMembers.status,
      })
      .from(careCircleMembers)
      .where(eq(careCircleMembers.patientId, params.patientId));

    const grants = await tx
      .select({ granteeUserId: consentGrants.granteeUserId, scopes: consentGrants.scopes })
      .from(consentGrants)
      .where(
        and(eq(consentGrants.patientId, params.patientId), isNull(consentGrants.withdrawnAt)),
      );
    const alertConsented = new Set(
      grants
        .filter((g) => (g.scopes as string[]).includes('alerts_receive'))
        .map((g) => g.granteeUserId),
    );

    const activeMemberUserIds = members
      .filter((m) => m.status === 'active' && m.memberUserId && alertConsented.has(m.memberUserId))
      .map((m) => m.memberUserId!);
    const pendingCaregivers = members.filter((m) => m.status !== 'active').length;

    const targetUsers = [...new Set([params.userId, ...(profile?.userId ? [profile.userId] : []), ...activeMemberUserIds])];
    const recSubs =
      targetUsers.length > 0
        ? await tx
            .select({ id: pushSubscriptions.id })
            .from(pushSubscriptions)
            .where(inArray(pushSubscriptions.userId, targetUsers))
        : [];

    return {
      activeCaregivers: activeMemberUserIds.length,
      pendingCaregivers,
      userPushSubscriptions: userSubs.length,
      recipientPushSubscriptions: recSubs.length,
    };
  });

  return {
    patientId: params.patientId,
    ...dbStats,
    channels,
  };
}

/**
 * Dispatches a direct verification message across Web Push, ntfy, and Email (if configured)
 * without polluting clinical alert history.
 */
export async function sendTestAlertNotification(params: {
  userId: string;
  userEmail: string | null;
  userName: string;
  patientId: string | null;
}): Promise<{
  summary: string;
  results: Array<{ channel: string; status: string; receipt: string | null; error: string | null }>;
}> {
  const nowIso = new Date().toISOString().slice(11, 19);
  const subject = 'Sachet - SENTINEL Caregiver Alert Test';
  const bodyText = `Verification push triggered by ${params.userName} at ${nowIso} UTC. Active caregiver channels are ready.`;

  const subs = await withSystemDb((tx) =>
    tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, params.userId)),
  );

  const results: Array<{ channel: string; status: string; receipt: string | null; error: string | null }> = [];

  if (subs.length > 0) {
    for (const sub of subs) {
      const r = await dispatchChannelDelivery({
        channel: 'web_push',
        alertId: 'test-notification',
        recipientEmail: params.userEmail,
        recipientName: params.userName,
        subject,
        bodyText,
        actionToken: 'test',
        pushSubscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      });
      results.push({ channel: 'web_push', ...r });
    }
  } else {
    results.push({
      channel: 'web_push',
      status: 'not_subscribed',
      receipt: null,
      error: 'Click "Enable Browser Push Alerts" first on this browser.',
    });
  }

  const ntfyRes = await dispatchChannelDelivery({
    channel: 'ntfy',
    alertId: 'test-notification',
    recipientEmail: params.userEmail,
    recipientName: params.userName,
    subject,
    bodyText,
    actionToken: 'test',
  });
  results.push({ channel: 'ntfy', ...ntfyRes });

  if (process.env.RESEND_API_KEY && params.userEmail) {
    const emailRes = await dispatchChannelDelivery({
      channel: 'email',
      alertId: 'test-notification',
      recipientEmail: params.userEmail,
      recipientName: params.userName,
      subject,
      bodyText,
      actionToken: 'test',
    });
    results.push({ channel: 'email', ...emailRes });
  }

  const deliveredChannels = results.filter((r) => r.status === 'delivered').map((r) => r.channel);
  const summary =
    deliveredChannels.length > 0
      ? `Delivered test notification via: ${[...new Set(deliveredChannels)].join(', ')}.`
      : 'No external push/ntfy endpoint delivered — enable Browser Push on this device or check NTFY_TOPIC_URL / RESEND_API_KEY.';

  return { summary, results };
}
