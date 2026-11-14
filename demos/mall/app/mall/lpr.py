"""lpr: lectura de placas en la salida del estacionamiento. Depende de las cámaras: sin el switch PoE no puede leer."""
import os
import random
import string
import sys
import time

from fastapi import FastAPI, HTTPException
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo  # noqa: E402

from . import comun  # noqa: E402

app = FastAPI()
comun.instrumentar(app, "lpr")
tracer = trace.get_tracer("mall.lpr")

PROBABILIDAD_ERROR = 0.85


class Lectura(BaseModel):
    carril: str = "Salida 1"


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/leer")
def leer(datos: Lectura):
    # El servicio ve lo mismo que Zabbix: si el simulador da por caída la cámara del carril, la lectura se cuelga y falla
    en_linea = estado_demo.leer(estado_demo.MUNDO, {}).get("seguridad", {}).get("lpr", True)
    comun.anotar(carril=datos.carril, camara_en_linea=en_linea)
    if not en_linea:
        with tracer.start_as_current_span("esperar imagen de la cámara") as espera:
            time.sleep(random.uniform(0.7, 1.5))
            espera.set_status(Status(StatusCode.ERROR, "La cámara del carril no entrega imagen"))
        if random.random() < PROBABILIDAD_ERROR:
            raise HTTPException(503, "La cámara del carril no entrega imagen")
    with tracer.start_as_current_span("reconocer la placa"):
        time.sleep(random.uniform(0.03, 0.08))
    placa = "".join(random.choices(string.ascii_uppercase, k=3)) + "-" + "".join(random.choices(string.digits, k=3))
    comun.anotar(placa=placa)
    return {"placa": placa}
