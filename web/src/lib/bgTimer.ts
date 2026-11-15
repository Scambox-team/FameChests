// Minutnik, który działa też w ukrytej karcie. Przeglądarki przycinają setTimeout w tle (Chrome po kilku minutach
// odpala łańcuch minutników raz na minutę), a minutniki w Web Workerze nie są tak przycinane.
// Autootwieranie skrzynek używa go, bo gracze zostawiają je w tle. Bez Workera zostaje zwykły setTimeout.
let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, () => void>();

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    const src = 'onmessage=e=>{const[id,ms]=e.data;setTimeout(()=>postMessage(id),ms)}';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = e => { const f = waiting.get(e.data); waiting.delete(e.data); f?.(); };
    worker.onerror = () => { worker = null; waiting.forEach(f => f()); waiting.clear(); };
  } catch { worker = null; }
  return worker;
}

export function bgTimeout(fn: () => void, ms: number) {
  const w = getWorker();
  if (!w) { setTimeout(fn, ms); return; }
  const id = ++seq;
  waiting.set(id, fn);
  w.postMessage([id, ms]);
}

export const bgSleep = (ms: number) => new Promise<void>(r => bgTimeout(r, ms));
