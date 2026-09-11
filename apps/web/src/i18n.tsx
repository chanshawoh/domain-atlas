import { useSyncExternalStore } from 'react';
import { english } from './messages';

export type Locale = 'zh' | 'en';
const storageKey = 'domainatlas.ui.language';

// The browser locale supplies the region; no location lookup is needed.
export function defaultLocale(language: string): Locale {
  try {
    const locale = new Intl.Locale(language);
    return locale.region
      ? ['CN', 'TW', 'HK', 'MO'].includes(locale.region) ? 'zh' : 'en'
      : locale.language === 'zh' ? 'zh' : 'en';
  } catch { return 'en'; }
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* Browser storage may be disabled. */ }
  return defaultLocale(navigator.languages?.[0] || navigator.language);
}

let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useLocale = () => useSyncExternalStore(subscribe, getLocale);

export function t(message: string, values: Record<string, string | number> = {}): string {
  const template = locale === 'en' ? english[message] ?? message : message;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}

// API diagnostics are UI text; only translate known messages/prefixes, never facts or paths.
export function serviceMessage(message: string): string {
  if (locale === 'zh') return message;
  if (english[message]) return english[message];
  for (const [prefix, translated] of Object.entries(english)) {
    if (prefix.endsWith('：') && message.startsWith(prefix)) {
      return translated + serviceMessage(message.slice(prefix.length));
    }
  }
  return message;
}

function updateDocument() {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = 'DomainAtlas · ' + t('业务地图');
}
updateDocument();

function setLocale(next: Locale) {
  locale = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the session choice. */ }
  updateDocument();
  listeners.forEach(listener => listener());
}

export function LanguageSwitcher() {
  const value = useLocale();
  return <select className="language-switcher" aria-label={t('语言')} value={value}
    onChange={event => setLocale(event.target.value as Locale)}>
    <option value="zh">中文</option><option value="en">English</option>
  </select>;
}
