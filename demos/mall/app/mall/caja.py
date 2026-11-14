"""caja: pasarela de cobros del centro comercial. Registra cada pago del estacionamiento y cada tarjeta de regalo."""
import random
import time

from fastapi import FastAPI
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "caja")

BD = comun.DATOS / "caja.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS cobros (id INTEGER PRIMARY KEY, concepto TEXT, monto REAL, creado REAL)")


class Cobro(BaseModel):
    concepto: str
    monto: float


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/cobrar")
def cobrar(datos: Cobro):
    time.sleep(random.uniform(0.03, 0.09))
    comun.consulta(BD, "INSERT INTO cobros (concepto, monto, creado) VALUES (?, ?, ?)", (datos.concepto, datos.monto, time.time()))
    comun.anotar(concepto=datos.concepto, monto=datos.monto)
    return {"autorizado": True}
