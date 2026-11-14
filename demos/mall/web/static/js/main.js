// Escena de la demo: Plaza Zabbix, un centro comercial en corte lateral.
//   azotea    chillers del aire acondicionado, letrero y tableros de estado
//   nivel 2   patio de comidas y cine
//   nivel 1   electrónica y deportes
//   planta    puertas automáticas, supermercado, atención al cliente y café
//   sótano    estacionamiento con barrera y lectura de placas, generador, UPS, red de seguridad y pantalla de Zabbix
// En el atrio central, cuatro escaleras mecánicas unen los niveles.
// Los datos vienen de /api/estado: la simulación y los problemas reales de Zabbix, con la causa que marcó CEP.
import { anchoTexto, partir, texto, textoCentrado } from "./fuente.js";
import { ALTO, ANCHO, BAYER, azar, lienzo } from "./pixel.js";
import { Dialogo, dinero } from "./dialogo.js";
import { activarAudio, alternarSilencio, silencio, sonido } from "./audio.js";
import { Caminante, LOOKS } from "./gente.js";

const pantalla = document.getElementById("pantalla");
const salida = pantalla.getContext("2d");
const [buffer, c] = lienzo();
const dialogo = new Dialogo();

const N2 = { techo: 68, suelo: 140, clave: "n2" };
const N1 = { techo: 142, suelo: 214, clave: "n1" };
const PB = { techo: 216, suelo: 288, clave: "pb" };
const SOT = { techo: 290, suelo: 346 };
const NIVELES = [N2, N1, PB];
const X0 = 20;
const X1 = 620;
const ATRIO = { x0: 232, x1: 408 };
// Escaleras: 1 y 3 suben (izquierda), 2 y 4 bajan (derecha). (bx, by) es el pie y (tx, ty) la llegada arriba.
const ESCALERAS = [
  { n: 1, bx: 240, by: 288, tx: 296, ty: 214, sube: true },
  { n: 2, bx: 400, by: 288, tx: 344, ty: 214, sube: false },
  { n: 3, bx: 240, by: 214, tx: 296, ty: 140, sube: true },
  { n: 4, bx: 400, by: 214, tx: 344, ty: 140, sube: false },
];
const CHILLERS = [146, 206];
const CAMARAS = [[90, 68], [180, 68], [450, 68], [560, 68], [90, 142], [180, 142], [450, 142], [560, 142], [100, 216], [190, 216], [440, 216], [570, 216], [130, 290], [260, 290]];
const ORDEN_CAMARAS = [5, 12, 0, 9, 3, 13, 7, 1, 10, 4, 8, 2, 11, 6];

const VERDE = "#46d160";
const AMBAR = "#f0b429";
const ROJO = "#f25555";
const SUAVE = "#aab1cf";
const BLANCO = "#f4f1e6";
const ROTULO = "#aab4d0";
const MARCA = "#d40000";

const r = (k, color, x, y, w, h) => { k.fillStyle = color; k.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const miles = (n) => Math.round(n).toLocaleString("en-US");
const parpadeo = (ritmo = 3) => Math.floor(reloj * ritmo) % 2 === 0;

// ---------------------------------------------------------------- estado

let e = null;
let reloj = 0;
let previoEstado = null;
let fallasSondeo = 0;

async function sondear() {
  try {
    const respuesta = await fetch("/api/estado", { cache: "no-store" });
    if (!respuesta.ok) throw new Error(String(respuesta.status));
    const nuevo = await respuesta.json();
    alCambiar(previoEstado, nuevo);
    previoEstado = nuevo;
    e = nuevo;
    fallasSondeo = 0;
  } catch {
    fallasSondeo++;
  }
  setTimeout(sondear, 1000);
}

function alCambiar(a, n) {
  if (!a) return;
  if (a.energia.red && !n.energia.red) {
    sonido.apagon();
    tecnico.decir("¡Se cortó la red! La UPS sostiene lo crítico.", 5);
    tecnico.irA(410);
  }
  if (!a.energia.red && n.energia.red) sonido.vuelveLuz();
  if (!a.energia.generador && n.energia.generador) {
    sonido.arranque();
    tecnico.decir(`Generador en marcha. Queda combustible para ${n.energia.autonomia_gen} min.`, 5);
    tecnico.irA(366);
  }
  if (!a.clima.alarma && n.clima.alarma) {
    sonido.error();
    tecnico.decir("Se disparó el chiller 1 por alta presión.", 5);
  }
  if (a.clima.temp.n2 <= 26 && n.clima.temp.n2 > 26) comensal.decir("¡Qué calor hace en el patio de comidas!", 5);
  if (a.seguridad.switch && !n.seguridad.switch) {
    sonido.error();
    guardia.decir("¡Perdimos las cámaras! No responde el switch.", 5);
  }
  if (a.parking.fila <= 8 && n.parking.fila > 8) guardia.decir("La barrera no lee las placas: hay fila en la salida.", 5);
  if (a.escaleras["2"].motor <= 85 && n.escaleras["2"].motor > 85) {
    sonido.alerta();
    tecnico.decir("El motor de la escalera 2 está muy caliente.", 5);
  }
  if (!a.proteccion && n.proteccion) {
    sonido.error();
    paseanteB.decir("¡Se paró la escalera!", 4);
  }
}

// ---------------------------------------------------------------- personas

const look = (id, piel, pelo, ropa, pantalon, estilo, extra = {}) => ({ id, piel, pelo, ropa, pantalon, zapato: "#14100e", estilo, ...extra });
const VISITANTES = [
  look("v1", "#e7b48a", "#201512", "#3f8fd0", "#27303c", "corto"),
  look("v2", "#c98f66", "#3b1f14", "#e0b040", "#1d2336", "largo", { maleta: "#b03a5a" }),
  look("v3", "#a06a48", "#15100e", "#f4f1e6", "#2d3a66", "corto"),
  look("v4", "#efc4a0", "#a0522d", "#d05a8a", "#39465e", "moño"),
  look("v5", "#d9a074", "#20160e", "#4a9a6a", "#27303c", "corto", { gorra: "#f4f1e6" }),
  look("v6", "#f2c79a", "#6a6660", "#8a5ad0", "#1d2336", "largo", { maleta: "#3a6ab0" }),
  look("v7", "#c98f66", "#201512", "#e07a3a", "#2f3a4a", "calvo"),
];
const LOOK_ATENCION = look("atencion", "#e7b48a", "#3b1f14", MARCA, "#1d2336", "largo");
const LOOK_BARISTA = look("barista", "#c98f66", "#15100e", "#3a2a20", "#1d2336", "corto", { gorra: "#f4f1e6" });
const LOOK_GUARDIA = look("guardia", "#d9a074", "#20160e", "#28304a", "#1d2336", "corto", { gorra: "#28304a" });

const atencion = new Caminante(LOOK_ATENCION, 442, PB.suelo - 6, 0, 0, { fijo: true, mirando: "SO" });
const barista = new Caminante(LOOK_BARISTA, 566, PB.suelo - 6, 0, 0, { fijo: true, mirando: "SO" });
const comensal = new Caminante(VISITANTES[3], 112, N2.suelo - 2, 0, 0, { fijo: true, pose: "sentado", mirando: "SE" });
const comensalB = new Caminante(VISITANTES[6], 168, N2.suelo - 2, 0, 0, { fijo: true, pose: "sentado", mirando: "SO" });
const guardia = new Caminante(LOOK_GUARDIA, 466, SOT.suelo - 2, 0, 0, { fijo: true, pose: "sentado", mirando: "NE" });
const tecnico = new Caminante(LOOKS.tecnico, 400, SOT.suelo, 340, 452);
const paseanteA = new Caminante(VISITANTES[0], 120, PB.suelo, 28, 226);
const paseanteB = new Caminante(VISITANTES[1], 180, PB.suelo, 70, 228);
const paseanteC = new Caminante(VISITANTES[2], 520, PB.suelo, 500, 612);
const paseanteD = new Caminante(VISITANTES[4], 100, N1.suelo, 30, 228);
const paseanteE = new Caminante(VISITANTES[5], 500, N1.suelo, 412, 612);
const paseanteF = new Caminante(VISITANTES[0], 520, N2.suelo, 412, 612);
const paseanteG = new Caminante(VISITANTES[2], 60, N2.suelo, 30, 90);
const caminantes = [tecnico, paseanteA, paseanteB, paseanteC, paseanteD, paseanteE, paseanteF, paseanteG];
const fijos = [comensal, comensalB, guardia];
const conVoz = [atencion, barista, ...fijos, ...caminantes];

// Pasajeros de las escaleras: figuras que suben o bajan con los escalones
const pasajeros = ESCALERAS.map((esc, i) => Array.from({ length: 4 }, (_, k) => ({
  t: (k + (i % 2) * 0.5) / 4,
  persona: new Caminante({ ...VISITANTES[(i * 3 + k * 2) % VISITANTES.length], maleta: undefined, id: `p${i}${k}` }, 0, 0, 0, 0, { fijo: true, mirando: esc.sube ? "SE" : "SE" }),
})));

// ---------------------------------------------------------------- fondo fijo

function tienda(k, x, y, w, nombre, color, pared) {
  r(k, pared, x, y + 13, w, 59 - 2);
  r(k, color, x + 6, y + 2, w - 12, 11);
  textoCentrado(k, nombre, x + w / 2, y + 4, "#ffffff");
}

function auto(k, x, y, color, escala = 1) {
  const w = 22 * escala;
  r(k, color, x, y - 8 * escala, w, 6 * escala);
  r(k, color, x + 4 * escala, y - 13 * escala, 13 * escala, 5 * escala);
  r(k, "#9fd0ff", x + 6 * escala, y - 12 * escala, 4 * escala, 3 * escala);
  r(k, "#9fd0ff", x + 11 * escala, y - 12 * escala, 4 * escala, 3 * escala);
  r(k, "#15181f", x + 3 * escala, y - 3 * escala, 4 * escala, 3 * escala);
  r(k, "#15181f", x + 15 * escala, y - 3 * escala, 4 * escala, 3 * escala);
  r(k, "#ffe9a0", x, y - 7 * escala, 1, 2);
  r(k, "#c02020", x + w - 1, y - 7 * escala, 1, 2);
}

function yEscalera(esc, x) {
  return esc.by + (esc.ty - esc.by) * ((x - esc.bx) / (esc.tx - esc.bx));
}

function pintarFondo() {
  const [l, k] = lienzo();
  const bandas = ["#141238", "#2c1c58", "#6a3470", "#c4684e"];
  for (let y = 0; y < 68; y++) {
    const t = (y / 68) * (bandas.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    for (let x = 0; x < ANCHO; x++) {
      k.fillStyle = f * 16 > BAYER[y % 4][x % 4] ? bandas[Math.min(i + 1, bandas.length - 1)] : bandas[i];
      k.fillRect(x, y, 1, 1);
    }
  }
  const azr = azar(31);
  let x = 0;
  while (x < ANCHO) {
    const w = 10 + Math.floor(azr() * 18);
    const h = 6 + Math.floor(azr() * 20);
    r(k, "#1c1438", x, 66 - h, w, h + 2);
    for (let wy = 66 - h + 3; wy < 64; wy += 4) for (let wx = x + 2; wx < x + w - 1; wx += 3) if (azr() < 0.35) r(k, "#f0c56a", wx, wy, 1, 1);
    x += w + Math.floor(azr() * 6);
  }

  // Cascarón y niveles
  r(k, "#20242e", X0 - 6, 64, X1 - X0 + 12, 296);
  for (const [nivel, pared] of [[N2, "#3d3550"], [N1, "#34405a"], [PB, "#3a3f52"]]) {
    r(k, pared, X0, nivel.techo, X1 - X0, nivel.suelo - nivel.techo);
    r(k, "#454c66", ATRIO.x0, nivel.techo, ATRIO.x1 - ATRIO.x0, nivel.suelo - nivel.techo);
    for (let px = ATRIO.x0 + 16; px < ATRIO.x1; px += 32) r(k, "#4d5570", px, nivel.techo, 1, nivel.suelo - nivel.techo);
    // Ducto de aire en el techo
    r(k, "#6a7080", X0, nivel.techo + 1, X1 - X0, 4);
    r(k, "#8a90a0", X0, nivel.techo + 1, X1 - X0, 1);
    // Piso de baldosas
    r(k, "#c8c2b0", X0, nivel.suelo - 2, X1 - X0, 2);
    for (let bx = X0; bx < X1; bx += 12) r(k, "#a8a290", bx, nivel.suelo - 2, 1, 2);
  }
  r(k, "#2a3040", X0, SOT.techo, 312, SOT.suelo - SOT.techo);
  r(k, "#222838", X0 + 312, SOT.techo, X1 - X0 - 312, SOT.suelo - SOT.techo);
  for (const y of [64, 140, 214, 288]) {
    r(k, "#4b505e", X0 - 6, y, X1 - X0 + 12, 2);
    r(k, "#6a7080", X0 - 6, y, X1 - X0 + 12, 1);
  }
  r(k, "#4b505e", X0 - 6, 346, X1 - X0 + 12, 14);
  r(k, "#6a7080", X0 - 6, 346, X1 - X0 + 12, 1);

  // ---- Azotea: chillers, letrero y tanque
  CHILLERS.forEach((cx, i) => {
    r(k, "#7d8594", cx, 46, 52, 18);
    r(k, "#9aa2b0", cx, 46, 52, 1);
    r(k, "#5d6574", cx, 62, 52, 2);
    for (let gx = cx + 3; gx < cx + 50; gx += 4) r(k, "#666e7e", gx, 54, 2, 7);
    r(k, "#3a3f4c", cx + 6, 40, 16, 6);
    r(k, "#3a3f4c", cx + 30, 40, 16, 6);
    texto(k, `CH${i + 1}`, cx + 17, 47, "#20242e");
    r(k, "#5a8fd0", cx + 24, 64, 3, 4);
  });
  r(k, "#5a606e", 286, 54, 3, 10);
  r(k, "#5a606e", 398, 54, 3, 10);
  r(k, "#1a1430", 268, 30, 150, 25);
  r(k, "#5a606e", 268, 30, 150, 1);
  r(k, "#8a8f9c", 432, 44, 30, 20);
  r(k, "#a8aeb8", 432, 44, 30, 2);
  r(k, "#6a7080", 436, 40, 22, 4);
  r(k, "#5a606e", 470, 34, 2, 30);
  r(k, "#c02020", 469, 32, 4, 2);

  // ---- Nivel 2: patio de comidas y cine
  tienda(k, 24, N2.techo + 6, 204, "PATIO DE COMIDAS", "#c0502a", "#4a3a44");
  for (const [mx, color] of [[40, "#d04a3a"], [76, "#e0a030"], [196, "#3a9a5a"]]) {
    r(k, color, mx, 96, 26, 12);
    r(k, "#ffffff", mx + 2, 98, 22, 3);
    r(k, "#2a2230", mx, 108, 26, 14);
    r(k, "#8a8f9c", mx, 108, 26, 1);
  }
  for (const mx of [128, 152]) {
    r(k, "#d8d2c0", mx, 124, 22, 2);
    r(k, "#6a6470", mx + 10, 126, 2, 12);
    r(k, "#e04a3a", mx + 4, 121, 4, 3);
    r(k, "#f0d060", mx + 13, 120, 3, 4);
  }
  tienda(k, 412, N2.techo + 6, 204, "CINE", "#6a2a8a", "#2a2038");
  for (const [px, color] of [[424, "#d04a3a"], [466, "#3a7ad0"], [508, "#e0a030"]]) {
    r(k, "#15101e", px, 92, 34, 44);
    r(k, color, px + 2, 94, 30, 30);
    r(k, "#ffffff", px + 8, 100, 18, 3);
    r(k, "#000000", px + 2, 118, 30, 6);
    r(k, "#d8d2c0", px + 6, 128, 22, 2);
  }
  r(k, "#3a2a4a", 552, 104, 58, 34);
  r(k, "#9fd0ff", 558, 108, 46, 16);
  textoCentrado(k, "BOLETOS", 581, 127, "#f0d060");

  // ---- Nivel 1: electrónica y deportes
  tienda(k, 24, N1.techo + 6, 204, "ELECTRÓNICA", "#2a6ab0", "#28324a");
  for (const tx of [34, 82, 130, 178]) {
    r(k, "#0a0d14", tx, 168, 40, 26);
    r(k, "#3a4256", tx + 17, 194, 6, 4);
    r(k, "#3a4256", tx + 10, 198, 20, 2);
  }
  r(k, "#5a6474", 30, 202, 196, 3);
  tienda(k, 412, N1.techo + 6, 204, "DEPORTES", "#2a8a4a", "#2c3a34");
  for (const sy of [176, 190, 204]) r(k, "#8a7a5a", 420, sy, 120, 2);
  for (let i = 0; i < 8; i++) {
    r(k, i % 2 ? "#f4f1e6" : "#e07a3a", 424 + i * 14, 169, 7, 7);
    r(k, ["#d04a3a", "#3a7ad0", "#e0b040", "#46d160"][i % 4], 423 + i * 14, 185, 10, 5);
    r(k, "#f4f1e6", 423 + i * 14, 188, 10, 1);
    r(k, ["#3a7ad0", "#d04a3a"][i % 2], 424 + i * 14, 196, 8, 8);
  }
  for (const [mx, color] of [[556, "#d04a3a"], [584, "#3a7ad0"]]) {
    r(k, "#e7b48a", mx + 4, 168, 6, 6);
    r(k, color, mx, 174, 14, 18);
    r(k, "#27303c", mx + 2, 192, 10, 14);
    r(k, "#5a606e", mx + 6, 206, 2, 6);
  }

  // ---- Planta baja: puertas, supermercado, atención y café
  r(k, "#141238", X0, PB.techo + 8, 40, 62);
  r(k, "#6a7080", X0, PB.techo + 6, 42, 3);
  r(k, "#6a7080", X0 + 40, PB.techo + 6, 2, 64);
  tienda(k, 68, PB.techo + 6, 160, "SUPERMERCADO", "#2a8a4a", "#3a4438");
  for (const sy of [248, 262, 276]) r(k, "#8a8f9c", 76, sy, 144, 2);
  const frutas = ["#d04a3a", "#e0a030", "#46d160", "#f0d060", "#8a5ad0", "#e07a3a"];
  for (let i = 0; i < 20; i++) {
    r(k, frutas[i % 6], 78 + i * 7, 242, 5, 6);
    r(k, frutas[(i + 2) % 6], 78 + i * 7, 256, 5, 6);
    r(k, frutas[(i + 4) % 6], 78 + i * 7, 270, 5, 6);
  }
  tienda(k, 412, PB.techo + 6, 96, "ATENCIÓN", MARCA, "#3a3040");
  for (let i = 0; i < 5; i++) {
    r(k, ["#d04a3a", "#3a7ad0", "#e0a030", "#46d160", "#8a5ad0"][i], 466 + (i % 3) * 12, 240 + Math.floor(i / 3) * 12, 9, 7);
    r(k, "#ffffff", 467 + (i % 3) * 12, 242 + Math.floor(i / 3) * 12, 7, 1);
  }
  tienda(k, 512, PB.techo + 6, 104, "CAFÉ", "#6a4a2a", "#3a302a");
  r(k, "#2a2018", 524, 240, 36, 22);
  r(k, "#c8c2b0", 528, 244, 28, 3);
  r(k, "#c8c2b0", 528, 251, 20, 3);
  for (const mx of [590, 606]) {
    r(k, "#d8d2c0", mx - 6, 272, 12, 2);
    r(k, "#6a6470", mx - 1, 274, 2, 12);
  }

  // ---- Atrio: barandas de vidrio y estructura de las escaleras
  for (const nivel of [N2, N1]) {
    for (const [bx0, bx1] of [[ATRIO.x0, 240], [296, 344], [400, ATRIO.x1]]) {
      r(k, "#15181f", bx0, nivel.suelo - 12, bx1 - bx0, 1);
      k.globalAlpha = 0.16;
      r(k, "#9fd0ff", bx0, nivel.suelo - 11, bx1 - bx0, 9);
      k.globalAlpha = 1;
    }
  }
  for (const esc of ESCALERAS) {
    const [xa, xb] = [Math.min(esc.bx, esc.tx), Math.max(esc.bx, esc.tx)];
    for (let ex = xa; ex <= xb; ex++) {
      const y = yEscalera(esc, ex);
      r(k, "#2c3342", ex, y, 1, 8);
      r(k, "#1c2230", ex, y + 7, 1, 1);
      k.globalAlpha = 0.18;
      r(k, "#9fd0ff", ex, y - 10, 1, 10);
      k.globalAlpha = 1;
      r(k, "#15181f", ex, y - 12, 1, 2);
    }
    texto(k, `E${esc.n}`, esc.sube ? esc.bx - 6 : esc.bx - 6, esc.by - 28, ROTULO);
  }

  // ---- Sótano: estacionamiento
  texto(k, "ESTACIONAMIENTO", 162, SOT.techo + 4, ROTULO);
  r(k, "#2a6ab0", 144, SOT.techo + 3, 12, 11);
  texto(k, "P", 148, SOT.techo + 5, "#ffffff");
  const colores = ["#5a6a8a", "#8a5a5a", "#5a8a6a", "#8a8a5a", "#6a5a8a", "#7a7a82", "#4a6a7a", "#8a6a4a", "#5a5a6a"];
  for (let i = 0; i < 9; i++) {
    auto(k, 112 + i * 24, 324, colores[i], 0.8);
    r(k, "#3a4256", 110 + i * 24, 324, 1, 4);
  }
  r(k, "#1c2230", X0, 325, 312, 1);
  for (let lx = 60; lx < 330; lx += 16) r(k, "#c8b040", lx, 337, 8, 1);
  r(k, "#15181f", 332, SOT.techo, 4, 56);
  // Carril de salida: poste de la barrera, cámara de placas y cajero
  r(k, "#d8d2c0", 44, 326, 5, 20);
  r(k, "#5a606e", 58, 306, 2, 40);
  r(k, "#20242e", 54, 303, 10, 5);
  r(k, "#3a4256", 68, 322, 12, 24);
  r(k, "#0a0d14", 70, 325, 8, 6);
  r(k, "#141238", X0, 300, 14, 46);

  // ---- Sótano: sala técnica y seguridad
  texto(k, "SALA TÉCNICA", 340, SOT.techo + 4, ROTULO);
  r(k, "#b8901c", 340, 318, 52, 26);
  r(k, "#d9ad2a", 340, 318, 52, 2);
  r(k, "#8a6a10", 340, 342, 52, 2);
  r(k, "#2a2c34", 344, 344, 8, 2);
  r(k, "#2a2c34", 380, 344, 8, 2);
  for (let gy = 323; gy < 340; gy += 3) r(k, "#7a5e10", 344, gy, 16, 1);
  r(k, "#15181f", 364, 323, 24, 16);
  r(k, "#5a606e", 386, SOT.techo, 4, 28);
  r(k, "#1e2430", 398, 304, 28, 42);
  r(k, "#3a4256", 398, 304, 28, 1);
  texto(k, "UPS", 403, 307, "#d8dde6");
  r(k, "#0a0d14", 401, 318, 22, 8);
  r(k, "#0d1018", 430, 300, 22, 46);
  r(k, "#2c3242", 430, 300, 22, 1);
  for (let sy = 304; sy < 342; sy += 6) r(k, "#1a1f2c", 432, sy, 18, 4);
  r(k, "#5a4a3a", 456, 334, 20, 3);
  r(k, "#3e3428", 456, 337, 20, 9);
  r(k, "#3b4270", 478, 292, 138, 54);
  r(k, "#06080f", 480, 294, 134, 50);
  r(k, MARCA, 480, 294, 134, 10);
  texto(k, "ZABBIX · PROBLEMAS", 484, 296, "#ffffff");
  return l;
}

const fondo = pintarFondo();

// ---------------------------------------------------------------- azotea

let giroChiller = [0, 0];

const clima = () => (e ? e.clima : { chiller: { 1: { en_marcha: true, a: 118 }, 2: { en_marcha: true, a: 121 } }, alarma: false, agua: 6.5, temp: { pb: 22.5, n1: 23, n2: 23.5 } });
const energia = () => (e ? e.energia : { red: true, tension: 13.2, ups_bateria: false, ups_pct: 100, generador: false, combustible: 36, autonomia_gen: 41, luz: 100, carga_kw: 900 });

function pintarAzotea(dt) {
  const cl = clima();
  CHILLERS.forEach((cx, i) => {
    const ch = cl.chiller[i + 1];
    const alarma = i === 0 && cl.alarma;
    if (ch.en_marcha) giroChiller[i] += dt * (ch.a > 180 ? 16 : 9);
    for (const fx of [cx + 14, cx + 38]) {
      for (let p = 0; p < 2; p++) {
        const ang = giroChiller[i] + (p * Math.PI) / 2;
        r(c, "#c8ccd4", fx + Math.cos(ang) * 6 - 1, 42, 3, 2);
      }
    }
    const color = alarma ? (parpadeo() ? "#ff3b3b" : "#5a1010") : !ch.en_marcha ? "#3a3f4a" : ch.a > 180 ? (parpadeo() ? AMBAR : "#6a4810") : VERDE;
    r(c, color, cx + 3, 48, 4, 3);
    if (ch.en_marcha && ch.a > 180) {
      c.globalAlpha = 0.3;
      r(c, "#ff7a2a", cx, 46, 52, 18);
      c.globalAlpha = 1;
    }
    // Agua helada que baja al edificio
    if (ch.en_marcha) {
      const t = (reloj * 1.2 + i * 0.5) % 1;
      r(c, "#bfe2ff", cx + 24, 64 + t * 3, 3, 1);
    }
  });
  // Letrero
  const encendido = energia().luz > 60;
  const color = encendido ? (Math.sin(reloj * 0.8) > -0.97 ? "#ff5a7a" : "#7a2a3a") : "#3a2030";
  textoCentrado(c, "PLAZA ZABBIX", 343, 35, color, 2);
  if (encendido) for (let i = 0; i < 18; i++) r(c, (i + Math.floor(reloj * 4)) % 3 === 0 ? "#ffe066" : "#6a5a20", 272 + i * 8, 51, 3, 2);
}

// ---------------------------------------------------------------- niveles

function pintarClimaYCamaras() {
  const cl = clima();
  const enMarcha = (cl.chiller[1].en_marcha ? 1 : 0) + (cl.chiller[2].en_marcha ? 1 : 0);
  for (const nivel of NIVELES) {
    for (let vx = 56; vx < X1; vx += 62) {
      r(c, "#3a3f4c", vx, nivel.techo + 5, 12, 2);
      for (let p = 0; p < enMarcha * 2; p++) {
        const t = (reloj * 0.9 + p / 4 + vx * 0.013) % 1;
        r(c, "#bfe2ff", vx + 2 + ((p * 5) % 9), nivel.techo + 8 + t * 10, 1, 2);
      }
    }
    const t = cl.temp[nivel.clave];
    const color = t > 26 ? ROJO : t > 25 ? AMBAR : VERDE;
    r(c, "#0a0d14", 301, nivel.techo + 10, 38, 11);
    textoCentrado(c, `${t.toFixed(1)}°C`, 320, nivel.techo + 12, t > 26 && parpadeo(2) ? "#ffdddd" : color);
  }
  const s = e ? e.seguridad : { camaras: 48, camaras_total: 48 };
  const enLinea = Math.round((s.camaras / s.camaras_total) * CAMARAS.length);
  CAMARAS.forEach(([cx, techo], i) => {
    r(c, "#20242e", cx, techo + 5, 7, 3);
    r(c, "#0a0d14", cx + 1, techo + 8, 5, 2);
    const ok = ORDEN_CAMARAS[i] < enLinea;
    r(c, ok ? "#46d160" : (parpadeo(3) ? "#ff3b3b" : "#5a1010"), cx + 3, techo + 9, 1, 1);
  });
}

function pintarLocales() {
  // Televisores de electrónica
  [34, 82, 130, 178].forEach((tx, i) => {
    const tonos = ["#d04a3a", "#e0a030", "#46d160", "#3a7ad0", "#8a5ad0"];
    for (let b = 0; b < 5; b++) r(c, tonos[(b + i + Math.floor(reloj * 0.7)) % 5], tx + 2 + b * 7.2, 170, 8, 22);
  });
  // Marquesina del cine
  for (let i = 0; i < 24; i++) r(c, (i + Math.floor(reloj * 5)) % 3 === 0 ? "#ffe066" : "#5a4a20", 420 + i * 8, 88, 3, 2);
  // Vapor del café
  for (let i = 0; i < 3; i++) {
    const t = (reloj * 0.5 + i / 3) % 1;
    r(c, "#d8d2c0", 572 + i * 6 + Math.round(Math.sin(reloj * 2 + i)), 262 - t * 10, 1, 2);
  }
  // Mostradores con sus empleados
  atencion.pintar(c);
  r(c, "#8a8f9c", 420, 264, 44, 3);
  r(c, "#8a0f0f", 422, 267, 40, 21);
  textoCentrado(c, "REGALO", 442, 273, "#ffffff");
  barista.pintar(c);
  r(c, "#8a8f9c", 536, 264, 50, 3);
  r(c, "#4a3420", 538, 267, 46, 21);
  r(c, "#c8c2b0", 544, 258, 8, 6);
  r(c, "#20242e", 570, 254, 10, 10);
}

// Puertas automáticas: se abren cuando alguien se acerca; sin energía quedan abiertas en manual
let aperturaPuerta = 0;

function pintarPuertas(dt) {
  const auto_ = !e || e.puertas.norte;
  const cerca = [paseanteA, paseanteB].some((p) => p.x < 74);
  const objetivo = !auto_ || cerca ? 1 : 0;
  aperturaPuerta += Math.sign(objetivo - aperturaPuerta) * Math.min(Math.abs(objetivo - aperturaPuerta), dt * 2.2);
  const hoja = 17;
  const corrida = Math.round(aperturaPuerta * 13);
  for (const [hx, dir] of [[X0 + 3, -1], [X0 + 3 + hoja, 1]]) {
    const xh = hx + dir * corrida;
    c.globalAlpha = 0.34;
    r(c, "#9fd0ff", xh, PB.techo + 12, hoja, 58);
    c.globalAlpha = 1;
    r(c, "#c8d8e8", xh, PB.techo + 12, hoja, 1);
    r(c, "#c8d8e8", dir < 0 ? xh + hoja - 1 : xh, PB.techo + 12, 1, 58);
  }
  r(c, auto_ ? "#46d160" : (parpadeo(2) ? AMBAR : "#6a4810"), X0 + 18, PB.techo + 7, 5, 2);
  if (!auto_) textoCentrado(c, "MANUAL", X0 + 21, PB.techo + 26, parpadeo(2) ? AMBAR : "#6a4810");
}

function pintarEscaleras(dt) {
  for (const [i, esc] of ESCALERAS.entries()) {
    const d = e ? e.escaleras[String(esc.n)] : { en_marcha: true, motor: 58, pasajeros: 34 };
    const [xa, xb] = [Math.min(esc.bx, esc.tx), Math.max(esc.bx, esc.tx)];
    const avance = d.en_marcha ? reloj * 22 * (esc.tx > esc.bx === esc.sube ? -1 : 1) : 0;
    for (let ex = xa; ex <= xb; ex++) {
      const y = yEscalera(esc, ex);
      const marca = Math.floor((ex + avance) / 4) % 2 === 0;
      r(c, marca ? "#aab4c4" : "#6f7a8c", ex, y - 1, 1, 2);
    }
    const caliente = d.motor > 85;
    const color = d.en_marcha ? (caliente ? (parpadeo() ? "#ff3b3b" : AMBAR) : VERDE) : (parpadeo(2) ? "#ff3b3b" : "#5a1010");
    r(c, "#15181f", esc.bx - 3, esc.by - 9, 6, 6);
    r(c, color, esc.bx - 2, esc.by - 8, 4, 4);
    if (caliente) {
      // Humo del motor recalentado, al pie de la escalera
      for (let h = 0; h < 4; h++) {
        const t = (reloj * 0.6 + h / 4) % 1;
        r(c, "#9a9aa2", esc.bx - 6 + h * 4 + Math.round(Math.sin(reloj * 3 + h) * 2), esc.by - 4 - t * 16, 2, 2);
      }
    }
    // Pasajeros
    const cuantos = d.en_marcha ? Math.min(4, Math.round(d.pasajeros / 16)) : 0;
    pasajeros[i].forEach((p, k) => {
      if (d.en_marcha) p.t = (p.t + dt * 0.11 * (esc.sube ? 1 : -1) + 1) % 1;
      if (k >= cuantos) return;
      p.persona.x = esc.bx + (esc.tx - esc.bx) * p.t;
      p.persona.piso = esc.by + (esc.ty - esc.by) * p.t - 1;
      p.persona.mirando = (esc.tx > esc.bx) === esc.sube ? "SE" : "SO";
      p.persona.pintar(c);
    });
  }
}

function pintarPenumbra() {
  const luz = energia().luz;
  if (luz > 95) return;
  c.globalAlpha = (1 - luz / 100) * 0.62;
  r(c, "#02030a", X0, N2.techo, X1 - X0, PB.suelo - N2.techo);
  c.globalAlpha = 1;
  // Luces de emergencia
  for (const nivel of NIVELES) for (const lx of [120, 320, 520]) r(c, parpadeo(1.5) ? "#ffd27a" : "#c09a4a", lx, nivel.techo + 6, 6, 2);
}

// ---------------------------------------------------------------- sótano

const COLORES_AUTO = ["#d04a3a", "#3a7ad0", "#e0b040", "#f4f1e6", "#46a06a", "#8a5ad0", "#e07a3a", "#7a8498"];
const fila = [];
const saliendo = [];
let proximaSalida = 0;
let siguienteAuto = 0;
let barrera = 0;
let giroGenerador = 0;

function actualizarEstacionamiento(dt) {
  const p = e ? e.parking : { fila: 1 };
  const lpr = !e || e.seguridad.lpr;
  const objetivo = Math.max(1, Math.min(9, p.fila));
  if (fila.length < objetivo && (!fila.length || fila[fila.length - 1].x < 282)) fila.push({ x: 308, color: COLORES_AUTO[siguienteAuto++ % COLORES_AUTO.length] });
  fila.forEach((a, i) => {
    const destino = 84 + i * 26;
    a.x = Math.max(destino, a.x - dt * 46);
  });
  proximaSalida -= dt;
  const frente = fila[0];
  if (frente && frente.x <= 84.5 && proximaSalida <= 0) {
    proximaSalida = lpr ? 2.4 : 7;
    if (lpr) {
      fila.shift();
      saliendo.push(frente);
    }
  }
  const abierta = saliendo.length > 0;
  barrera += Math.sign((abierta ? 1 : 0) - barrera) * Math.min(1, dt * 3);
  barrera = Math.max(0, Math.min(1, barrera));
  for (let i = saliendo.length - 1; i >= 0; i--) {
    if (barrera > 0.7) saliendo[i].x -= dt * 58;
    if (saliendo[i].x < X0 - 6) saliendo.splice(i, 1);
  }
}

function pintarSotano(dt) {
  const en = energia();
  const s = e ? e.seguridad : { switch: true, camaras: 48, camaras_total: 48, nvr: true, lpr: true };
  // Autos en el carril
  for (const a of [...saliendo, ...fila]) auto(c, a.x, SOT.suelo, a.color);
  r(c, "#141238", X0 - 6, 300, 20, 46);
  // Barrera, cámara de placas y cajero
  const largo = 30;
  for (let i = 0; i < largo; i++) {
    const ang = barrera * (Math.PI / 2.2);
    r(c, i % 8 < 4 ? "#f4f1e6" : "#d04a3a", 46 + Math.cos(ang) * i, 328 - Math.sin(ang) * i, 2, 2);
  }
  r(c, s.lpr ? "#46d160" : (parpadeo() ? "#ff3b3b" : "#5a1010"), 56, 304, 2, 2);
  r(c, s.lpr ? "#123a2a" : "#5a1414", 70, 325, 8, 6);
  if (!s.lpr && fila.length && parpadeo(1.2)) texto(c, "¡PIII!", fila[0].x - 2, SOT.suelo - 26, "#ffe066");

  // Generador
  if (en.generador) {
    giroGenerador += dt * 14;
    for (let i = 0; i < 5; i++) {
      const t = (reloj * 0.9 + i / 5) % 1;
      r(c, "#c8ccd4", 387 + Math.round(Math.sin(reloj * 5 + i)), 316 - t * 24, 2, 2);
    }
    if (Math.floor(reloj * 12) % 2) r(c, "#d9ad2a", 340, 317, 52, 1);
  }
  for (let i = 0; i < 4; i++) {
    const ang = giroGenerador + (i * Math.PI) / 2;
    for (let k = 1; k < 6; k++) r(c, "#aab4c4", 376 + Math.cos(ang) * k, 331 + Math.sin(ang) * k, 1, 1);
  }
  r(c, en.generador ? "#46d160" : "#3a3f4a", 343, 320, 4, 2);
  textoCentrado(c, `${en.combustible}%`, 353, 329, en.combustible < 40 && en.generador ? (parpadeo(2) ? ROJO : "#7a2020") : "#3a2c08");
  // UPS
  const segmentos = Math.ceil(en.ups_pct / 25);
  const colorUps = en.ups_bateria ? AMBAR : VERDE;
  for (let i = 0; i < 4; i++) r(c, i < segmentos ? colorUps : "#20283a", 402 + i * 5, 319, 4, 6);
  textoCentrado(c, `${en.ups_pct}%`, 412, 329, colorUps);
  if (en.ups_bateria && parpadeo(2.5)) textoCentrado(c, "BAT", 412, 338, AMBAR);
  // Rack de la red de seguridad: switch PoE arriba, grabador abajo
  for (let sy = 304; sy < 342; sy += 6) {
    const fila_ = (sy - 304) / 6;
    const esSwitch = fila_ < 2;
    let color = Math.sin(reloj * 7 + sy * 1.7) > 0 ? "#46d160" : "#14301e";
    if (esSwitch && !s.switch) color = parpadeo() ? "#ff3b3b" : "#3a0c0c";
    if (!esSwitch && fila_ < 5 && !s.nvr) color = parpadeo(2) ? AMBAR : "#3a2a08";
    r(c, color, 446, sy + 1, 2, 2);
    if (esSwitch && s.switch) for (let p = 0; p < 4; p++) r(c, Math.sin(reloj * 9 + p * 2 + sy) > 0 ? "#f0b429" : "#3a2a08", 434 + p * 3, sy + 1, 2, 2);
  }
  // Monitor del guardia
  r(c, "#0a0d14", 458, 320, 16, 12);
  r(c, s.camaras < 40 ? (parpadeo(2) ? "#5a1414" : "#20242e") : "#1f6a5a", 459, 321, 14, 9);
  if (s.camaras >= 40) {
    r(c, "#0a0d14", 465, 321, 1, 9);
    r(c, "#0a0d14", 459, 325, 14, 1);
  }
  pintarPantallaZabbix(problemas());
}

function problemas() {
  return e ? e.problemas : [];
}

function recortarTexto(cadena, letras) {
  return cadena.length > letras ? cadena.slice(0, letras - 1) + "." : cadena;
}

function pintarPantallaZabbix(lista) {
  const x = 484;
  let y = 307;
  if (!lista.length) {
    texto(c, "Sin problemas", x, y + 4, VERDE);
    texto(c, e && !e.zabbix_ok ? (e.ensayo ? "(ensayo)" : "(sin conexión)") : "abiertos", x, y + 14, e && !e.zabbix_ok ? SUAVE : VERDE);
    return;
  }
  // Causas primero, cada una con sus síntomas debajo; lo que no está correlacionado, aparte
  const causas = lista.filter((p) => p.causa);
  const sintomas = lista.filter((p) => p.sintoma && !p.causa);
  const sueltos = lista.filter((p) => !p.causa && !p.sintoma);
  const filas = [];
  for (const p of causas) filas.push(["● ", p.nombre, ROJO]);
  for (const p of sintomas) filas.push([" · ", p.nombre, AMBAR]);
  for (const p of sueltos) filas.push(["● ", p.nombre, BLANCO]);
  for (const [marca, nombre, color] of filas.slice(0, 2)) {
    texto(c, recortarTexto(marca + nombre, 21), x, y, color);
    y += 9;
  }
  if (filas.length > 2) texto(c, ` +${filas.length - 2} más`, x, y, SUAVE);
  const pie = causas.length ? `CEP: ${causas.length} causa${causas.length > 1 ? "s" : ""}, ${sintomas.length} sínt.` : `${lista.length} problemas`;
  texto(c, pie, x, 335, causas.length ? "#7ad0ff" : SUAVE);
}

// ---------------------------------------------------------------- HUD

function panel(x, y, w, h, titulo) {
  c.fillStyle = "rgba(6,8,22,0.86)";
  c.fillRect(x, y, w, h);
  r(c, "#3b4270", x, y, w, 1);
  r(c, "#3b4270", x, y + h - 1, w, 1);
  r(c, "#3b4270", x, y, 1, h);
  r(c, "#3b4270", x + w - 1, y, 1, h);
  if (titulo) texto(c, titulo, x + 5, y + 4, "#f2c75c");
}

function pintarHUD() {
  c.fillStyle = "rgba(6,8,22,0.94)";
  c.fillRect(0, 0, ANCHO, 13);
  r(c, "#d9a441", 0, 13, ANCHO, 1);
  texto(c, "PLAZA ZABBIX · CENTRO COMERCIAL", 5, 3, "#f2c75c");
  const b = titular();
  const color = b.grave ? (Math.floor(reloj * 2.5) % 2 ? ROJO : "#ffdddd") : b.color;
  textoCentrado(c, b.texto, ANCHO / 2 + 66, 3, color);
  const hora = new Date().toTimeString().slice(0, 8);
  texto(c, hora, ANCHO - anchoTexto(hora) - 5, 3, SUAVE);
  if (!e) return;

  const en = e.energia;
  const s = e.seguridad;
  const t = e.clima.temp.n2;
  const enMarcha = Object.values(e.escaleras).filter((x) => x.en_marcha).length;
  const filas = [
    ["ENERGÍA", !en.red ? (en.generador ? `GEN. ${en.autonomia_gen} MIN` : en.ups_bateria ? `UPS ${en.ups_pct}%` : "SIN RED") : "RED OK", !en.red ? (en.generador ? AMBAR : ROJO) : VERDE],
    ["CLIMA", `${t.toFixed(1)}°C`, t > 26 ? ROJO : e.clima.alarma || !e.clima.chiller["1"].en_marcha ? AMBAR : VERDE],
    ["ESCALERAS", `${enMarcha}/4`, enMarcha < 4 ? ROJO : e.escaleras["2"].motor > 85 ? AMBAR : VERDE],
    ["CÁMARAS", `${s.camaras}/${s.camaras_total}`, s.camaras < 40 ? ROJO : VERDE],
    ["ZABBIX", e.zabbix_ok ? "CONECTADO" : e.ensayo ? "ENSAYO" : "SIN CONEX.", e.zabbix_ok ? VERDE : AMBAR],
  ];
  panel(482, 16, 154, filas.length * 9 + 6);
  filas.forEach(([rot, val, col], i) => {
    const y = 20 + i * 9;
    texto(c, "●", 486, y, col);
    texto(c, rot, 494, y, SUAVE);
    texto(c, val, 554, y, col);
  });

  panel(4, 16, 136, 44, "NEGOCIO");
  const n = e.negocio;
  texto(c, `${miles(n.visitantes)} visitantes`, 9, 29, BLANCO);
  texto(c, `${dinero(n.ventas_h)} MXN/h`, 9, 38, n.ventas_h < 450000 ? AMBAR : BLANCO);
  texto(c, `${e.parking.fila} autos en salida`, 9, 47, e.parking.fila > 8 ? ROJO : BLANCO);
}

function titular() {
  if (!e) return { texto: fallasSondeo > 2 ? "SIN CONEXIÓN CON EL SERVIDOR" : "CONECTANDO...", grave: fallasSondeo > 2 };
  const a = e.activos;
  if (a.includes("apagon")) {
    if (e.energia.generador) return { texto: `APAGÓN · GENERADOR CON ${e.energia.autonomia_gen} MIN DE AUTONOMÍA`, grave: true };
    return { texto: "CORTE DE LA RED ELÉCTRICA", grave: true };
  }
  if (a.includes("camaras")) return { texto: `SIN RED DE SEGURIDAD · ${e.parking.fila} AUTOS EN LA SALIDA`, grave: true };
  if (a.includes("chiller")) return { texto: `CHILLER 1 FUERA DE SERVICIO · NIVEL 2 A ${e.clima.temp.n2.toFixed(1)}°C`, grave: true };
  if (a.includes("escalera")) return { texto: e.proteccion ? "ESCALERA 2 DETENIDA POR TEMPERATURA" : "ESCALERA 2: MOTOR SOBRECALENTADO", grave: true };
  return { texto: `ABIERTO · ${miles(e.negocio.visitantes)} VISITANTES · ${e.clima.temp.pb.toFixed(1)}°C`, color: VERDE };
}

function pintarControles() {
  if (!e || !e.controles || dialogo.abierto) return;
  const ayuda = `${e.ensayo ? "ENSAYO" : "DEMO"}  1 apagón  2 chiller  3 cámaras  4 escalera  0 reset  ·  clic: salida del estacionamiento, atención`;
  c.fillStyle = "rgba(120,12,12,0.94)";
  c.fillRect(0, 350, ANCHO, 10);
  textoCentrado(c, ayuda, ANCHO / 2, 352, "#fff");
}

function globo(cadena, x, y) {
  const lineas = partir(cadena, 30);
  const ancho = Math.max(...lineas.map((l) => anchoTexto(l))) + 8;
  const alto = lineas.length * 10 + 5;
  const bx = Math.max(2, Math.min(ANCHO - ancho - 2, Math.round(x - ancho / 2)));
  const by = Math.max(16, y - alto - 3);
  r(c, "#171020", bx - 1, by, ancho + 2, alto);
  r(c, "#171020", bx, by - 1, ancho, alto + 2);
  r(c, "#fbf7ea", bx, by, ancho, alto);
  const px = Math.max(bx + 2, Math.min(bx + ancho - 6, x - 2));
  r(c, "#171020", px, by + alto + 1, 5, 1);
  r(c, "#fbf7ea", px + 1, by + alto, 3, 1);
  lineas.forEach((l, i) => texto(c, l, bx + 4, by + 3 + i * 10, "#171020"));
}

// ---------------------------------------------------------------- interacción

const caja = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const enEscalera = (esc) => (x, y) => {
  const [xa, xb] = [Math.min(esc.bx, esc.tx), Math.max(esc.bx, esc.tx)];
  if (x < xa - 4 || x > xb + 4) return false;
  const ye = yEscalera(esc, Math.max(xa, Math.min(xb, x)));
  return y > ye - 30 && y < ye + 8;
};
const ZONAS = [
  { nombre: "salida", accion: true, etiqueta: "SALIR", px: 72, py: 296, dentro: caja(22, 296, 112, 346) },
  { nombre: "tarjeta", accion: true, etiqueta: "TARJETA", px: 442, py: 240, dentro: caja(414, 232, 506, 288) },
  ...ESCALERAS.map((esc) => ({ nombre: `escalera${esc.n}`, dentro: enEscalera(esc) })),
  { nombre: "chillers", dentro: caja(144, 38, 260, 66) },
  { nombre: "puertas", dentro: caja(X0, PB.techo, 64, PB.suelo) },
  { nombre: "generador", dentro: caja(338, 306, 396, 346) },
  { nombre: "ups", dentro: caja(396, 300, 428, 346) },
  { nombre: "rack", dentro: caja(428, 298, 478, 346) },
  { nombre: "zabbix", dentro: caja(478, 292, 616, 346) },
  { nombre: "parking", dentro: caja(112, 292, 332, 346) },
  { nombre: "n2", dentro: caja(X0, N2.techo, X1, N2.suelo) },
  { nombre: "n1", dentro: caja(X0, N1.techo, X1, N1.suelo) },
  { nombre: "pb", dentro: caja(X0, PB.techo, X1, PB.suelo) },
];

const zonaEn = (x, y) => ZONAS.find((z) => z.dentro(x, y));

const ACCIONES = {
  salida: { quien: "Salida del estacionamiento", espera: "Leyendo la placa y cobrando", ok: (d) => `Placa ${d.placa}: ${d.minutos} min de estadía, ${dinero(d.monto)} MXN. Barrera abierta en ${d.ms} ms.`, mal: "La barrera no abre.", emote: "♪", persona: () => guardia },
  tarjeta: { quien: "Atención al cliente", espera: "Vendiendo una tarjeta de regalo", ok: (d) => `¡Tarjeta ${d.tarjeta} por ${dinero(d.monto)} MXN! Cobrada en ${d.ms} ms.`, mal: "No se pudo vender la tarjeta.", emote: "♥", persona: () => atencion },
};

function* guionAccion(nombre) {
  const a = ACCIONES[nombre];
  sonido.mover();
  const promesa = fetch(`/api/accion/${nombre}`, { method: "POST" })
    .then((x) => x.json()).catch(() => ({ ok: false, error: "El servidor no responde" }));
  const res = yield* dialogo.esperarPromesa(promesa, a.espera, a.quien);
  const persona = a.persona();
  if (res.ok) {
    sonido.moneda();
    persona.mostrar(a.emote, 2);
    yield* dialogo.decir(a.ok(res), a.quien);
  } else {
    sonido.error();
    persona.mostrar("!", 2);
    yield* dialogo.decir(`${a.mal} ${res.error || res.detail || ""}`, a.quien);
  }
}

function* guionInfo(zona) {
  if (!e) return;
  const en = e.energia;
  const cl = e.clima;
  const s = e.seguridad;
  const esc = (n) => {
    const d = e.escaleras[String(n)];
    return [`Escalera ${n}`, `${d.en_marcha ? "En marcha" : "DETENIDA"}. Motor a ${d.motor} °C, vibración ${d.vibracion} mm/s, ${d.pasajeros} pasajeros por minuto.`];
  };
  const nivel = (nombre, clave, locales) => [nombre, `${locales}. Temperatura ${cl.temp[clave].toFixed(1)} °C; el confort termina en 26.`];
  const automaticas = Object.values(e.puertas).filter(Boolean).length;
  const textos = {
    escalera1: esc(1), escalera2: esc(2), escalera3: esc(3), escalera4: esc(4),
    chillers: ["Aire acondicionado", `Chiller 1 ${cl.alarma ? "DISPARADO" : cl.chiller["1"].en_marcha ? `en marcha, ${cl.chiller["1"].a} A` : "detenido"}; chiller 2 ${cl.chiller["2"].en_marcha ? `en marcha, ${cl.chiller["2"].a} A` : "detenido"}. Agua helada a ${cl.agua} °C.`],
    puertas: ["Puertas automáticas", automaticas === 3 ? "Las tres puertas en automático." : `${3 - automaticas} puertas en modo manual: quedan abiertas hasta que vuelve la energía.`],
    generador: ["Generador", `${en.generador ? "En marcha" : "En espera"}. Combustible al ${en.combustible}%: ${en.autonomia_gen} min de autonomía. Solo alimenta cargas esenciales.`],
    ups: ["UPS", `${en.ups_bateria ? "En batería" : "En línea"}, ${en.ups_pct}% de carga. Sostiene la red de seguridad, las cajas y el estacionamiento.`],
    rack: ["Red de seguridad", `Switch PoE ${s.switch ? "en línea" : "SIN RESPUESTA"}. ${s.camaras} de ${s.camaras_total} cámaras; grabación ${s.nvr ? "activa" : "DETENIDA"}.`],
    parking: ["Estacionamiento", `${miles(e.parking.autos)} autos, ${e.parking.ocupacion}% de ocupación. ${e.parking.fila} autos en la salida; lectura de placas ${s.lpr ? "en servicio" : "SIN SERVICIO"}.`],
    n2: nivel("Nivel 2", "n2", "Patio de comidas y cine"),
    n1: nivel("Nivel 1", "n1", "Electrónica y deportes"),
    pb: ["Planta baja", `${miles(e.negocio.visitantes)} visitantes en el centro comercial. Ventas: ${dinero(e.negocio.ventas_h)} MXN por hora.`],
    zabbix: ["Zabbix", resumenZabbix(problemas())],
  };
  const [quien, dicho] = textos[zona];
  sonido.mover();
  yield* dialogo.decir(dicho, quien);
}

function resumenZabbix(lista) {
  if (!lista.length) return "No hay problemas abiertos de la demo.";
  const causas = lista.filter((p) => p.causa);
  const sintomas = lista.filter((p) => p.sintoma && !p.causa);
  if (!causas.length) return `${lista.length} problemas abiertos, sin correlación.`;
  const sueltos = lista.length - causas.length - sintomas.length;
  if (causas.length > 1) return `CEP separó ${causas.length} incidentes: ${causas.map((p) => p.nombre).join("; ")}. ${sintomas.length} síntomas en total.`;
  return `CEP agrupó ${sintomas.length} síntomas bajo la causa: ${causas[0].nombre}.${sueltos ? ` ${sueltos} aparte, sin relación.` : ""}`;
}

function aInterno(ev) {
  const b = pantalla.getBoundingClientRect();
  return { x: ((ev.clientX - b.left) / b.width) * ANCHO, y: ((ev.clientY - b.top) / b.height) * ALTO };
}

let raton = { x: -1, y: -1 };
const entrada = {};

pantalla.addEventListener("mousemove", (ev) => { raton = aInterno(ev); });
pantalla.addEventListener("click", (ev) => {
  activarAudio();
  pantalla.focus();
  if (dialogo.abierto) {
    entrada.a = true;
    return;
  }
  const { x, y } = aInterno(ev);
  const z = zonaEn(x, y);
  if (!z) return;
  dialogo.abrir(z.accion ? guionAccion(z.nombre) : guionInfo(z.nombre));
});

function ordenar(ruta) {
  fetch(ruta, { method: "POST" }).catch(() => {});
}

window.addEventListener("keydown", (ev) => {
  activarAudio();
  const k = ev.key;
  if (k === " ") ev.preventDefault();
  if (ev.repeat) return;
  if (k === "Enter" || k === " " || k === "z") entrada.a = true;
  if (k === "Escape" || k === "x") entrada.b = true;
  if (k === "m") alternarSilencio();
  if (e && e.controles && !dialogo.abierto) {
    if (k === "1") ordenar("/api/escenario/apagon");
    if (k === "2") ordenar("/api/escenario/chiller");
    if (k === "3") ordenar("/api/escenario/camaras");
    if (k === "4") ordenar("/api/escenario/escalera");
    if (k === "0") ordenar("/api/reset");
  }
});

// ---------------------------------------------------------------- cuadro

function pintarEtiquetas(zonaActual) {
  if (dialogo.abierto) return;
  ZONAS.filter((z) => z.accion).forEach((z, i) => {
    const sobre = zonaActual === z;
    const bote = Math.round(Math.sin(reloj * 4 + i * 1.3) * 1.5);
    const etiqueta = sobre ? "¡CLIC!" : z.etiqueta;
    const w = anchoTexto(etiqueta) + 8;
    c.fillStyle = "rgba(6,8,22,0.9)";
    c.fillRect(z.px - w / 2, z.py - 2 + bote, w, 11);
    textoCentrado(c, etiqueta, z.px, z.py + bote, "#fff27a");
  });
}

let previo = performance.now();

function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - previo) / 1000);
  previo = ahora;
  reloj += dt;

  dialogo.actualizar(dt, { ...entrada });
  for (const k of Object.keys(entrada)) entrada[k] = false;
  const hayAlarma = problemas().length > 0;
  for (const p of caminantes) p.actualizar(dt, p === tecnico && hayAlarma);
  for (const p of [atencion, barista, ...fijos]) p.actualizar(dt);
  actualizarEstacionamiento(dt);
  if (hayAlarma && Math.random() < dt * 0.3) guardia.mostrar("!", 1.2);
  if (e && e.clima.temp.n2 > 26 && Math.random() < dt * 0.4) [comensal, comensalB, paseanteF][Math.floor(Math.random() * 3)].mostrar("sudor", 1.6);

  c.drawImage(fondo, 0, 0);
  pintarAzotea(dt);
  pintarLocales();
  pintarClimaYCamaras();
  pintarSotano(dt);
  for (const p of fijos) p.pintar(c);
  for (const p of caminantes) p.pintar(c);
  pintarEscaleras(dt);
  pintarPuertas(dt);
  pintarPenumbra();
  for (const p of conVoz) if (p.dicho) globo(p.dicho, p.x, p.piso - 30);
  pintarHUD();

  const z = dialogo.abierto ? null : zonaEn(raton.x, raton.y);
  pantalla.style.cursor = z ? "pointer" : "default";
  pintarEtiquetas(z);
  dialogo.pintar(c);
  pintarControles();
  if (silencio) texto(c, "SIN SONIDO", ANCHO - 66, 70, SUAVE);

  salida.imageSmoothingEnabled = false;
  salida.drawImage(buffer, 0, 0, pantalla.width, pantalla.height);
  requestAnimationFrame(cuadro);
}

// Se dibuja en un múltiplo entero y el navegador lo ajusta al tamaño final: los píxeles quedan todos iguales
function ajustar() {
  const dpr = window.devicePixelRatio || 1;
  const escala = Math.min(window.innerWidth / ANCHO, window.innerHeight / ALTO);
  const k = Math.max(1, Math.ceil(escala * dpr));
  pantalla.width = ANCHO * k;
  pantalla.height = ALTO * k;
  pantalla.style.width = `${Math.floor(ANCHO * escala)}px`;
  pantalla.style.height = `${Math.floor(ALTO * escala)}px`;
}
window.addEventListener("resize", ajustar);
ajustar();

window.mall = { get estado() { return e; } };
sondear();
pantalla.focus();
requestAnimationFrame(cuadro);
