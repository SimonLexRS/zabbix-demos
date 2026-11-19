#!/usr/bin/env python3
"""Servicio de control de la demo (solo biblioteca estándar). Toda ruta salvo GET /salud exige Bearer CONTROL_TOKEN.

  POST /escenario/<nombre>   activa un escenario del catálogo
  POST /velocidad/<valor>    0.5, 1, 2 o 4
  POST /reset                todo a la normalidad y cierra las ventanas CEP
  GET  /check                comprobación previa a la demo
"""
import hmac
import json
import os
import ssl
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import estado_demo as estado  # noqa: E402
from zbx_sender import ZabbixSender  # noqa: E402

CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
CONTROL_PORT = int(os.environ.get("CONTROL_PORT_INTERNO") or 8091)
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
TRAPPER_HOST = os.environ.get("ZABBIX_TRAPPER_HOST", "")
TRAPPER_PORT = int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051"))
HOST_NEGOCIO = "Mall - Negocio"
ESPERA_REINICIO = 3
VENTANAS = ("alimentacion", "clima", "seguridad", "transporte")
REGLAS = ["Mall: causa y síntomas por alimentación eléctrica", "Mall: causa y síntomas en el aire acondicionado",
          "Mall: causa y síntomas en la red de seguridad", "Mall: causa y síntomas en las escaleras mecánicas"]
candado = threading.Lock()


def reiniciar_ventanas():
    """Eventos de control, uno por regla: cada uno cierra su ventana CEP para que la próxima falla sea causa y no síntoma
    de la anterior. Un solo evento con todos los tags solo cierra la ventana de la primera regla que lo recibe."""
    if not TRAPPER_HOST:
        return
    sender = ZabbixSender(TRAPPER_HOST, TRAPPER_PORT)
    for valor in (1, 0):
        sender.send_batch([{"host": HOST_NEGOCIO, "key": f"mall.cep.reinicio[{ventana}]", "value": valor} for ventana in VENTANAS])
        time.sleep(ESPERA_REINICIO)


def api(metodo, params):
    pedido = urllib.request.Request(
        ZABBIX_URL, data=json.dumps({"jsonrpc": "2.0", "method": metodo, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {ZABBIX_API_TOKEN}"})
    ctx = ssl._create_unverified_context() if ZABBIX_URL.lower().startswith("https") else None
    with urllib.request.urlopen(pedido, context=ctx, timeout=15) as r:
        datos = json.load(r)
    if "error" in datos:
        raise RuntimeError(f"{metodo}: {datos['error'].get('data')}")
    return datos["result"]


def comprobaciones():
    res = []

    def informe(ok, texto):
        res.append({"ok": bool(ok), "texto": texto})

    mundo = estado.leer(estado.MUNDO, {})
    informe(time.time() - mundo.get("ts", 0) < 10, "simulador al día")
    latencia = estado.leer(estado.LATENCIA, {})
    informe(latencia.get("n", 0) > 0, f"operaciones de clientes ({latencia.get('n', 0)} en 45 s)")
    if not ZABBIX_URL or not ZABBIX_API_TOKEN:
        informe(False, "API de Zabbix sin configurar")
        return res
    try:
        for host, clave, maximo, etiqueta in (
                ("Mall - Energia", "mall.energia.red", 30, "datos de energía"),
                ("Mall - Clima", "mall.clima.agua_helada", 30, "datos de clima"),
                (HOST_NEGOCIO, "mall.kpi.get", 120, "KPI de negocio")):
            i = api("item.get", {"output": ["lastclock"], "host": host, "filter": {"key_": [clave]}})
            edad = time.time() - int(i[0]["lastclock"]) if i and i[0]["lastclock"] != "0" else float("inf")
            informe(edad < maximo, f"{etiqueta} al día (hace {edad:.0f} s)")
        r = api("ceprule.get", {"output": ["name", "status"], "filter": {"name": REGLAS}})
        informe(len(r) == len(REGLAS) and all(x["status"] == "0" for x in r), "reglas CEP activas")
        abiertos = api("problem.get", {"output": ["name"], "tags": [{"tag": "demo", "value": "mall", "operator": 1}], "severities": [2, 3, 4, 5]})
        informe(not abiertos, f"sin problemas abiertos ({len(abiertos)})")
    except (OSError, ValueError, KeyError, IndexError, RuntimeError) as e:
        informe(False, f"API de Zabbix: {type(e).__name__}: {e}")
    return res


class Manejador(BaseHTTPRequestHandler):
    server_version = "ControlMall/1.0"

    def log_message(self, fmt, *args):
        pass

    def _json(self, codigo, cuerpo):
        datos = json.dumps(cuerpo, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)
        print(f"{self.command} {self.path} {codigo}", flush=True)

    def _autorizado(self):
        if not CONTROL_TOKEN:
            self._json(503, {"ok": False, "mensaje": "CONTROL_TOKEN sin configurar"})
            return False
        esquema, _, token = self.headers.get("Authorization", "").partition(" ")
        if esquema.lower() != "bearer" or not hmac.compare_digest(token.strip().encode(), CONTROL_TOKEN.encode()):
            self._json(401, {"ok": False, "mensaje": "No autorizado"})
            return False
        return True

    def do_GET(self):
        if self.path == "/salud":
            return self._json(200, {"ok": True})
        if not self._autorizado():
            return
        if self.path == "/check":
            res = comprobaciones()
            return self._json(200, {"ok": all(c["ok"] for c in res), "comprobaciones": res})
        self._json(404, {"ok": False, "mensaje": "Ruta no encontrada"})

    def do_POST(self):
        if not self._autorizado():
            return
        partes = self.path.strip("/").split("/")
        try:
            with candado:
                if partes == ["reset"]:
                    estado.restablecer()
                    threading.Thread(target=reiniciar_ventanas, daemon=True).start()
                    return self._json(200, {"ok": True, "mensaje": "Reset"})
                if len(partes) == 2 and partes[0] == "escenario":
                    estado.activar(partes[1])
                    return self._json(200, {"ok": True, "mensaje": estado.CATALOGO[partes[1]]})
                if len(partes) == 2 and partes[0] == "velocidad":
                    estado.fijar_velocidad(float(partes[1]))
                    return self._json(200, {"ok": True, "mensaje": f"Velocidad {partes[1]}x"})
        except ValueError as e:
            return self._json(400, {"ok": False, "mensaje": str(e)})
        except OSError as e:
            return self._json(500, {"ok": False, "mensaje": f"{type(e).__name__}: {e}"})
        self._json(404, {"ok": False, "mensaje": "Ruta no encontrada"})


def main():
    # Al arrancar, y otra vez al minuto: en el primer despliegue Zabbix todavía no cargó los ítems recién importados
    threading.Thread(target=reiniciar_ventanas, daemon=True).start()
    repetir = threading.Timer(60, reiniciar_ventanas)
    repetir.daemon = True
    repetir.start()
    servidor = ThreadingHTTPServer(("0.0.0.0", CONTROL_PORT), Manejador)
    servidor.daemon_threads = True
    print(f"Control escuchando en 0.0.0.0:{CONTROL_PORT}", flush=True)
    servidor.serve_forever()


if __name__ == "__main__":
    main()
