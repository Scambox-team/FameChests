import { Link } from 'react-router-dom';
import { Mail, Operator, ReportLink } from './parts';
import type { LegalInfo } from './useLegal';
import s from './legal.module.css';

export function Terms({ info }: { info: LegalInfo | null }) {
  return (
    <>
      <h1>Regulamin ScamBox</h1>
      <p className={s.meta}>Wersja z dnia {info?.termsVersion ?? '…'}</p>

      <h2>§ 1. Postanowienia ogólne</h2>
      <ol>
        <li>ScamBox (dalej: „Serwis”) to <b>nieodpłatna</b> gra internetowa o charakterze rozrywkowym, satyrycznym i parodystycznym. Opisuje ją strona <Link to="/o-stronie">O stronie</Link>.</li>
        <li>Usługodawcą jest <Operator info={info} /> (dalej: „Usługodawca”). Kontakt: <Mail info={info} /> oraz <ReportLink />.</li>
        <li>Regulamin określa zasady korzystania z Serwisu i jest regulaminem w rozumieniu art. 8 ustawy o świadczeniu usług drogą elektroniczną.</li>
        <li>Serwis wymaga przeglądarki internetowej z włączoną obsługą JavaScript i plików cookie sesji.</li>
      </ol>

      <h2>§ 2. Serwis jest parodią, nie hazardem</h2>
      <ol>
        <li>Serwis jest <b>parodią</b> nielegalnych serwisów hazardowych opartych na „skrzynkach”. Ma pokazywać ich mechanizmy w żartobliwy sposób i nie zachęca do korzystania z takich serwisów.</li>
        <li>Waluta w grze oraz skrzynki, karty i warianty są <b>wirtualne i nie mają żadnej wartości pieniężnej</b>. Nie można ich kupić za prawdziwe pieniądze, wypłacić, wymienić na pieniądze, towary ani usługi.</li>
        <li>W Serwisie nie ma wpłat, opłat, subskrypcji, reklam ani zbiórek. Żadna funkcja gry (w tym kasyno, ruletka, jackpot, wyścigi) nie obejmuje wygranych pieniężnych ani rzeczowych.</li>
        <li>Jeśli hazard w prawdziwym życiu sprawia Ci trudność, skorzystaj z pomocy specjalisty, np. poradni leczenia uzależnień.</li>
      </ol>

      <h2>§ 3. Konto i wiek</h2>
      <ol>
        <li>Z Serwisu mogą korzystać osoby, które ukończyły <b>{info?.minAge ?? 16} lat</b>. Zakładając konto, potwierdzasz, że spełniasz ten warunek.</li>
        <li>Jedna osoba może mieć jedno konto. Hasło jest tajne; odpowiadasz za działania wykonane z Twojego konta, chyba że wynikły z naszej winy.</li>
        <li>Nazwa gracza nie może naruszać praw innych osób ani być obraźliwa, wulgarna lub podszywać się pod inną osobę lub administratora.</li>
        <li>Konto możesz usunąć, pisząc do nas (§ 11).</li>
      </ol>

      <h2>§ 4. Zasady korzystania</h2>
      <p>Zabronione jest w szczególności:</p>
      <ul>
        <li><b>sprzedawanie, kupowanie i wymienianie kont, kart lub waluty z gry na prawdziwe pieniądze lub inne realne korzyści</b> (także poza Serwisem);</li>
        <li>używanie botów, skryptów, błędów gry i innych sposobów na obejście zasad albo wyłudzenie nagród;</li>
        <li>zakładanie wielu kont w celu zdobycia przewagi;</li>
        <li>zakłócanie działania Serwisu, próby włamania lub uzyskania dostępu do cudzych kont i danych;</li>
        <li>wiadomości i opisy zawierające treści bezprawne, nienawistne, wulgarne lub naruszające prawa innych osób.</li>
      </ul>
      <p>Za naruszenie możemy ostrzec gracza, usunąć nielegalnie zdobyte elementy gry, zablokować albo usunąć konto.</p>

      <h2>§ 5. Elementy wirtualne</h2>
      <ol>
        <li>Skrzynki, karty, waluta i osiągnięcia to wyłącznie elementy gry. Nie stanowią własności ani mienia w rozumieniu prawa i nie można z nich korzystać poza Serwisem.</li>
        <li>Usługodawca może zmieniać zasady gry, szanse, wartości, wygląd kart i salda, naprawiać błędy oraz resetować dane, jeśli jest to potrzebne do działania Serwisu lub uczciwej gry. Z tego tytułu nie przysługują rekompensaty.</li>
      </ol>

      <h2>§ 6. Karty z osobami i postaciami</h2>
      <ol>
        <li>Karty mają charakter <b>satyryczny i parodystyczny</b>. Obecność osoby lub postaci na karcie, jej nazwa, grafika, opis i statystyki <b>nie oznaczają</b>, że osoba ta współpracuje z Serwisem, go popiera lub z nim się wiąże.</li>
        <li>Statystyki i opisy na kartach są żartem. <b>Nie są stwierdzeniami o faktach</b> ani oceną żadnej osoby.</li>
        <li>Jeśli uważasz, że karta narusza Twoje prawa (wizerunek, dobra osobiste, prawa autorskie) lub prawa kogoś, kogo reprezentujesz, wyślij <ReportLink>zgłoszenie</ReportLink>. Nie musisz mieć konta.</li>
        <li>Zgłoszenia rozpatrujemy bez zbędnej zwłoki i staramy się odpowiedzieć w ciągu 14 dni. Jeśli zgłoszenie jest uzasadnione, <b>kartę usuwamy albo zmieniamy</b>. Do czasu rozpatrzenia możemy ją tymczasowo ukryć.</li>
      </ol>

      <h2>§ 7. Zgłoszenia i reklamacje</h2>
      <ol>
        <li>Błędy, uwagi do działania Serwisu i problemy z kartą zgłaszasz przez <ReportLink /> (problem z kartą) lub e-mailem (pozostałe sprawy).</li>
        <li>Zgłoszenie powinno zawierać opis problemu, a przy karcie jej nazwę. Odpowiadamy w ciągu 14 dni.</li>
      </ol>

      <h2>§ 8. Odpowiedzialność</h2>
      <ol>
        <li>Serwis działa w stanie, w jakim jest („tak jak jest”). Nie gwarantujemy nieprzerwanego działania, możemy robić przerwy techniczne i zakończyć Serwis.</li>
        <li>Ponieważ usługa jest nieodpłatna, odpowiadamy za szkody tylko wtedy, gdy wyrządziliśmy je umyślnie lub przez rażące niedbalstwo, w granicach dopuszczalnych przez prawo. Nie wyłączamy odpowiedzialności, której wyłączyć nie można.</li>
        <li>Nie odpowiadamy za utratę elementów wirtualnych (§ 5), chyba że wynika to z naszej winy.</li>
      </ol>

      <h2>§ 9. Dane osobowe</h2>
      <p>Zasady przetwarzania danych opisuje <Link to="/prywatnosc">Polityka prywatności</Link>.</p>

      <h2>§ 10. Zmiany regulaminu</h2>
      <ol>
        <li>Możemy zmienić Regulamin z ważnych powodów (zmiana prawa, funkcji gry, zasad bezpieczeństwa). Zmiany publikujemy na tej stronie z nową datą wersji.</li>
        <li>Po istotnej zmianie poprosimy zalogowanych graczy o ponowną akceptację przy następnym wejściu do gry. Bez akceptacji nie można dalej grać.</li>
      </ol>

      <h2>§ 11. Zakończenie korzystania</h2>
      <p>Możesz w każdej chwili przestać korzystać z Serwisu. Usunięcia konta i danych możesz zażądać pod adresem <Mail info={info} />. Usługodawca może zakończyć świadczenie usługi lub zablokować konto z powodu naruszenia Regulaminu (§ 4).</p>

      <h2>§ 12. Postanowienia końcowe</h2>
      <ol>
        <li>Do Regulaminu stosuje się prawo polskie. Jeśli jesteś konsumentem, obowiązkowe przepisy chroniące konsumentów nadal przysługują Ci w pełnym zakresie.</li>
        <li>Spory rozstrzygają sądy właściwe według przepisów powszechnych.</li>
      </ol>
    </>
  );
}
