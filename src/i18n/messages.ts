import translations from './translations.json';
export const tr = translations as Record<string, Record<string, string>>;
export const message = (key: string, locale = 'en') => tr[key]?.[locale] || tr[key]?.en || key;
