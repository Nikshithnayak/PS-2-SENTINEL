import en from '@/messages/en.json';
import kn from '@/messages/kn.json';
import hi from '@/messages/hi.json';

export type SupportedLocale = 'en' | 'kn' | 'hi';
export type SentinelMessages = typeof en;

const CATALOGS: Record<SupportedLocale, SentinelMessages> = { en, kn, hi };

export function getCatalog(locale: string | undefined): SentinelMessages {
  if (locale === 'kn' || locale === 'hi' || locale === 'en') {
    return CATALOGS[locale];
  }
  return en;
}
