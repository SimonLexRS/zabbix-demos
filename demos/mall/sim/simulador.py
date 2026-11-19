#!/usr/bin/env python3
"""Simulador del centro comercial: modelo de 1 s que alimenta la escena y envía todo a Zabbix por trapper.

Toda la operación es simulada: no hay agentes, sensores ni un centro comercial real. Cada escenario tiene una línea de
tiempo fija con la causa primero y los síntomas después, porque las reglas CEP toman el primer evento de la ventana
como causa. Sin ZABBIX_TRAPPER_HOST no envía nada (modo ensayo).

Apagón (segundos desde que empieza, a velocidad 1):
   0  cae el suministro de la red eléctrica (la causa)
   8  la UPS pasa a batería y la iluminación queda en modo de emergencia
  12  se detienen las escaleras mecánicas y los chillers
  15  las puertas automáticas quedan en modo manual
  20  arranca el generador, con poco combustible: su autonomía es la alarma siguiente
  30  la UPS vuelve a la línea y las puertas, a automático; escaleras y chillers no son carga esencial y siguen detenidos
Chiller: el chiller 1 se dispara; el 2 se sobrecarga, sube el agua helada y después la temperatura de los niveles 2 y 1.
Cámaras: cae el switch PoE de seguridad; cámaras y grabación fuera de línea, la lectura de placas falla y se arma fila
en la salida del estacionamiento.
Escalera: el motor de la escalera 2 se sobrecalienta, la protección térmica la detiene y la escalera 1 se sobrecarga.
"""
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import estado_demo as estado  # noqa: E402
from zbx_sender import ZabbixSender  # noqa: E402

TRAPPER_HOST = os.environ.get("ZABBIX_TRAPPER_HOST", "")
TRAPPER_PORT = int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051"))
ENVIO_SEG = 5

H_ENERGIA = "Mall - Energia"
H_CLIMA = "Mall - Clima"
H_ESCALERAS = "Mall - Escaleras"
H_PUERTAS = "Mall - Puertas"
H_SEGURIDAD = "Mall - Seguridad"
H_PARKING = "Mall - Estacionamiento"
H_NEGOCIO = "Mall - Negocio"

# Líneas de tiempo (segundos)
T_UPS, T_PARADA, T_PUERTAS, T_GENERADOR, T_ESENCIALES = 8, 12, 15, 20, 30
T_SOBRECARGA, T_AGUA, T_CALOR = 10, 20, 15
T_CAMARAS, T_NVR, T_LPR = 10, 15, 20
T_PROTECCION, T_DESVIO = 10, 20
# Umbrales: los mismos que los triggers de Zabbix
UMBRAL_LUZ = 60
UMBRAL_AUTONOMIA = 45
UMBRAL_CHILLER_A = 180
UMBRAL_AGUA = 10
UMBRAL_TEMP = 26
UMBRAL_CAMARAS = 40
UMBRAL_FILA = 8
UMBRAL_MOTOR = 85
UMBRAL_PASAJEROS = 55

CAMARAS = 48
ESCALERAS = (1, 2, 3, 4)
PUERTAS = ("norte", "sur", "estacionamiento")
NIVELES = ("pb", "n1", "n2")
TEMP_NORMAL = {"pb": 22.5, "n1": 23.0, "n2": 23.5}
TEMP_SIN_CHILLER = {"pb": 25.0, "n1": 27.6, "n2": 28.8}
TEMP_APAGON = {"pb": 24.2, "n1": 24.8, "n2": 25.3}  # la inercia del edificio no llega al umbral en un corte breve
VENTAS_H = 640000
CAJONES = 900


def acercar(actual, objetivo, factor):
    return actual + (objetivo - actual) * min(1.0, factor)


class Mundo:
    def __init__(self):
        self.red = True
        self.tension = 13.2
        self.ups_bateria = False
        self.ups_pct = 100.0
        self.generador = False
        self.combustible = 36.0
        self.luz = 100.0
        self.chiller = {1: True, 2: True}
        self.chiller_alarma = False
        self.chiller_a = {1: 118.0, 2: 121.0}
        self.agua = 6.5
        self.temp = dict(TEMP_NORMAL)
        self.escalera = {n: True for n in ESCALERAS}
        self.proteccion = False
        self.motor = {n: 58.0 for n in ESCALERAS}
        self.vibracion = {n: 2.1 for n in ESCALERAS}
        self.pasajeros = {n: 34.0 for n in ESCALERAS}
        self.puerta_auto = {p: True for p in PUERTAS}
        self.ciclos = {p: 18.0 for p in PUERTAS}
        self.switch = True
        self.camaras = float(CAMARAS)
        self.nvr = True
        self.lpr = True
        self.fila = 1.0
        self.ocupacion = 71.0
        self.visitantes = 4200.0
        self.ventas_h = float(VENTAS_H)
        self.bitacora = []
        self.previos = set()
        self.marcas = set()

    def anotar(self, texto, tipo="info"):
        self.bitacora.append({"t": time.time(), "txt": texto, "tipo": tipo})
        del self.bitacora[:-40]

    def marca(self, clave, condicion, texto, tipo="alerta"):
        """Anota un cruce de umbral una sola vez, hasta que vuelva a la normalidad."""
        if condicion and clave not in self.marcas:
            self.marcas.add(clave)
            self.anotar(texto, tipo)
        elif not condicion:
            self.marcas.discard(clave)

    @property
    def escaleras_en_marcha(self):
        return sum(self.escalera.values())

    @property
    def chillers_en_marcha(self):
        return sum(self.chiller.values())

    @property
    def puertas_auto(self):
        return sum(self.puerta_auto.values())

    @property
    def autonomia_gen(self):
        return self.combustible * 1.15

    @property
    def carga_kw(self):
        return 180 + sum(self.chiller_a.values()) * 1.9 + self.escaleras_en_marcha * 22 + self.luz * 2.4

    def paso(self, dt, activos, velocidad, ahora):
        def edad(nombre):
            return (ahora - activos[nombre]) * velocidad if nombre in activos else None

        for nuevo in set(activos) - self.previos:
            self.anotar(f"Escenario: {estado.CATALOGO[nuevo]}", "escenario")
        if self.previos and not activos:
            self.anotar("Reset: operación normal", "ok")
        self.previos = set(activos)
        r = random.uniform

        # ---- Energía: la causa llega primero, de golpe
        a = edad("apagon")
        en = (lambda desde: a is not None and a >= desde)
        self.red = a is None
        self.tension = 13.2 + r(-0.05, 0.05) if self.red else 0.0
        self.generador = en(T_GENERADOR)
        self.ups_bateria = en(T_UPS) and not en(T_ESENCIALES)
        self.ups_pct = max(20.0, self.ups_pct - 0.6 * dt) if self.ups_bateria else min(100.0, self.ups_pct + 0.3 * dt)
        self.combustible = max(4.0, self.combustible - 0.02 * dt) if self.generador else min(36.0, self.combustible + 0.2 * dt)
        self.luz = acercar(self.luz, 35 if en(T_UPS) else 100, 0.9 * dt)

        # ---- Escaleras mecánicas
        e = edad("escalera")
        esc = (lambda desde: e is not None and e >= desde)
        self.proteccion = esc(T_PROTECCION)
        for n in ESCALERAS:
            self.escalera[n] = not en(T_PARADA) and not (n == 2 and self.proteccion)
            caliente = n == 2 and e is not None
            objetivo_motor = 96 if caliente and not self.proteccion else (89 if caliente else (58 if self.escalera[n] else 36))  # detenida, el motor tarda en enfriar
            self.motor[n] = acercar(self.motor[n], objetivo_motor, (0.9 if caliente and not self.proteccion else 0.04) * dt) + r(-0.2, 0.2)
            self.vibracion[n] = max(0.0, acercar(self.vibracion[n], (7.4 if caliente else 2.1) if self.escalera[n] else 0, 0.5 * dt) + r(-0.05, 0.05))
            objetivo_pax = 0 if not self.escalera[n] else (64 if n == 1 and esc(T_DESVIO) else 34)
            self.pasajeros[n] = max(0.0, acercar(self.pasajeros[n], objetivo_pax, 0.4 * dt) + (r(-1.5, 1.5) if objetivo_pax else 0))

        # ---- Aire acondicionado
        c = edad("chiller")
        chi = (lambda desde: c is not None and c >= desde)
        self.chiller_alarma = c is not None
        self.chiller[1] = not en(T_PARADA) and c is None
        self.chiller[2] = not en(T_PARADA)
        objetivos_a = {1: 118 if self.chiller[1] else 0, 2: (204 if chi(T_SOBRECARGA) else 121) if self.chiller[2] else 0}
        for n in (1, 2):
            self.chiller_a[n] = max(0.0, acercar(self.chiller_a[n], objetivos_a[n], 0.6 * dt) + (r(-1, 1) if objetivos_a[n] else 0))
        sin_frio = not self.chillers_en_marcha
        self.agua = acercar(self.agua, 13.5 if chi(T_AGUA) else (9.4 if sin_frio else 6.5), (0.25 if chi(T_AGUA) else 0.05) * dt) + r(-0.02, 0.02)
        for nivel in NIVELES:
            if chi(T_CALOR):
                objetivo, k = TEMP_SIN_CHILLER[nivel], {"pb": 0.02, "n1": 0.022, "n2": 0.032}[nivel]
            elif sin_frio:
                objetivo, k = TEMP_APAGON[nivel], 0.02
            else:
                objetivo, k = TEMP_NORMAL[nivel], 0.06
            self.temp[nivel] = acercar(self.temp[nivel], objetivo, k * dt) + r(-0.01, 0.01)

        # ---- Puertas automáticas: sin energía quedan abiertas en manual hasta que el generador las recupera
        for p in PUERTAS:
            self.puerta_auto[p] = not (en(T_PUERTAS) and not en(T_ESENCIALES))
            self.ciclos[p] = max(0.0, acercar(self.ciclos[p], 18 if self.puerta_auto[p] else 0, 0.5 * dt) + (r(-1, 1) if self.puerta_auto[p] else 0))

        # ---- Seguridad: cámaras, grabación y lectura de placas dependen del switch PoE
        s = edad("camaras")
        seg = (lambda desde: s is not None and s >= desde)
        self.switch = s is None
        self.camaras = acercar(self.camaras, 9 if seg(T_CAMARAS) else CAMARAS, 0.8 * dt)
        self.nvr = not seg(T_NVR)
        self.lpr = not seg(T_LPR)
        self.fila = max(0.0, acercar(self.fila, 17 if seg(T_LPR) else 1, (0.06 if seg(T_LPR) else 0.15) * dt) + r(-0.05, 0.05))
        self.ocupacion = 71 + 4 * math.sin(ahora / 300)

        # ---- Negocio
        self.visitantes = 4200 + 260 * math.sin(ahora / 210)
        factor = (0.4 if en(T_UPS) else 1.0) * (1 - max(0.0, self.temp["n2"] - 25) * 0.05)
        self.ventas_h = max(0.0, acercar(self.ventas_h, VENTAS_H * factor, 0.2 * dt) + r(-3000, 3000))

        self.marca("red", not self.red, "Energía: se cortó el suministro de la red")
        self.marca("generador", self.generador, "Generador en marcha, con poco combustible", "ok")
        self.marca("parada", self.escaleras_en_marcha < 2, "Escaleras mecánicas y chillers detenidos")
        self.marca("chiller", self.chiller_alarma, "Chiller 1 disparado por alta presión")
        self.marca("calor", self.temp["n2"] > UMBRAL_TEMP, "Nivel 2: temperatura sobre el umbral de confort")
        self.marca("switch", not self.switch, "Seguridad: el switch PoE no responde")
        self.marca("camaras", self.camaras < UMBRAL_CAMARAS, "Cámaras fuera de línea")
        self.marca("fila", self.fila > UMBRAL_FILA, "Estacionamiento: fila de autos en la salida")
        self.marca("motor", self.motor[2] > UMBRAL_MOTOR, "Escalera 2: motor sobrecalentado")
        self.marca("proteccion", self.proteccion, "Escalera 2: detenida por protección térmica")


def valores(m):
    lote = []

    def poner(host, datos):
        lote.extend({"host": host, "key": k, "value": v} for k, v in datos.items())

    poner(H_ENERGIA, {
        "mall.energia.red": int(m.red),
        "mall.energia.tension": round(m.tension, 2),
        "mall.energia.carga_kw": round(m.carga_kw, 1),
        "mall.ups.en_bateria": int(m.ups_bateria),
        "mall.ups.bateria_pct": round(m.ups_pct, 1),
        "mall.gen.en_marcha": int(m.generador),
        "mall.gen.combustible_pct": round(m.combustible, 1),
        "mall.gen.autonomia_min": round(m.autonomia_gen, 1),
        "mall.luz.nivel_pct": round(m.luz),
    })
    clima = {"mall.clima.chillers_en_marcha": m.chillers_en_marcha, "mall.clima.chiller.alarma[1]": int(m.chiller_alarma), "mall.clima.agua_helada": round(m.agua, 1)}
    for n in (1, 2):
        clima[f"mall.clima.chiller.en_marcha[{n}]"] = int(m.chiller[n])
        clima[f"mall.clima.chiller.corriente[{n}]"] = round(m.chiller_a[n], 1)
    for nivel in NIVELES:
        clima[f"mall.clima.temperatura[{nivel}]"] = round(m.temp[nivel], 1)
    poner(H_CLIMA, clima)
    escaleras = {"mall.escalera.en_marcha_total": m.escaleras_en_marcha, "mall.escalera.proteccion[2]": int(m.proteccion)}
    for n in ESCALERAS:
        escaleras[f"mall.escalera.en_marcha[{n}]"] = int(m.escalera[n])
        escaleras[f"mall.escalera.motor[{n}]"] = round(m.motor[n], 1)
        escaleras[f"mall.escalera.vibracion[{n}]"] = round(m.vibracion[n], 2)
        escaleras[f"mall.escalera.pasajeros[{n}]"] = round(m.pasajeros[n])
    poner(H_ESCALERAS, escaleras)
    puertas = {"mall.puerta.automaticas": m.puertas_auto}
    for p in PUERTAS:
        puertas[f"mall.puerta.automatica[{p}]"] = int(m.puerta_auto[p])
        puertas[f"mall.puerta.ciclos[{p}]"] = round(m.ciclos[p])
    poner(H_PUERTAS, puertas)
    poner(H_SEGURIDAD, {
        "mall.seg.switch": int(m.switch),
        "mall.seg.camaras": round(m.camaras),
        "mall.seg.nvr_grabando": int(m.nvr),
        "mall.seg.lpr": int(m.lpr),
    })
    poner(H_PARKING, {"mall.parking.fila_salida": round(m.fila), "mall.parking.ocupacion_pct": round(m.ocupacion, 1), "mall.parking.autos": round(CAJONES * m.ocupacion / 100)})
    poner(H_NEGOCIO, {"mall.negocio.ventas_h": round(m.ventas_h), "mall.negocio.visitantes": round(m.visitantes)})
    return lote


def problemas_ensayo(m):
    """Problemas de mentira para ensayar la escena sin Zabbix. Con Zabbix conectado no se usan."""
    lista = []

    def p(condicion, nombre, sev, causa=False):
        if condicion:
            lista.append({"nombre": nombre, "severidad": sev, "causa": causa})

    p(not m.red, "Energía: sin suministro de la red externa", 4, True)
    p(m.ups_bateria, "UPS: en batería", 3)
    p(m.luz < UMBRAL_LUZ, "Iluminación: modo de emergencia", 2)
    p(m.escaleras_en_marcha < 2, "Escaleras mecánicas: detenidas", 3)
    p(m.chillers_en_marcha < 1, "Aire acondicionado: chillers detenidos", 3)
    p(m.puertas_auto < 3, "Puertas automáticas: en modo manual", 2)
    p(m.generador and m.autonomia_gen < UMBRAL_AUTONOMIA, "Generador: autonomía menor a 45 min", 4)
    p(m.chiller_alarma, "Chiller 1: compresor disparado por alta presión", 4, True)
    p(m.chiller_a[2] > UMBRAL_CHILLER_A, "Chiller 2: sobrecarga", 3)
    p(m.agua > UMBRAL_AGUA, "Aire acondicionado: agua helada caliente", 3)
    p(m.temp["n2"] > UMBRAL_TEMP, "Nivel 2: temperatura alta", 3)
    p(m.temp["n1"] > UMBRAL_TEMP, "Nivel 1: temperatura alta", 3)
    p(not m.switch, "Seguridad: switch PoE sin respuesta", 4, True)
    p(m.camaras < UMBRAL_CAMARAS, "Seguridad: cámaras fuera de línea", 4)
    p(not m.nvr, "Seguridad: grabación detenida", 3)
    p(not m.lpr, "Estacionamiento: lectura de placas sin servicio", 3)
    p(m.fila > UMBRAL_FILA, "Estacionamiento: fila de autos en la salida", 3)
    p(m.motor[2] > UMBRAL_MOTOR, "Escalera 2: temperatura del motor alta", 4, True)
    p(m.proteccion, "Escalera 2: detenida por protección térmica", 3)
    p(m.pasajeros[1] > UMBRAL_PASAJEROS, "Escalera 1: sobrecarga de pasajeros", 2)
    return lista


def foto(m, activos, velocidad, ahora):
    return {
        "ts": ahora,
        "velocidad": velocidad,
        "activos": sorted(activos),
        "energia": {"red": m.red, "tension": round(m.tension, 1), "carga_kw": round(m.carga_kw), "ups_bateria": m.ups_bateria, "ups_pct": round(m.ups_pct),
                    "generador": m.generador, "combustible": round(m.combustible), "autonomia_gen": round(m.autonomia_gen), "luz": round(m.luz)},
        "clima": {"chiller": {str(n): {"en_marcha": m.chiller[n], "a": round(m.chiller_a[n])} for n in (1, 2)}, "alarma": m.chiller_alarma,
                  "agua": round(m.agua, 1), "temp": {n: round(v, 1) for n, v in m.temp.items()}},
        "escaleras": {str(n): {"en_marcha": m.escalera[n], "motor": round(m.motor[n]), "vibracion": round(m.vibracion[n], 1), "pasajeros": round(m.pasajeros[n])} for n in ESCALERAS},
        "proteccion": m.proteccion,
        "puertas": {p: m.puerta_auto[p] for p in PUERTAS},
        "seguridad": {"switch": m.switch, "camaras": round(m.camaras), "camaras_total": CAMARAS, "nvr": m.nvr, "lpr": m.lpr},
        "parking": {"fila": round(m.fila), "ocupacion": round(m.ocupacion), "autos": round(CAJONES * m.ocupacion / 100)},
        "negocio": {"visitantes": round(m.visitantes), "ventas_h": round(m.ventas_h)},
        "bitacora": m.bitacora,
        "problemas_ensayo": problemas_ensayo(m),
    }


def main():
    m = Mundo()
    sender = ZabbixSender(TRAPPER_HOST, TRAPPER_PORT) if TRAPPER_HOST else None
    print(f"Simulador en marcha; trapper {'hacia ' + TRAPPER_HOST if sender else 'desactivado (ensayo)'}", flush=True)
    proximo_envio = 0.0
    previo = time.time()
    while True:
        ahora = time.time()
        crudo = ahora - previo
        previo = ahora
        esc = estado.escenarios()
        activos, velocidad = esc["activos"], esc["velocidad"]
        if set(activos) != m.previos:
            proximo_envio = 0.0  # la causa sale ya, sola: así llega antes que sus síntomas a cualquier velocidad
        m.paso(crudo * velocidad, activos, velocidad, ahora)
        estado.escribir(estado.MUNDO, foto(m, activos, velocidad, ahora))
        if sender and ahora >= proximo_envio:
            proximo_envio = ahora + ENVIO_SEG
            try:
                ok, info = sender.send_batch(valores(m))
                if not ok:
                    print(f"!! trapper: {info}", flush=True)
            except OSError as e:
                print(f"!! trapper: {e}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
