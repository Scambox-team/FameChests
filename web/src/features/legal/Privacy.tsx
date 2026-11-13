import { Link } from 'react-router-dom';
import { Mail, Operator, ReportLink } from './parts';
import type { LegalInfo } from './useLegal';
import s from './legal.module.css';

export function Privacy({ info }: { info: LegalInfo | null }) {
  return (
    <>
      <h1>Polityka prywatności</h1>
      <p className={s.meta}>Wersja z dnia {info?.termsVersion ?? '…'}</p>

      <h2>1. Kto przetwarza dane</h2>
      <p>Administratorem danych jest <Operator info={info} />. Kontakt w sprawach danych osobowych: <Mail info={info} />.</p>
      <p>ScamBox to nieodpłatna gra-parodia (<Link to="/o-stronie">O stronie</Link>). Nie prowadzimy sprzedaży, reklam ani analityki, nie profilujemy graczy i nie sprzedajemy danych.</p>

      <h2>2. Jakie dane i po co</h2>
      <table className={s.table}>
        <thead><tr><th>Dane</th><th>Cel</th><th>Podstawa (RODO)</th></tr></thead>
        <tbody>
          <tr><td>Nazwa gracza, hasło (zapisane jako skrót, nie wprost), data założenia konta</td><td>Założenie konta i prowadzenie gry</td><td>Art. 6 ust. 1 lit. b (umowa: Regulamin)</td></tr>
          <tr><td>Przebieg gry: karty, saldo, wymiany, rynek, znajomi, wiadomości w grze, ranking, osiągnięcia</td><td>Działanie gry i funkcji społecznościowych</td><td>Art. 6 ust. 1 lit. b</td></tr>
          <tr><td>Adres IP (w pamięci serwera, tymczasowo)</td><td>Ochrona przed zgadywaniem haseł i masowym wysyłaniem zgłoszeń</td><td>Art. 6 ust. 1 lit. f (bezpieczeństwo)</td></tr>
          <tr><td>Lokalizacja (tylko po kliknięciu „Zaznacz moją lokalizację” w zakładce Paszport): kod państwa i data zdobycia stempla oraz państwo i czas ostatniej lokalizacji (do sprawdzenia, czy zmiana miejsca była możliwa)</td><td>Przyznanie stempla państwa w Paszporcie</td><td>Art. 6 ust. 1 lit. a (Twoja zgoda; możesz jej nie dawać, a gra działa bez Paszportu)</td></tr>
          <tr><td>Potwierdzenie akceptacji regulaminu: wersja i data</td><td>Dowód zgody na zasady</td><td>Art. 6 ust. 1 lit. f</td></tr>
          <tr><td>Zgłoszenia kart: treść, nazwa karty, e-mail (jeśli podasz), nazwa gracza (jeśli zalogowany)</td><td>Rozpatrzenie zgłoszenia i odpowiedź</td><td>Art. 6 ust. 1 lit. f (ochrona praw osób, których dotyczą karty)</td></tr>
          <tr><td>Dziennik działań administratorów (np. blokady, zmiany sald)</td><td>Bezpieczeństwo i rozliczalność</td><td>Art. 6 ust. 1 lit. f</td></tr>
        </tbody>
      </table>
      <p>Podanie danych jest dobrowolne, ale bez nazwy i hasła nie założysz konta. <b>Nie prosimy o imię, nazwisko, adres ani numer telefonu</b> i nie musisz ich nam podawać. Zakładka Paszport jest opcjonalna: pozycję z GPS wysyła Twoja przeglądarka dopiero po kliknięciu przycisku i zgodzie na lokalizację, serwer ustala z niej wyłącznie państwo (granice są wbudowane w serwer, współrzędne nie trafiają do żadnych zewnętrznych usług), po czym je zapomina: zapisujemy sam kod państwa z datą (i ostatnie państwo z czasem, do wykrywania podrabianej lokalizacji), a dokładnej pozycji nie zapisujemy ani nie pokazujemy nikomu. Nazwy graczy, którzy zdobyli dany stempel, widzą inni gracze. E-mail jest potrzebny tylko wtedy, gdy zgłaszasz usunięcie karty lub naruszenie praw autorskich, żebyśmy mogli odpisać.</p>

      <h2>3. Pliki cookie i pamięć przeglądarki</h2>
      <ul>
        <li><b>Ciasteczko sesji</b> (<code>scambox_session</code>) utrzymuje zalogowanie. Jest niezbędne do działania gry i nie służy do śledzenia.</li>
        <li><b>Pamięć lokalna przeglądarki</b> zapisuje ustawienia, np. dźwięk, sortowanie, zwinięte panele. Zostają na Twoim urządzeniu.</li>
        <li>Nie używamy cookie reklamowych ani analitycznych, dlatego nie pokazujemy banera z wyborem zgód.</li>
      </ul>

      <h2>4. Zewnętrzne czcionki</h2>
      <p>Strona ładuje czcionki z usługi Google Fonts. Przeglądarka łączy się wtedy z serwerami Google, które widzą Twój adres IP i dane przeglądarki. Zdjęcia kart, flagi i dźwięki wysyła nasz serwer, a nie zewnętrzne serwisy.</p>

      <h2>5. Komu przekazujemy dane</h2>
      <p>Dane przetwarzają dostawcy infrastruktury, z których korzystamy (hosting aplikacji i baza danych), na podstawie umów powierzenia. Treść zgłoszeń kart (razem z podanym adresem e-mail i nazwą gracza) trafia też na prywatny kanał administratorów w serwisie Discord, żeby można je było szybko rozpatrzyć; dostęp do niego mają tylko administratorzy gry. Dane osobowe mogą być przekazywane poza Europejski Obszar Gospodarczy tylko z zachowaniem zabezpieczeń wymaganych przez RODO. Nie sprzedajemy danych i nie udostępniamy ich reklamodawcom. Dane możemy ujawnić organom publicznym, jeśli prawo tego wymaga.</p>
      <p>Nazwa gracza, avatar, karty w gablocie i pozycja w rankingu są widoczne dla innych graczy. Wybierz nazwę, która nie ujawnia Twoich danych.</p>

      <h2>6. Jak długo</h2>
      <ul>
        <li>Dane konta i gry: dopóki masz konto. Po usunięciu konta kasujemy dane gry; dane niezbędne do obrony przed roszczeniami możemy zachować do czasu przedawnienia.</li>
        <li>Zgłoszenia kart: do rozpatrzenia, a potem do 12 miesięcy.</li>
        <li>Dziennik działań administratorów: do 12 miesięcy.</li>
        <li>Adresy IP w limiterze: tylko w pamięci serwera, do godziny. Znikają po restarcie.</li>
      </ul>

      <h2>7. Twoje prawa</h2>
      <p>Masz prawo do: dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia oraz sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie (art. 15–21 RODO). Napisz na <Mail info={info} />, a odpowiemy w ciągu miesiąca. Możesz też złożyć skargę do <b>Prezesa Urzędu Ochrony Danych Osobowych</b> (uodo.gov.pl).</p>

      <h2>8. Osoby, których dotyczą karty</h2>
      <p>Karty z postaciami zawierają nazwę i grafikę osoby (często publicznej). Jeśli jesteś taką osobą albo jej bliskim i chcesz usunięcia lub zmiany karty albo informacji, jakie dane przetwarzamy, użyj <ReportLink />. Rozpatrzymy zgłoszenie zgodnie z <Link to="/regulamin">Regulaminem</Link> (§ 6).</p>

      <h2>9. Bezpieczeństwo</h2>
      <p>Hasła zapisujemy jako skrót, ciasteczko sesji jest podpisane, a logowanie jest chronione limitem prób. Jeśli dojdzie do naruszenia ochrony danych, które grozi Twoim prawom, powiadomimy Cię i organ nadzorczy w trybie wymaganym prawem.</p>

      <h2>10. Zmiany</h2>
      <p>Zmiany polityki publikujemy tutaj z nową datą wersji, a istotne zmiany zgłaszamy graczom przy wejściu do gry.</p>
    </>
  );
}
