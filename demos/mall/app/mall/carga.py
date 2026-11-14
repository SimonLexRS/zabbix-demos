"""Generador de carga: autos que salen del estacionamiento y clientes que compran tarjetas de regalo, sin parar.

Publica en $ESTADO_DIR/latencia.json el p95 y el porcentaje de errores de los últimos 45 s, para el check y la escena.
"""
import collections
import os
import random
import sys
import threading
import time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo as estado  # noqa: E402

ESTACIONAMIENTO = os.environ.get("ESTACIONAMIENTO_URL", "http://127.0.0.1:8201")
GIFTCARDS = os.environ.get("GIFTCARDS_URL", "http://127.0.0.1:8203")
VENTANA_SEG = 45
MONTOS = (200, 300, 500, 500, 1000)
# (nombre, período medio en segundos, pedido)
FLUJOS = (
    ("estacionamiento", 1.8, lambda: (f"{ESTACIONAMIENTO}/salida", {"carril": random.choice(("Salida 1", "Salida 2")), "canal": "carga"})),
    ("giftcards", 3.5, lambda: (f"{GIFTCARDS}/compra", {"monto": random.choice(MONTOS), "canal": "carga"})),
)

muestras = collections.deque()
candado = threading.Lock()


def un_pedido(nombre, armar):
    url, cuerpo = armar()
    inicio = time.monotonic()
    try:
        ok = httpx.post(url, json=cuerpo, timeout=15).status_code == 200
    except httpx.HTTPError:
        ok = False
    with candado:
        muestras.append((time.time(), (time.monotonic() - inicio) * 1000, ok, nombre))


def resumen(filas):
    n = len(filas)
    duraciones = sorted(m[1] for m in filas)
    return {
        "n": n,
        "p95_ms": round(duraciones[min(n - 1, int(n * 0.95))]) if n else 0,
        "err_pct": round(sum(not m[2] for m in filas) / n * 100, 1) if n else 0,
    }


def publicar():
    while True:
        limite = time.time() - VENTANA_SEG
        with candado:
            while muestras and muestras[0][0] < limite:
                muestras.popleft()
            actuales = list(muestras)
        datos = resumen(actuales)
        for nombre, _, _ in FLUJOS:
            datos[nombre] = resumen([m for m in actuales if m[3] == nombre])
        estado.escribir(estado.LATENCIA, datos)
        time.sleep(2)


def flujo(nombre, periodo, armar):
    while True:
        threading.Thread(target=un_pedido, args=(nombre, armar), daemon=True).start()
        time.sleep(random.expovariate(1 / periodo))


def main():
    threading.Thread(target=publicar, daemon=True).start()
    for nombre, periodo, armar in FLUJOS[1:]:
        threading.Thread(target=flujo, args=(nombre, periodo, armar), daemon=True).start()
    flujo(*FLUJOS[0])


if __name__ == "__main__":
    main()
