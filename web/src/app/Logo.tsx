// Znak gry: skrzynka z wystającą kartą, w kolorze wybranej skrzynki
export function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="2" width="9" height="12" rx="1.5" fill="#fff" />
      <rect x="3" y="10" width="18" height="12" rx="2.5" fill="var(--hue)" style={{ transition: 'fill .3s' }} />
      <rect x="3" y="10" width="18" height="3" fill="#00000040" />
    </svg>
  );
}
