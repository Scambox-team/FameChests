import type { ReactNode } from 'react';

/** Nazwa gracza poza linkiem (jackpot, poker, wymiany, wiadomości...): najechanie albo dotknięcie pokazuje miniprofil (`PlayerCard`).
 *  Link do `/player/<nazwa>` i `UserLink` robią to samo bez żadnych dodatków - tu chodzi o zwykły tekst. */
export function PlayerName({ name, children, className }: { name: string; children?: ReactNode; className?: string }) {
  return <span className={className} data-player={name} tabIndex={0} style={{ cursor: 'help' }}>{children ?? name}</span>;
}
