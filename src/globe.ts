// Three.js globe in an Earth-fixed frame: Earth stays still, satellites move.
// Scene units: 1 = Earth radius. ECF (x, y, z) maps to three.js (x, z, -y) so that
// the equirectangular texture lines up with longitude and north is +Y.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { eciToEcf, gstime, shadowFraction, sunPos, jday, type EciVec3 } from 'satellite.js';
import type { Category, Sat } from './core/catalog';
import { periodMinutes } from './core/catalog';
import { satEci, sunEciKm } from './core/sky';

const EARTH_KM = 6371;

export const CATEGORY_COLORS: Record<Category, string> = {
  station: '#ffffff',
  india: '#ff9f1c',
  gnss: '#3ddc97',
  weather: '#4cc9f0',
  starlink: '#8d86ff',
  oneweb: '#f072b6',
  other: '#9aa0a6',
};

function toScene(ecf: EciVec3<number>, out = new THREE.Vector3()) {
  return out.set(ecf.x / EARTH_KM, ecf.z / EARTH_KM, -ecf.y / EARTH_KM);
}

export function latLonToScene(lat: number, lon: number, r = 1) {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lon);
  return toScene({ x: r * EARTH_KM * Math.cos(la) * Math.cos(lo), y: r * EARTH_KM * Math.cos(la) * Math.sin(lo), z: r * EARTH_KM * Math.sin(la) });
}

const earthVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const earthFrag = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    float light = dot(vNormal, sunDir);
    float day = smoothstep(-0.12, 0.18, light);
    vec3 dayCol = texture2D(dayMap, vUv).rgb * (0.35 + 0.75 * max(light, 0.0));
    vec3 nightCol = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.82, 0.55) * 2.4 + vec3(0.012, 0.016, 0.026);
    gl_FragColor = vec4(mix(nightCol, dayCol, day), 1.0);
  }
`;

const atmoVert = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const atmoFrag = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
    gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * rim * 0.9;
  }
`;

const pointVert = /* glsl */ `
  attribute vec3 color;
  attribute float lit;
  attribute float visible;
  uniform float pixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vColor = color;
    vAlpha = visible * mix(0.35, 1.0, lit);
    gl_PointSize = visible * mix(2.6, 3.8, lit) * pixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const pointFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.2, d));
  }
`;

export interface GlobeEvents {
  onSelect(sat: Sat | null): void;
  /** Fired when the user drags the globe while it was following a satellite. */
  onFollowEnd(): void;
  /** Mouse hover over a satellite (desktop only); null when the pointer leaves it. */
  onHover(sat: Sat | null, clientX: number, clientY: number): void;
}

export class Globe {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private earthMat: THREE.ShaderMaterial;
  private points!: THREE.Points;
  private positions!: Float32Array;
  private lit!: Float32Array;
  private visibleAttr!: Float32Array;
  private sats: Sat[] = [];
  private index = new Map<Sat, number>();
  private following: Sat | null = null;
  private cursor = 0;
  private orbitLine: THREE.Line | null = null;
  private selectedMarker: THREE.Mesh;
  private observerMarker: THREE.Mesh;
  private selected: Sat | null = null;
  private raycaster = new THREE.Raycaster();
  private flyTo: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null = null;
  /** Latest mouse position waiting to be hit-tested on the next frame. */
  private hoverAt: { x: number; y: number } | null = null;
  private hovered: Sat | null = null;
  /** Satellites propagated per animation frame; the full fleet refreshes every few frames. */
  private budget = 2500;

  private canvasHost: HTMLElement;
  private events: GlobeEvents;

  constructor(canvasHost: HTMLElement, events: GlobeEvents) {
    this.canvasHost = canvasHost;
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x050607);
    canvasHost.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
    this.camera.position.copy(latLonToScene(20, 80, 3.6));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 14;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.7;

    const loader = new THREE.TextureLoader();
    const base = import.meta.env.BASE_URL;
    const day = loader.load(`${base}textures/earth-day.jpg`);
    const night = loader.load(`${base}textures/earth-night.jpg`);
    day.colorSpace = night.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = night.anisotropy = 4;

    this.earthMat = new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, sunDir: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: earthVert,
      fragmentShader: earthFrag,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earthMat));

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.035, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: atmoVert,
        fragmentShader: atmoFrag,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(atmo);

    this.selectedMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.024, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb13b, side: THREE.DoubleSide, transparent: true, depthTest: false }),
    );
    this.selectedMarker.visible = false;
    this.selectedMarker.renderOrder = 10;
    this.scene.add(this.selectedMarker);

    this.observerMarker = new THREE.Mesh(
      new THREE.CircleGeometry(0.008, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb13b, side: THREE.DoubleSide }),
    );
    this.observerMarker.visible = false;
    this.scene.add(this.observerMarker);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvasHost);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setSatellites(sats: Sat[]) {
    this.sats = sats;
    this.index = new Map(sats.map((s, i) => [s, i]));
    const n = sats.length;
    this.positions = new Float32Array(n * 3);
    this.lit = new Float32Array(n).fill(1);
    this.visibleAttr = new Float32Array(n).fill(1);
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    sats.forEach((s, i) => {
      c.set(CATEGORY_COLORS[s.category]);
      colors.set([c.r, c.g, c.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('lit', new THREE.BufferAttribute(this.lit, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('visible', new THREE.BufferAttribute(this.visibleAttr, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);

    if (this.points) this.scene.remove(this.points);
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
        vertexShader: pointVert,
        fragmentShader: pointFrag,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(this.points);
    // Fill every position once so the first frame is complete.
    this.propagate(0, n, new Date());
  }

  setFilter(show: (s: Sat) => boolean) {
    this.sats.forEach((s, i) => (this.visibleAttr[i] = show(s) ? 1 : 0));
    (this.points.geometry.getAttribute('visible') as THREE.BufferAttribute).needsUpdate = true;
  }

  setObserver(lat: number, lon: number) {
    const p = latLonToScene(lat, lon, 1.001);
    this.observerMarker.position.copy(p);
    this.observerMarker.lookAt(p.clone().multiplyScalar(2));
    this.observerMarker.visible = true;
  }

  select(sat: Sat | null, fly = false) {
    this.selected = sat;
    if (this.orbitLine) {
      this.scene.remove(this.orbitLine);
      this.orbitLine.geometry.dispose();
      this.orbitLine = null;
    }
    this.selectedMarker.visible = !!sat;
    if (!sat) return;
    this.orbitLine = this.buildOrbit(sat, new Date());
    this.scene.add(this.orbitLine);
    const i = this.index.get(sat) ?? -1;
    if (fly && i >= 0) {
      const p = new THREE.Vector3().fromArray(this.positions, i * 3);
      const dist = Math.min(Math.max(this.camera.position.length() * 0.85, p.length() + 1.6), 9);
      // Looking straight down shows the orbit edge-on as a line; tilt toward the orbit normal.
      const pts = (this.orbitLine.geometry.getAttribute('position') as THREE.BufferAttribute).array;
      const a = new THREE.Vector3().fromArray(pts, 0);
      const b = new THREE.Vector3().fromArray(pts, Math.floor(pts.length / 9) * 3);
      const normal = a.cross(b).normalize();
      const dir = p.clone().normalize().addScaledVector(normal, 0.55).normalize();
      this.flyTo = { from: this.camera.position.clone(), to: dir.multiplyScalar(dist), t0: performance.now() };
    }
  }

  /** Inertial orbit snapshot for one period, rotated into the current Earth-fixed frame. */
  private buildOrbit(sat: Sat, now: Date) {
    const gmst = gstime(now);
    const pts: THREE.Vector3[] = [];
    const periodMs = periodMinutes(sat) * 60_000;
    const steps = 240;
    for (let k = 0; k <= steps; k++) {
      const eci = satEci(sat.satrec, new Date(now.getTime() + (k / steps) * periodMs - periodMs / 2));
      if (eci) pts.push(toScene(eciToEcf(eci, gmst)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb13b, transparent: true, opacity: 0.7 }));
    return line;
  }

  private propagate(from: number, count: number, now: Date) {
    const gmst = gstime(now);
    const sun = sunPos(jday(now)).rsun;
    const v = new THREE.Vector3();
    const end = Math.min(from + count, this.sats.length);
    for (let i = from; i < end; i++) {
      const eci = satEci(this.sats[i].satrec, now);
      if (!eci) {
        this.visibleAttr[i] = 0;
        continue;
      }
      toScene(eciToEcf(eci, gmst), v);
      this.positions[i * 3] = v.x;
      this.positions[i * 3 + 1] = v.y;
      this.positions[i * 3 + 2] = v.z;
      this.lit[i] = shadowFraction(sun, eci) < 0.5 ? 1 : 0;
    }
  }

  /** Current scene position of a satellite (for overlays). */
  positionOf(sat: Sat): THREE.Vector3 | null {
    const i = this.index.get(sat);
    return i === undefined ? null : new THREE.Vector3().fromArray(this.positions, i * 3);
  }

  /**
   * Geocentric latitude/longitude from the last rendered position. Up to ~0.2° off the
   * geodetic value and a few frames old, which is fine for coarse grouping of 15k satellites.
   */
  approxLatLon(i: number): [lat: number, lon: number] {
    const x = this.positions[i * 3];
    const y = this.positions[i * 3 + 1];
    const z = this.positions[i * 3 + 2];
    return [THREE.MathUtils.radToDeg(Math.atan2(y, Math.hypot(x, z))), THREE.MathUtils.radToDeg(Math.atan2(-z, x))];
  }

  isShown(i: number): boolean {
    return this.visibleAttr[i] === 1;
  }

  /** Keep the camera above a satellite as it moves; null stops. */
  follow(sat: Sat | null) {
    this.following = sat;
    this.flyTo = null;
  }

  flyToLatLon(lat: number, lon: number) {
    const dist = Math.min(this.camera.position.length(), 3.2);
    this.following = null;
    this.flyTo = { from: this.camera.position.clone(), to: latLonToScene(lat, lon, dist), t0: performance.now() };
  }

  private frame() {
    const now = new Date();
    if (this.sats.length) {
      this.propagate(this.cursor, this.budget, now);
      this.cursor = (this.cursor + this.budget) % this.sats.length;
      const geo = this.points.geometry;
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('lit') as THREE.BufferAttribute).needsUpdate = true;
    }

    const sun = toScene(eciToEcf(sunEciKm(now), gstime(now))).normalize();
    (this.earthMat.uniforms.sunDir.value as THREE.Vector3).copy(sun);

    if (this.selected) {
      const p = this.positionOf(this.selected);
      if (p) {
        this.selectedMarker.position.copy(p);
        this.selectedMarker.quaternion.copy(this.camera.quaternion);
        const s = this.camera.position.distanceTo(p) * 0.9;
        this.selectedMarker.scale.setScalar(s);
      }
    }

    if (this.following) {
      const p = this.positionOf(this.following);
      if (p) {
        const dist = this.camera.position.length();
        this.camera.position.lerp(p.setLength(dist), 0.12).setLength(dist);
      }
    }

    if (this.flyTo) {
      const k = Math.min((performance.now() - this.flyTo.t0) / 1200, 1);
      const e = 1 - Math.pow(1 - k, 3);
      const r = THREE.MathUtils.lerp(this.flyTo.from.length(), this.flyTo.to.length(), e);
      this.camera.position.copy(this.flyTo.from.clone().normalize().lerp(this.flyTo.to.clone().normalize(), e).normalize().multiplyScalar(r));
      if (k >= 1) this.flyTo = null;
    }

    if (this.hoverAt) {
      const { x, y } = this.hoverAt;
      this.hoverAt = null;
      const sat = this.pick(x, y);
      if (sat || this.hovered) this.events.onHover(sat, x, y);
      this.hovered = sat;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private fitted = false;

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvasHost;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // On phones the bottom sheet covers the lower part, so render the globe higher up.
    if (w <= 820) this.camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (!this.fitted) {
      // Portrait screens need the camera further out for the whole Earth to fit.
      this.camera.position.setLength(3.6 / Math.pow(Math.min(this.camera.aspect, 1), 0.85));
      this.fitted = true;
    }
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      this.flyTo = null;
      if (this.following) {
        this.following = null;
        this.events.onFollowEnd();
      }
    });
    el.addEventListener('pointerup', (e) => {
      const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6;
      down = null;
      if (click) this.events.onSelect(this.pick(e.clientX, e.clientY));
    });
    // Hover labels only for a mouse that is not dragging; touch has no hover.
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && e.buttons === 0) this.hoverAt = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerleave', () => {
      this.hoverAt = null;
      if (this.hovered) this.events.onHover(null, 0, 0);
      this.hovered = null;
    });
  }

  /** Nearest visible satellite to the tap, in screen space, ignoring ones behind Earth. */
  private pick(clientX: number, clientY: number): Sat | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;

    const tol = (matchMedia('(pointer: coarse)').matches ? 22 : 12) ** 2;
    const v = new THREE.Vector3();
    let best = -1;
    let bestD = tol;
    for (let i = 0; i < this.sats.length; i++) {
      if (!this.visibleAttr[i]) continue;
      v.fromArray(this.positions, i * 3).project(this.camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * rect.width;
      const sy = ((1 - v.y) / 2) * rect.height;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bestD && !this.hiddenByEarth(i)) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? this.sats[best] : null;
  }

  private earth = new THREE.Sphere(new THREE.Vector3(), 1);

  private hiddenByEarth(i: number): boolean {
    const p = new THREE.Vector3().fromArray(this.positions, i * 3);
    const toSat = p.clone().sub(this.camera.position);
    const dist = toSat.length();
    this.raycaster.ray.set(this.camera.position, toSat.normalize());
    const hit = this.raycaster.ray.intersectSphere(this.earth, new THREE.Vector3());
    return !!hit && hit.distanceTo(this.camera.position) < dist;
  }
}
