import { strings, type Lang, type StringKey } from './strings';

const STORAGE_KEY = 'kotabaru.lang';
let lang: Lang = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in strings) return v as Lang;
  } catch { /* ignore */ }
  return 'en';
})();
const listeners = new Set<() => void>();

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = strings[lang][key] ?? strings.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** For keys built at runtime (e.g. `cat.${category}`); falls back to the key itself. */
export function tk(key: string, params?: Record<string, string | number>): string {
  return t(key as StringKey, params);
}

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Bahasa Indonesia' },
];
