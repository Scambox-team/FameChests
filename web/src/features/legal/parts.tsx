import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import s from './legal.module.css';
import type { LegalInfo } from './useLegal';

/** Brak danych w konfiguracji serwera widać na stronie, żeby nikt nie opublikował jej z pustym polem */
export function Todo({ children }: { children: ReactNode }) {
  return <span className={s.todo}>[{children}]</span>;
}

export function Operator({ info }: { info: LegalInfo | null }) {
  return info?.operator ? <b>{info.operator}</b> : <Todo>uzupełnij OPERATOR_NAME na serwerze</Todo>;
}

export function Mail({ info }: { info: LegalInfo | null }) {
  return info?.contactEmail ? <a href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a> : <Todo>uzupełnij CONTACT_EMAIL na serwerze</Todo>;
}

export function ReportLink({ children = 'formularz zgłoszeń' }: { children?: ReactNode }) {
  return <Link to="/zglos">{children}</Link>;
}
