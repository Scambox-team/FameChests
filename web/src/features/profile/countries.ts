import COUNTRIES from '../passport/countries.json';
import { lang } from '../../i18n/i18n';

// Kraj w profilu (opis i kraj są darmowe): te same państwa co w Paszporcie (countries.json), flaga z /flag/<kod>.svg (serwer pobiera ją z flagcdn.com)
interface C { c: string; pl: string; en: string }
const ALL = (COUNTRIES as C[]).slice().sort((a, b) => a.pl.localeCompare(b.pl, 'pl'));
export const countryOptions = () => ALL.map(c => ({ code: c.c, name: lang === 'en' ? c.en : c.pl }));
export const countryName = (code: string) => { const c = ALL.find(x => x.c === code); return c ? (lang === 'en' ? c.en : c.pl) : ''; };
export const flagUrl = (code: string) => `/flag/${code.toLowerCase()}.svg`;
