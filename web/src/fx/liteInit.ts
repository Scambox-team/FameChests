// Importowany jako PIERWSZY w main.tsx: tryb wydajności musi działać, zanim jakikolwiek moduł zapyta o „ogranicz ruch”
import { installLite } from './perf';

installLite();
