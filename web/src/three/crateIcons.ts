// @ts-nocheck -- geometria Three.js; typy dochodzą przy dalszym porządkowaniu
// Ikony skrzynek z prawdziwego modelu 3D. Kafelków jest dużo, a przeglądarka pozwala tylko na kilka kontekstów WebGL,
// więc jeden ukryty renderer rysuje każdą skrzynkę raz i oddaje obrazek (WebP z przezroczystością).
import * as THREE from 'three';
import { crateEnvironment, crateKit, softDot, type CrateLook } from './crateModel';

const W = 480, H = 400;   // proporcje płaskiego rysunku (120 x 100), w podwójnej rozdzielczości
let rig = null;

function setup() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.environment = crateEnvironment(renderer).texture;
  scene.environmentIntensity = .6;
  const key = new THREE.DirectionalLight('#ffffff', 2.6); key.position.set(-3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 3.2); rim.position.set(3, 3, -4); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(24, W / H, .1, 50);
  camera.position.set(0, 2.9, 7.6);
  camera.lookAt(0, .88, 0);
  const kit = crateKit();
  const { g } = kit.build();
  g.rotation.y = -.52;
  scene.add(g);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), new THREE.MeshBasicMaterial({ map: softDot(), color: '#000', transparent: true, opacity: .7, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.01;
  scene.add(shadow);
  rig = { renderer, scene, camera, kit, rim, canvas };
}

export const crateIconKey = (look: CrateLook) => `${look.c1}|${look.c2}|${look.hue}|${look.emoji || look.d}`;
const cache = new Map<string, string>();

/** Obrazek skrzynki w danym wyglądzie (adres data:, gotowy do <img>) */
export function renderCrateIcon(look: CrateLook): string {
  const k = crateIconKey(look);
  const hit = cache.get(k);
  if (hit) return hit;
  if (!rig) setup();
  rig.kit.setLook(look);
  rig.rim.color.set(look.hue);
  rig.renderer.render(rig.scene, rig.camera);
  const url = rig.canvas.toDataURL('image/webp', .92);
  cache.set(k, url);
  return url;
}
