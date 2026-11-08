import { useEffect, useState } from 'react';

export interface LegalInfo {
  termsVersion: string;
  minAge: number;
  operator: string | null;
  contactEmail: string | null;
  /** konta z emailem i odzyskiwaniem hasła (Supabase Auth) */
  emailAuth: boolean;
  /** własny SMTP gry: emaile kont (opcjonalne bez Supabase Auth), reset hasła i zmiana emaila linkami */
  mail: boolean;
}

let cached: LegalInfo | null = null;

/** Dane o stronie do regulaminu (publiczne: działa też bez logowania) */
export function useLegal(): LegalInfo | null {
  const [info, setInfo] = useState<LegalInfo | null>(cached);
  useEffect(() => {
    if (cached) return;
    fetch('/api/legal').then(r => r.json()).then((d: LegalInfo) => { cached = d; setInfo(d); }).catch(() => {});
  }, []);
  return info;
}

/** Kategorie zgłoszeń: klucz zgodny z serwerem (routes/reports.rs), needsContact = trzeba podać e-mail */
export const REPORT_CATEGORIES = [
  { id: 'likeness', label: 'To ja (lub moja bliska osoba) i chcę usunięcia albo zmiany karty', needsContact: true },
  { id: 'copyright', label: 'Zdjęcie lub grafika na karcie narusza moje prawa autorskie', needsContact: true },
  { id: 'offensive', label: 'Opis, nazwa lub treść karty jest obraźliwa albo nieprawdziwa', needsContact: false },
  { id: 'error', label: 'Błąd na karcie (zły obraz, wariant, nazwa, wartość)', needsContact: false },
  { id: 'other', label: 'Inny problem z kartą', needsContact: false }
] as const;
