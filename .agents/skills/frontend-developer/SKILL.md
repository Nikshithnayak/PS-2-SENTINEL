---
name: frontend-developer
description: SENTINEL Frontend Developer skill (adapted from react-frontend-skills MIT). Enforces Next.js 16 App Router, React 19, TypeScript strict, TanStack Query, ECharts, and PWA performance budgets.
---

# Frontend Developer — SENTINEL

## Core Focus
- Follow **Next.js 16.4+** App Router architecture: `proxy.ts` for network/auth boundary, Server Components for initial data, client islands for interactive ECharts/SSE/WebGL.
- Strict TypeScript (`strict: true`, zero `any`), shared Zod validation from `packages/shared`, typed `next-intl` translations (`en`, `kn`, `hi`).
- Every chart and list must implement all 5 states: **Loading** (fixed-height skeleton preventing CLS), **Empty** (Day-0 guidance), **Learning** (Day N of 14 badge), **Error** (actionable retry), and **Offline** (PWA cached banner).
- Use Apache ECharts Canvas mode for multi-day zoomable clinical traces with keyboard-accessible data tables.
- Performance budgets: mid-range Android 4G LCP < 2.5s, Lighthouse Performance >= 90, Accessibility = 100, zero console errors.
