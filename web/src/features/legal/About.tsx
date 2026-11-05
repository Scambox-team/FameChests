import { Link } from 'react-router-dom';
import { Info, ShieldCheck } from 'lucide-react';
import { Mail, ReportLink } from './parts';
import type { LegalInfo } from './useLegal';
import s from './legal.module.css';

export function About({ info }: { info: LegalInfo | null }) {
  return (
    <>
      <h1>O stronie</h1>
      <p className={s.lead}>ScamBox to <b>parodia</b> nielegalnych serwisów z hazardem na skrzynki. Przerysowujemy ich metody (wszechobecne „szanse”, błyskotliwe animacje, „kasyno” bez żadnych zasad), żeby pokazać, jak działają. Nikt tu niczego nie sprzedaje, nic nie kosztuje i niczego nie da się wygrać.</p>

      <div className={s.callout}>
        <ShieldCheck size={20} aria-hidden="true" />
        <p><b>To nie jest hazard.</b> Waluta jest fikcyjna. Nie ma wpłat, wypłat, sklepu ani reklam. Karty i „pieniądze” nie mają żadnej wartości poza grą i nie można ich wymienić na nic prawdziwego.</p>
      </div>

      <h2>Karty z osobami i postaciami</h2>
      <p>Karty są <b>satyrą i karykaturą</b>. Osoby i postacie na nich nie mają nic wspólnego z tą stroną i jej nie popierają. Opisy i statystyki to żart, a nie opinie o faktach.</p>
      <div className={s.callout}>
        <Info size={20} aria-hidden="true" />
        <p><b>Jesteś na jednej z kart albo reprezentujesz kogoś takiego?</b> Nie musisz mieć konta. Wyślij <ReportLink>zgłoszenie</ReportLink> (wybierz „To ja… chcę usunięcia”), a rozpatrzymy je w ciągu 14 dni. Jeśli zgłoszenie jest uzasadnione, kartę usuniemy albo zmienimy.</p>
      </div>

      <h2>Pomoc przy problemach z hazardem</h2>
      <p>Jeśli granie w prawdziwe gry losowe sprawia Ci trudność, nie szukaj pomocy w grze. Skorzystaj z poradni leczenia uzależnień albo z pomocy lekarza lub terapeuty.</p>

      <h2>Źródła grafik i dźwięków</h2>
      <ul>
        <li>Zdjęcia kart pochodzą głównie z Wikipedii i Wikimedia Commons (wolne licencje). Autora i licencję każdego zdjęcia wskazuje jego strona w Wikimedia Commons. Jeśli jesteś autorem i chcesz poprawić podpis, <ReportLink>napisz</ReportLink>.</li>
        <li>Dźwięki: nagrania na licencji CC0 (freesound.org oraz pakiety Kenney).</li>
        <li>Postacie historyczne i karty własne: grafiki w domenie publicznej lub nasze rysunki.</li>
      </ul>

      <h2>Zasady i dane</h2>
      <ul>
        <li><Link to="/regulamin">Regulamin</Link></li>
        <li><Link to="/prywatnosc">Polityka prywatności</Link></li>
        <li><ReportLink>Zgłoś problem z kartą</ReportLink></li>
        <li>Kontakt: <Mail info={info} /></li>
      </ul>
    </>
  );
}
