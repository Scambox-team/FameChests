import type { ReactNode } from 'react';
import { lang } from '../i18n/i18n';

/** Tytuł z ostatnim słowem w osobnym <span class="ed-em">: motyw Warm Editorial pisze je kursywą szeryfem (jak „just speak.” na stronach
 *  w stylu redakcyjnym), pozostałe motywy nic z tym nie robią. Po angielsku tytuł zostaje cały, żeby słownik tłumaczeń go znalazł. */
export function LastEm({ children }: { children: ReactNode }) {
  if (typeof children !== 'string' || lang !== 'pl') return <>{children}</>;
  const i = children.trimEnd().lastIndexOf(' ');
  if (i < 1) return <>{children}</>;
  return <>{children.slice(0, i + 1)}<span className="ed-em">{children.slice(i + 1)}</span></>;
}
