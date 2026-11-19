"""Backend de la escena 3D: sirve la webapp, une el estado de la simulación con los problemas reales de Zabbix y
reenvía las acciones al servicio de control (el token nunca llega al navegador)."""
import collections
import json
import os
import pathlib
import ssl
import sys
import threading
import time
import urllib.request

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import estado_demo as estado  # noqa: E402

AQUI = pathlib.Path(__file__).resolve().parent
CONTROL = os.environ.get("CONTROL_URL_INTERNA", "http://127.0.0.1:8091")
CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
ZABBIX_WEB_URL = os.environ.get("ZABBIX_WEB_URL", "").rstrip("/")
CONTROLES = os.environ.get("AUTOPISTA_CONTROLES", "1") == "1"
ENSAYO = os.environ.get("AUTOPISTA_ENSAYO", "0") == "1"
SONDEO_SEG = 5
HOST_RECAUDO = "Autopista - Recaudo"
CLAVES_KPI = ["arm.kpi[recaudo_hoy]", "arm.kpi[transacciones_hoy]", "arm.kpi[tag_pct_hoy]", "arm.apm.gateway.p95", "arm.apm.gateway.error_pct"]
TAGS_HUD = ("zona", "rol", "incidente", "causa_raiz", "responsable", "problema")

app = FastAPI(title="Autopista Río Magdalena")
app.add_middleware(GZipMiddleware, minimum_size=1000)
bitacora_web = collections.deque(maxlen=40)
zabbix = {"ok": False, "problemas": [], "kpi": {}, "dashboard": ""}
vistos = {}
candado = threading.Lock()


def anotar(texto, tipo="info"):
    bitacora_web.append({"t": time.time(), "txt": texto, "tipo": tipo})


def api(metodo, params):
    pedido = urllib.request.Request(
        ZABBIX_URL, data=json.dumps({"jsonrpc": "2.0", "method": metodo, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {ZABBIX_API_TOKEN}"})
    ctx = ssl._create_unverified_context() if ZABBIX_URL.lower().startswith("https") else None
    with urllib.request.urlopen(pedido, context=ctx, timeout=8) as r:
        datos = json.load(r)
    if "error" in datos:
        raise RuntimeError(datos["error"].get("data"))
    return datos["result"]


def sondear_zabbix():
    """Trae los problemas de la demo (con los tags que pone el CEP) y los KPI que Zabbix calcula desde las trazas."""
    while True:
        try:
            filas = api("problem.get", {
                "output": ["eventid", "name", "severity", "clock", "cause_eventid"], "selectTags": "extend",
                "tags": [{"tag": "demo", "value": "autopista", "operator": 1}], "severities": [2, 3, 4, 5],
                "recent": False, "sortfield": ["eventid"], "sortorder": "DESC", "limit": 40})
            causas = {p["cause_eventid"] for p in filas if p.get("cause_eventid", "0") != "0"}
            problemas = []
            for p in filas:
                t = {x["tag"]: x["value"] for x in p.get("tags", []) if x["tag"] in TAGS_HUD}
                problemas.append({"id": p["eventid"], "nombre": p["name"], "severidad": int(p["severity"]), "desde": int(p["clock"]),
                                  "causa": p["eventid"] in causas, "sintoma": p.get("cause_eventid", "0") != "0",
                                  "de": p.get("cause_eventid", "0"), "tags": t})
            items = api("item.get", {"output": ["key_", "lastvalue", "lastclock"], "host": HOST_RECAUDO, "filter": {"key_": CLAVES_KPI}})
            kpi = {i["key_"]: float(i["lastvalue"]) for i in items if i["lastclock"] != "0"}
            enlace = zabbix["dashboard"]
            if ZABBIX_WEB_URL and not enlace:
                d = api("dashboard.get", {"output": ["dashboardid"], "filter": {"name": ["Autopista · Operación del corredor"]}})
                if d:
                    enlace = f"{ZABBIX_WEB_URL}/zabbix.php?action=dashboard.view&dashboardid={d[0]['dashboardid']}"
            with candado:
                actuales = {p["id"]: p["nombre"] for p in problemas}
                for clave, nombre in actuales.items():
                    if clave not in vistos:
                        anotar(f"Zabbix: {nombre}", "alerta")
                for clave, nombre in vistos.items():
                    if clave not in actuales:
                        anotar(f"Zabbix resolvió: {nombre}", "ok")
                vistos.clear()
                vistos.update(actuales)
                zabbix.update(ok=True, problemas=problemas, kpi=kpi, dashboard=enlace)
        except (OSError, ValueError, KeyError, RuntimeError) as e:
            with candado:
                if zabbix["ok"]:
                    anotar(f"Sin conexión con Zabbix ({type(e).__name__})", "alerta")
                zabbix["ok"] = False
        time.sleep(SONDEO_SEG)


if ZABBIX_URL and ZABBIX_API_TOKEN:
    threading.Thread(target=sondear_zabbix, daemon=True).start()


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/api/estado")
def api_estado():
    try:
        mundo = json.loads(estado.MUNDO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(503, "El simulador todavía no arrancó")
    with candado:
        z = {"ok": zabbix["ok"], "problemas": list(zabbix["problemas"]), "kpi": dict(zabbix["kpi"]), "dashboard": zabbix["dashboard"]}
        propia = list(bitacora_web)
    kpi = mundo["kpi"]
    # con Zabbix conectado, el recaudo y el APM del HUD son los que Zabbix calcula desde las trazas
    if "arm.kpi[recaudo_hoy]" in z["kpi"]:
        kpi["recaudo_hoy"] = int(z["kpi"]["arm.kpi[recaudo_hoy]"])
        kpi["transacciones_hoy"] = int(z["kpi"].get("arm.kpi[transacciones_hoy]", kpi["transacciones_hoy"]))
        kpi["tag_pct"] = round(z["kpi"].get("arm.kpi[tag_pct_hoy]", kpi["tag_pct"]), 1)
        kpi["fuente_recaudo"] = "zabbix"
    if "arm.apm.gateway.p95" in z["kpi"]:
        kpi["latencia_ms"] = round(z["kpi"]["arm.apm.gateway.p95"] * 1000)
        kpi["errores_pct"] = round(z["kpi"].get("arm.apm.gateway.error_pct", 0), 1)
    ensayo = [{**p, "sintoma": not p["causa"], "tags": {}} for p in mundo.get("problemas_ensayo", [])] if ENSAYO else []
    problemas = z["problemas"] if z["ok"] else ensayo
    mundo.pop("problemas_ensayo", None)
    mundo["bitacora"] = sorted(mundo.get("bitacora", []) + propia, key=lambda e: e["t"])[-40:]
    cuerpo = {**mundo, "problemas": problemas, "zabbix_ok": z["ok"], "ensayo": ENSAYO and not z["ok"], "controles": CONTROLES,
              "dashboard": z["dashboard"], "catalogo": estado.CATALOGO, "velocidades": estado.VELOCIDADES}
    return Response(json.dumps(cuerpo, ensure_ascii=False, separators=(",", ":")), media_type="application/json")


def llamar_control(ruta):
    if not CONTROLES:
        raise HTTPException(403, "Controles deshabilitados")
    try:
        r = httpx.post(f"{CONTROL}{ruta}", headers={"Authorization": f"Bearer {CONTROL_TOKEN}"}, timeout=8)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Control no disponible: {type(e).__name__}")
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.json().get("mensaje", "Error del control"))
    return r.json()


@app.post("/api/escenario/{nombre}")
def api_escenario(nombre: str):
    return llamar_control(f"/escenario/{nombre}")


@app.post("/api/escenario/{nombre}/apagar")
def api_apagar(nombre: str):
    return llamar_control(f"/escenario/{nombre}/apagar")


@app.post("/api/reset")
def api_reset():
    return llamar_control("/reset")


@app.post("/api/velocidad/{valor}")
def api_velocidad(valor: str):
    return llamar_control(f"/velocidad/{valor}")


app.mount("/static", StaticFiles(directory=AQUI / "static"), name="static")


@app.get("/")
def inicio():
    return FileResponse(AQUI / "static" / "index.html")
