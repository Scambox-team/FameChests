import { useEffect, useRef } from 'react';
import { mountOldPinball, unmountOldPinball } from './engine';
import './oldpinball.css';

// Stary Pinball: gotowy HTML i canvas z engine.ts, osadzony w kontenerze (jak Arena)
export function OldPinballPage() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) mountOldPinball(box.current);
    return () => unmountOldPinball();
  }, []);
  return <div className="opb" ref={box} />;
}
