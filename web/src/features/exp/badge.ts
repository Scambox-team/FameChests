// Odznaka „za służbę w roku RRRR” (level 100): medal z ząbkowanym brzegiem, wstążki w kolorze skrzynki (--hue), gwiazda i rok.
// Poziom odznaki (1-13) rośnie z liczbą dojść do levelu 100 w tym samym roku: zwykła, brązowa, srebrna, złota, platynowa, szmaragdowa,
// ametystowa, rubinowa, szafirowa, diamentowa, czarny diament, lonsdaleit i papieska (klucze i szkło jak w wariantach kart; lonsdaleit jak wariant karty `lonsdaleite`: złoty heks,
// ciemny bursztyn i siatka sześciokątów; papieska to nawiązanie do
// tajnej karty Jana Pawła II: biało-złota, ze skrzyżowanymi kluczami i krzyżem). Rysowana jako SVG w kodzie (bez obrazków i emotek);
// napis na łuku to textPath. Każdy egzemplarz ma własne id gradientów.
export const BADGE_NAMES = ['Zwykła', 'Brązowa', 'Srebrna', 'Złota', 'Platynowa', 'Szmaragdowa', 'Ametystowa', 'Rubinowa', 'Szafirowa', 'Diamentowa', 'Czarny diament', 'Lonsdaleit', 'Papieska'];

// [jasny, średni, ciemny] odcień medalu, kolor napisów, [jasny, ciemny] odcień obrzeża
const PALETTE: { face: [string, string, string]; ink: string; rim: [string, string, string] }[] = [
  { face: ['#f1f3f5', '#b5bcc4', '#6b7480'], ink: '#2c333b', rim: ['#ffffff', '#9aa3ad', '#5b6470'] },
  { face: ['#f6d3b0', '#c9803f', '#7a431a'], ink: '#3d2008', rim: ['#f3c9a0', '#b9722f', '#6a3814'] },
  { face: ['#ffffff', '#cfd6de', '#8791a0'], ink: '#2d3540', rim: ['#ffffff', '#c4ccd6', '#7a8494'] },
  { face: ['#fbe9a6', '#d4a23a', '#a8761a'], ink: '#5a3a06', rim: ['#fff0b8', '#e5b94a', '#8f6212'] },
  { face: ['#f5fbff', '#c9dbea', '#7f99b3'], ink: '#233649', rim: ['#ffffff', '#b8cfe3', '#6f8aa6'] },
  { face: ['#b8f5d3', '#2fbf7a', '#0b6b3d'], ink: '#04321c', rim: ['#c8ffe0', '#1fa866', '#075a32'] },
  { face: ['#ead3ff', '#a35bff', '#5a1fa8'], ink: '#2b0b57', rim: ['#f2e2ff', '#8d45e8', '#4a1590'] },
  { face: ['#ffc2c9', '#e0264a', '#7d0a22'], ink: '#3d0511', rim: ['#ffd0d6', '#c81c40', '#6a0820'] },
  { face: ['#c4d8ff', '#3a6bf0', '#122f8f'], ink: '#0a1a52', rim: ['#d6e4ff', '#2f5ce0', '#0e2578'] },
  { face: ['#ffffff', '#bff3ff', '#6fd0ee'], ink: '#0b4a63', rim: ['#ffffff', '#9fe8fb', '#4bb9dc'] },
  { face: ['#6b6f78', '#23252b', '#050507'], ink: '#eef1f8', rim: ['#9aa0ac', '#3a3d46', '#0a0a0d'] },
  // lonsdaleit: kolory wariantu karty (#fff6c8, #ffc43d, #d98a00, ciemny bursztyn #6b4000)
  { face: ['#fff6c8', '#ffc43d', '#b87400'], ink: '#3a2000', rim: ['#fff6c8', '#ffc43d', '#6b4000'] },
  { face: ['#ffffff', '#fff3c4', '#e9c46a'], ink: '#6b4d00', rim: ['#ffffff', '#f4d77a', '#b8860b'] },
];

let counter = 0;

function teeth(cx: number, cy: number, r1: number, r2: number, n: number) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2, r = i % 2 ? r2 : r1;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function star(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * i) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function hex(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`); }
  return pts.join(' ');
}

/** Godło środka: gwiazda (poziomy 1-11, diamentowa i czarny diament z iskrami), lonsdaleit: plaster sześciokątów, papieska: skrzyżowane klucze i krzyż */
function emblem(tier: number, ink: string) {
  if (tier === 12) {
    // siedem sześciokątów jak komórki siatki lonsdaleitu: środkowy złoty, sześć wokół w różnej jasności
    const r = 7.6, d = r * Math.sqrt(3), fills = ['#fff6c8', '#ffd25a', '#8a5200', '#ffe9a8', '#b87400', '#fff2b0'];
    const ring = fills.map((f, i) => { const a = (Math.PI / 3) * i; return `<polygon points="${hex(60 + d * Math.cos(a), 50 + d * Math.sin(a), r)}" fill="${f}" fill-opacity=".9" stroke="#3a2000" stroke-opacity=".55" stroke-width=".9" stroke-linejoin="round"/>`; }).join('');
    return `${ring}<polygon points="${hex(60, 50, r)}" fill="#ffc43d" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`
      + `<path d="M36 40 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z M84 62 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" fill="${ink}" opacity=".55"/>`;
  }
  if (tier === 13) {
    return `<g stroke="#8a6508" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M47 68 L73 41" stroke="#c9981a" stroke-width="3.6"/><circle cx="73.5" cy="40.5" r="4.4" fill="none" stroke="#c9981a" stroke-width="2.4"/><path d="M50 65 l-3.5 3.5 M54 61 l-3.5 3.5" stroke="#c9981a" stroke-width="2.6"/>
<path d="M73 68 L47 41" stroke="#aeb6c2" stroke-width="3.6"/><circle cx="46.5" cy="40.5" r="4.4" fill="none" stroke="#aeb6c2" stroke-width="2.4"/><path d="M70 65 l3.5 3.5 M66 61 l3.5 3.5" stroke="#aeb6c2" stroke-width="2.6"/>
<rect x="57" y="38" width="6" height="26" rx="1" fill="#fffaf0"/><rect x="50" y="46" width="20" height="6" rx="1" fill="#fffaf0"/></g>`;
  }
  const sparks = tier >= 10
    ? `<path d="M36 40 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6z M84 62 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" fill="${ink}" opacity=".55"/>`
    : '';
  const fill = tier === 11 ? '#e8edf7' : '#fff6d2';
  return `${sparks}<polygon points="${star(60, 52, 15)}" fill="${fill}" stroke="${tier === 11 ? '#0a0a0d' : ink}" stroke-width="1" stroke-linejoin="round"/>`;
}

export function serviceBadgeSvg(year: number, tier = 1): string {
  const t = Math.min(Math.max(Math.round(tier), 1), 13);
  const p = PALETTE[t - 1];
  const id = `svb${++counter}`;
  const papal = t === 13;
  const ribbon = papal
    ? `<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9dfae"/>`
    : `<stop offset="0" stop-color="var(--hue, #e0264a)"/><stop offset="1" stop-color="color-mix(in srgb, var(--hue, #e0264a) 50%, #000)"/>`;
  return `<svg class="svc-badge" viewBox="0 0 120 150" role="img" aria-label="Odznaka za służbę (${BADGE_NAMES[t - 1]}) w roku ${year}">
<defs>
<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.rim[0]}"/><stop offset=".45" stop-color="${p.rim[1]}"/><stop offset="1" stop-color="${p.rim[2]}"/></linearGradient>
<linearGradient id="${id}i" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${p.face[0]}"/><stop offset=".55" stop-color="${p.face[1]}"/><stop offset="1" stop-color="${p.face[2]}"/></linearGradient>
<linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1">${ribbon}</linearGradient>
<path id="${id}a" d="M 27 60 A 33 33 0 0 1 93 60"/>
</defs>
<path d="M36 80 L24 143 L46 130 L58 149 L66 96Z" fill="url(#${id}r)" ${papal ? 'stroke="#c9b97a" stroke-width=".8"' : ''}/>
<path d="M84 80 L96 143 L74 130 L62 149 L54 96Z" fill="url(#${id}r)" opacity=".92" ${papal ? 'stroke="#c9b97a" stroke-width=".8"' : ''}/>
<polygon points="${teeth(60, 58, 57, 52, 24)}" fill="url(#${id}g)"/>
<circle cx="60" cy="58" r="46" fill="url(#${id}i)" stroke="${p.rim[2]}" stroke-width="1.2"/>
<circle cx="60" cy="58" r="40" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1"/>
<text font-family="var(--display, system-ui)" font-weight="800" font-size="9.5" letter-spacing="1.6" fill="${p.ink}"><textPath href="#${id}a" startOffset="50%" text-anchor="middle">ZA SŁUŻBĘ</textPath></text>
${emblem(t, p.ink)}
<text x="60" y="84" text-anchor="middle" font-family="var(--display, system-ui)" font-weight="800" font-size="14" fill="${p.ink}">${year}</text>
</svg>`;
}
