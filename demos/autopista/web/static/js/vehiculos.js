// Vehículos del corredor: InstancedMesh por modelo, interpolados sobre el estado que manda el simulador.
// Cada vehículo llega como [id, s_km, lat_m, v_m/s (con signo del sentido), categoría, modo]; entre sondeos se
// extrapola con su velocidad (y la velocidad de la simulación) y se corrige suave hacia el último dato.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y = 0.35;
const MAX = 1400;

function caja(w, h, l, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y + h / 2, z);
  return g;
}

function pintar(g, color) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Geometrías orientadas hacia +z (adelante). La carrocería usa el color de la instancia; vidrios y ruedas, color fijo.
const MODELOS = {
  auto: () => mergeGeometries([
    pintar(caja(1.75, 0.75, 4.3, 0, 0.35), 0xffffff), pintar(caja(1.55, 0.6, 2.2, 0, 1.1, -0.2), 0x9fb6c9),
    pintar(caja(1.8, 0.45, 0.6, 0, 0.12, 1.3), 0x222222), pintar(caja(1.8, 0.45, 0.6, 0, 0.12, -1.3), 0x222222)]),
  bus: () => mergeGeometries([
    pintar(caja(2.5, 2.6, 10, 0, 0.45), 0xffffff), pintar(caja(2.55, 0.9, 9.4, 0, 1.6), 0x7c9bb5),
    pintar(caja(2.6, 0.6, 1, 0, 0.1, 3.4), 0x222222), pintar(caja(2.6, 0.6, 1, 0, 0.1, -3.4), 0x222222)]),
  camion: () => mergeGeometries([
    pintar(caja(2.3, 2.1, 1.9, 0, 0.6, 2.4), 0xffffff), pintar(caja(2.4, 2.6, 5, 0, 0.75, -1.2), 0xe6e1d3),
    pintar(caja(2.4, 0.7, 0.9, 0, 0.1, 2.5), 0x222222), pintar(caja(2.4, 0.7, 0.9, 0, 0.1, -2.6), 0x222222)]),
  camion3: () => mergeGeometries([
    pintar(caja(2.4, 2.3, 2.1, 0, 0.7, 4.8), 0xffffff), pintar(caja(2.5, 2.9, 8.8, 0, 0.85, -0.8), 0xd9d4c7),
    pintar(caja(2.5, 0.8, 0.9, 0, 0.1, 4.9), 0x222222), pintar(caja(2.5, 0.8, 2.2, 0, 0.1, -3.5), 0x222222)]),
  tracto: () => mergeGeometries([
    pintar(caja(2.5, 2.6, 2.6, 0, 0.8, 7.3), 0xffffff), pintar(caja(2.55, 3.1, 13.6, 0, 1.0, -1.7), 0xcfd6dc),
    pintar(caja(2.5, 0.9, 2.3, 0, 0.1, 7.3), 0x222222), pintar(caja(2.6, 0.9, 3.2, 0, 0.1, -6.6), 0x222222)]),
};

const COLORES = {
  auto: [0xd6dde4, 0x1f2a36, 0xb03a2e, 0x2e5c9a, 0xf2f2f2, 0x8a8f94, 0x2d6a4f, 0xc0a062],
  bus: [0x1f6fb2, 0xd94f30, 0x2a9d8f, 0xf2b134],
  camion: [0xd62828, 0x1d3557, 0xf4a261, 0x457b9d, 0xffffff],
  camion3: [0x9d0208, 0x264653, 0xe9c46a, 0x2a9d8f, 0xffffff],
  tracto: [0xb5179e, 0x3a0ca3, 0xd00000, 0x14213d, 0xfca311, 0xe5e5e5],
};
const PUNTO = { auto: 0xffffff, bus: 0x49c6ff, camion: 0xffd166, camion3: 0xffa94d, tracto: 0xff7b54 };

export class Vehiculos {
  constructor(scene, cor, categorias) {
    this.cor = cor;
    this.cat = categorias;
    this.mallas = {};
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const [nombre, fab] of Object.entries(MODELOS)) {
      const im = new THREE.InstancedMesh(fab(), mat, MAX);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      this.mallas[nombre] = im;
    }
    // vista lejana: un punto por vehículo
    this.pPos = new Float32Array(MAX * 3 * 2);
    this.pCol = new Float32Array(MAX * 3 * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.puntos = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    this.puntos.frustumCulled = false;
    this.puntos.renderOrder = 5;
    scene.add(this.puntos);
    this.v = new Map();
    this.o = new THREE.Object3D();
    this.c = new THREE.Color();
    this.m = {};
  }

  actualizar(lista) {
    const vivos = new Set();
    for (const [id, s, lat, v, cat, modo] of lista) {
      vivos.add(id);
      let e = this.v.get(id);
      if (!e) {
        const modelo = this.cat[cat]?.modelo || 'auto';
        const paleta = COLORES[modelo];
        e = { s, lat, v, cat, modelo, color: paleta[(id * 7919) % paleta.length], ds: 0, dl: 0, ss: s, ll: lat };
        this.v.set(id, e);
      }
      // error entre lo que mostramos y el dato nuevo: se absorbe en ~0,5 s
      e.ds = e.ss - s; e.dl = e.ll - lat;
      if (Math.abs(e.ds) > 0.15) e.ds = 0;
      e.s = s; e.lat = lat; e.v = v; e.modo = modo;
    }
    for (const id of this.v.keys()) if (!vivos.has(id)) this.v.delete(id);
  }

  dibujar(dt, velocidad, lejos) {
    const cuenta = {};
    for (const k in this.mallas) cuenta[k] = 0;
    const amort = Math.exp(-dt * 5);
    let p = 0;
    for (const e of this.v.values()) {
      e.s += (e.v * dt * velocidad) / 1000;
      e.ds *= amort; e.dl *= amort;
      e.ss = e.s + e.ds; e.ll = e.lat + e.dl;
      const f = this.cor.marco(e.ss, e.ll, this.m);
      const k = e.modelo, i = cuenta[k]++;
      if (!lejos) {
        this.o.position.set(f.x, Y, f.z);
        this.o.rotation.set(0, f.rumbo + (e.v < 0 || (e.v === 0 && e.ll < 0) ? Math.PI : 0), 0);
        this.o.updateMatrix();
        this.mallas[k].setMatrixAt(i, this.o.matrix);
        this.mallas[k].setColorAt(i, this.c.set(e.color));
      }
      this.pPos[p * 3] = f.x; this.pPos[p * 3 + 1] = 6; this.pPos[p * 3 + 2] = f.z;
      this.c.set(PUNTO[k]).toArray(this.pCol, p * 3);
      p++;
    }
    for (const [k, im] of Object.entries(this.mallas)) {
      im.count = lejos ? 0 : cuenta[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.puntos.geometry.setDrawRange(0, p);
    this.puntos.geometry.attributes.position.needsUpdate = true;
    this.puntos.geometry.attributes.color.needsUpdate = true;
    this.puntos.visible = lejos;
  }
}

// Grúas, ambulancia, inspección vial y técnicos: van por la berma con balizas.
export class Unidades {
  constructor(scene, cor) {
    this.cor = cor;
    this.scene = scene;
    this.u = new Map();
    this.m = {};
    this.t = 0;
  }

  crear(u) {
    const g = new THREE.Group();
    const color = { grua: 0xf2a900, ambulancia: 0xffffff, inspeccion: 0xf2f2f2, tecnico: 0x2f80ed }[u.tipo] || 0xffffff;
    const largo = u.tipo === 'grua' ? 7.5 : 5.2;
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.1, largo), new THREE.MeshLambertMaterial({ color }));
    cuerpo.position.y = 1.4; g.add(cuerpo);
    if (u.tipo === 'grua') {
      const pluma = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 4.5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      pluma.position.set(0, 3.2, -2.2); pluma.rotation.x = 0.35; g.add(pluma);
    }
    if (u.tipo === 'ambulancia') {
      const cruz = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.5, 1.4), new THREE.MeshLambertMaterial({ color: 0xd03b3b }));
      cruz.position.y = 1.9; g.add(cruz);
    }
    const balizas = [0xff8c00, u.tipo === 'ambulancia' ? 0xff2020 : 0xffd000].map((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
      b.position.set(i ? 0.6 : -0.6, 2.75, largo / 2 - 1); g.add(b); return b;
    });
    this.scene.add(g);
    return { g, balizas, s: u.s, dir: 1 };
  }

  actualizar(lista) {
    for (const u of lista) {
      let e = this.u.get(u.id);
      if (!e) { e = this.crear(u); this.u.set(u.id, e); }
      e.dir = u.s > e.s + 1e-4 ? 1 : u.s < e.s - 1e-4 ? -1 : e.dir;
      e.meta = u.s; e.estado = u.estado; e.nombre = u.nombre; e.tipo = u.tipo;
    }
  }

  dibujar(dt) {
    this.t += dt;
    for (const e of this.u.values()) {
      e.s += (e.meta - e.s) * Math.min(1, dt * 2);
      const enBase = e.estado === 'en base';
      e.g.visible = !enBase;
      if (enBase) continue;
      const f = this.cor.marco(e.s, e.dir > 0 ? 6.2 : -6.2, this.m);
      e.g.position.set(f.x, 0.3, f.z);
      e.g.rotation.y = f.rumbo + (e.dir > 0 ? 0 : Math.PI);
      const on = Math.floor(this.t * 4) % 2 === 0;
      e.balizas[0].visible = on; e.balizas[1].visible = !on;
    }
  }
}
