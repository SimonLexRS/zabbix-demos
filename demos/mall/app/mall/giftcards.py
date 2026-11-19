"""giftcards: venta de tarjetas de regalo en el módulo de atención al cliente."""
import os
import random
import time
import uuid

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "giftcards")

CAJA = os.environ.get("CAJA_URL", "http://127.0.0.1:8204")
BD = comun.DATOS / "giftcards.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS tarjetas (codigo TEXT PRIMARY KEY, monto REAL, creada REAL)")
MONTOS = (200, 300, 500, 500, 1000)


class Compra(BaseModel):
    monto: int = 500
    canal: str = "demo"


@app.get("/salud")
def salud():
    return {"ok": True}


def _traza():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


@app.post("/compra")
def compra(datos: Compra):
    monto = datos.monto if datos.monto in MONTOS else 500
    codigo = f"PZ-{uuid.uuid4().hex[:8].upper()}"
    comun.anotar(canal=datos.canal, tarjeta=codigo)
    time.sleep(random.uniform(0.02, 0.06))
    cobro = httpx.post(f"{CAJA}/cobrar", json={"concepto": "tarjeta de regalo", "monto": monto}, timeout=8)
    if cobro.status_code != 200:
        trace.get_current_span().set_status(Status(StatusCode.ERROR, "Cobro rechazado"))
        comun.anotar(resultado="error", paso_fallido="caja")
        return JSONResponse(status_code=502, content={"ok": False, "paso": "caja", "error": "No se pudo cobrar la tarjeta", "trace_id": _traza()})
    comun.consulta(BD, "INSERT INTO tarjetas VALUES (?, ?, ?)", (codigo, monto, time.time()))
    comun.anotar(resultado="ok", monto=monto)
    return {"ok": True, "tarjeta": codigo, "monto": monto, "trace_id": _traza()}
