import { useLocation } from 'react-router-dom';

// Tylko na czas przenoszenia: w trybie dev adres, który serwer wciąż podaje ze starej wersji gry
export default function NotMoved() {
  const { pathname } = useLocation();
  return <p className="muted">Ten ekran ({pathname}) jest jeszcze w starej wersji gry.</p>;
}
