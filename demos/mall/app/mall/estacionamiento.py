"""estacionamiento: la salida del estacionamiento. Lee la placa, calcula la estadía, cobra y levanta la barrera."""
import os
import random
import time

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "estacionamiento")

LPR = os.environ.get("LPR_URL", "http://127.0.0.1:8202")
CAJA = os.environ.get("CAJA_URL", "http://127.0.0.1:8204")
BD = comun.DATOS / "estacionamiento.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS salidas (id INTEGER PRIMARY KEY, placa TEXT, minutos INTEGER, monto REAL, creada REAL)")
TARIFA_HORA = 28


class Salida(BaseModel):
    carril: str = "Salida 1"
    canal: str = "demo"


@app.get("/salud")
def salud():
    return {"ok": True}


def _traza():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


def _fallo(paso, detalle):
    trace.get_current_span().set_status(Status(StatusCode.ERROR, detalle))
    comun.anotar(resultado="error", paso_fallido=paso)
    return JSONResponse(status_code=502, content={"ok": False, "paso": paso, "error": detalle, "trace_id": _traza()})


@app.post("/salida")
def salida(datos: Salida):
    comun.anotar(carril=datos.carril, canal=datos.canal)
    time.sleep(random.uniform(0.01, 0.03))
    try:
        lectura = httpx.post(f"{LPR}/leer", json={"carril": datos.carril}, timeout=8)
        leida = lectura.status_code == 200
    except httpx.HTTPError:
        leida = False
    if not leida:
        return _fallo("lpr", "No se pudo leer la placa: la barrera no abre")
    placa = lectura.json()["placa"]
    minutos = random.randint(25, 260)
    monto = round(max(1, minutos / 60) * TARIFA_HORA)
    cobro = httpx.post(f"{CAJA}/cobrar", json={"concepto": "estacionamiento", "monto": monto}, timeout=8)
    if cobro.status_code != 200:
        return _fallo("caja", "No se pudo cobrar la estadía")
    comun.consulta(BD, "INSERT INTO salidas (placa, minutos, monto, creada) VALUES (?, ?, ?, ?)", (placa, minutos, monto, time.time()))
    comun.anotar(resultado="ok", placa=placa, minutos=minutos, monto=monto)
    return {"ok": True, "placa": placa, "minutos": minutos, "monto": monto, "trace_id": _traza()}
