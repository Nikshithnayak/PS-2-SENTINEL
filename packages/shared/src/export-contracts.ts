import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ActivityContextSchema,
  AlertLevelSchema,
  ChannelTypeSchema,
  ConditionModuleSchema,
  ConsentScopeSchema,
  LocaleSchema,
  MetricTypeSchema,
  ProviderSourceSchema,
  QualityFlagSchema,
  RoleSchema,
} from './schemas.ts';
import { CANONICAL_UNITS, PHYSICAL_BOUNDS } from './units.ts';

const contracts = {
  version: '1.0.0',
  enums: {
    roles: RoleSchema.options,
    locales: LocaleSchema.options,
    conditionModules: ConditionModuleSchema.options,
    metricTypes: MetricTypeSchema.options,
    activityContexts: ActivityContextSchema.options,
    qualityFlags: QualityFlagSchema.options,
    alertLevels: AlertLevelSchema.options,
    consentScopes: ConsentScopeSchema.options,
    channelTypes: ChannelTypeSchema.options,
    providerSources: ProviderSourceSchema.options,
  },
  canonicalUnits: CANONICAL_UNITS,
  physicalBounds: PHYSICAL_BOUNDS,
};

const outPath = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../contracts/sentinel-contracts.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(contracts, null, 2)}\n`, 'utf8');
console.log(`Exported shared contracts to ${outPath}`);
