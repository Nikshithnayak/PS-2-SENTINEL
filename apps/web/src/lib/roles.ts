import type { Role } from '@sentinel/shared';
import {
  Activity,
  BellRing,
  BookOpen,
  Database,
  FileText,
  FlaskConical,
  HeartHandshake,
  LineChart,
  Mic,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';

export interface RoleNavItem {
  href: string;
  label: string;
  icon: typeof Activity;
}

export interface RoleNavGroup {
  id: string;
  title: string;
  items: RoleNavItem[];
}

export interface RoleWorkspaceConfig {
  role: Role;
  homeHref: string;
  badgeLabel: string;
  portalSubtitle: string;
  badgeClassName: string;
  sidebarGroups: RoleNavGroup[];
  mobileTabs: RoleNavItem[];
  mobileQuickLinks: RoleNavItem[];
}

export function getRoleWorkspaceConfig(role: Role): RoleWorkspaceConfig {
  switch (role) {
    case 'caregiver':
      return {
        role: 'caregiver',
        homeHref: '/caregiver',
        badgeLabel: 'Caregiver Monitor',
        portalSubtitle: 'Care Circle & Triage',
        badgeClassName:
          'border-[var(--status-watch)] bg-[var(--status-watch-bg)] text-[var(--status-watch)]',
        sidebarGroups: [
          {
            id: 'caregiver-core',
            title: 'Caregiver Workspace',
            items: [
              { href: '/caregiver', label: 'Family Monitor', icon: ShieldCheck },
              { href: '/alerts', label: 'Live Alerts & 112', icon: BellRing },
              { href: '/settings/consent', label: 'Care Circle & Consent', icon: Users },
            ],
          },
          {
            id: 'caregiver-tools',
            title: 'Elder Support Tools',
            items: [
              { href: '/ingest', label: 'Connect Watch / Phone', icon: Database },
              { href: '/settings', label: 'Care Preferences', icon: Settings },
            ],
          },
        ],
        mobileTabs: [
          { href: '/caregiver', label: 'Monitor', icon: ShieldCheck },
          { href: '/alerts', label: 'Alerts', icon: BellRing },
          { href: '/ingest', label: 'Watch', icon: Database },
          { href: '/settings/consent', label: 'Circle', icon: Users },
          { href: '/settings', label: 'Settings', icon: Settings },
        ],
        mobileQuickLinks: [
          { href: '/alerts', label: 'Emergency 112 & Hospitals', icon: BellRing },
          { href: '/settings/consent', label: 'Care Circle', icon: Users },
          { href: '/ingest', label: 'Watch Setup', icon: Database },
        ],
      };

    case 'clinician':
    case 'org_admin':
      return {
        role,
        homeHref: '/clinician',
        badgeLabel: role === 'org_admin' ? 'Clinical Admin' : 'Clinician Workstation',
        portalSubtitle: 'Cohort Triage & FHIR',
        badgeClassName:
          'border-[var(--brand-primary)] bg-[var(--bg-mint-panel)] text-[var(--brand-accent-text)]',
        sidebarGroups: [
          {
            id: 'clinician-core',
            title: 'Clinical Decision Support',
            items: [
              { href: '/clinician', label: 'Cohort Triage', icon: Stethoscope },
              { href: '/clinician/scribe', label: 'OPD Scribe', icon: Mic },
              { href: '/signals', label: 'Signals Explorer', icon: LineChart },
              { href: '/clinician/report', label: 'SBAR & FHIR Reports', icon: FileText },
              { href: '/alerts', label: 'Escalation Ledger', icon: BellRing },
            ],
          },
          {
            id: 'clinician-validation',
            title: 'Validation & Governance',
            items: [
              { href: '/eval', label: 'Evaluation Lab', icon: FlaskConical },
              { href: '/model-card', label: 'Model Card & Safety', icon: BookOpen },
              { href: '/settings/consent', label: 'Consent & Audit', icon: ShieldCheck },
              { href: '/settings', label: 'Settings', icon: Settings },
            ],
          },
        ],
        mobileTabs: [
          { href: '/clinician', label: 'Triage', icon: Stethoscope },
          { href: '/signals', label: 'Signals', icon: LineChart },
          { href: '/clinician/report', label: 'Reports', icon: FileText },
          { href: '/alerts', label: 'Alerts', icon: BellRing },
          { href: '/eval', label: 'Eval Lab', icon: FlaskConical },
        ],
        mobileQuickLinks: [
          { href: '/clinician/scribe', label: 'Ambient OPD Scribe', icon: Mic },
          { href: '/clinician/report', label: 'PDF / FHIR R4', icon: FileText },
          { href: '/eval', label: 'Evaluation Lab', icon: FlaskConical },
          { href: '/model-card', label: 'Model Card', icon: BookOpen },
          { href: '/settings/consent', label: 'Audit Chain', icon: ShieldCheck },
        ],
      };

    case 'patient':
    default:
      return {
        role: 'patient',
        homeHref: '/today',
        badgeLabel: 'Elder Care View',
        portalSubtitle: 'Personal Daily Mode',
        badgeClassName:
          'border-[var(--status-stable)] bg-[var(--status-stable-bg)] text-[var(--status-stable)]',
        sidebarGroups: [
          {
            id: 'patient-daily',
            title: 'My Daily Care',
            items: [
              { href: '/today', label: 'Today & Voice Chat', icon: HeartHandshake },
              { href: '/ingest', label: 'Connect Watch / Phone', icon: Database },
              { href: '/signals', label: 'My Health Trends', icon: LineChart },
              { href: '/alerts', label: 'My Alerts & 112', icon: BellRing },
            ],
          },
          {
            id: 'patient-circle',
            title: 'Family & Preferences',
            items: [
              { href: '/settings/consent', label: 'My Care Circle', icon: Users },
              { href: '/settings', label: 'Settings', icon: Settings },
            ],
          },
        ],
        mobileTabs: [
          { href: '/today', label: 'Today', icon: HeartHandshake },
          { href: '/signals', label: 'Trends', icon: LineChart },
          { href: '/ingest', label: 'Watch', icon: Database },
          { href: '/alerts', label: 'Alerts', icon: BellRing },
          { href: '/settings', label: 'Settings', icon: Settings },
        ],
        mobileQuickLinks: [
          { href: '/settings/consent', label: 'My Care Circle', icon: Users },
          { href: '/alerts', label: 'Emergency 112 Help', icon: BellRing },
        ],
      };
  }
}
