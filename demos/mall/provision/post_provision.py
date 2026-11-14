#!/usr/bin/env python3
"""Pasos propios de la demo mall, después de importar los YAML: macros de entorno y reglas CEP. Idempotente.

Reglas CEP (no entran por import, se crean o actualizan por nombre). Cada una agrupa los triggers que comparten un tag
y toma el primer evento de la ventana como causa:
  1. Alimentación eléctrica (tag alimentacion): el corte de la red es la causa; UPS, iluminación, escaleras, chillers,
     puertas y la autonomía del generador son sus síntomas.
  2. Aire acondicionado (tag clima): el chiller disparado es la causa; la sobrecarga del otro chiller, el agua helada
     y la temperatura de los niveles son sus síntomas.
  3. Red de seguridad (tag seguridad): el switch PoE es la causa; cámaras, grabación, lectura de placas, fila en la
     salida y errores de APM del estacionamiento son sus síntomas.
  4. Escaleras mecánicas (tag transporte): el motor recalentado es la causa; la parada por protección y la sobrecarga
     de la escalera vecina son sus síntomas.
Cada ventana tiene su propio evento de control recurso=reinicio, que la cierra para que una falla nueva no quede como
síntoma de la anterior. Un solo evento con todos los tags no sirve: solo cierra la ventana de la primera regla que lo recibe.
Solo usa tags propios (demo, alimentacion, clima, seguridad, transporte, recurso): dominio y capa son de las reglas de la planta del laboratorio.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # zabbix_api.py está en /srv
from zabbix_api import crear_api  # noqa: E402

# Constantes de CCepRuleHelper / defines.inc.php (Zabbix 8.0)
WINDOW_CAUSE_SYMPTOM = 2
WHEN_ADDED = 1
OP_CLOSE_WINDOW = 18
COND_TAG, COND_TAG_VALUE = 25, 26
EQUAL = 0
SECRETA = 1

TEMPLATE_KPI = "Mall KPIs by ClickHouse"
TEMPLATE_APM = "Mall APM by Telemetry query"
HOST_DISCOVERY = "Mall - APM discovery"


def cond(tipo, operador, **kw):
    return {"type": tipo, "operator": operador, **kw}


def tag(nombre, valor):
    return cond(COND_TAG_VALUE, EQUAL, tag=nombre, tag_value=valor)


DE_LA_DEMO = tag("demo", "mall")
CERRAR_CON_REINICIO = [{"sortorder": 1, "execute_when": WHEN_ADDED, "type": OP_CLOSE_WINDOW,
                        "filter": {"evaltype": 0, "conditions": [tag("recurso", "reinicio")]}}]


def regla(nombre, orden, etiqueta, descripcion):
    return {
        "name": nombre, "sortorder": orden, "status": 0, "stop": 0, "window_type": WINDOW_CAUSE_SYMPTOM,
        "description": descripcion,
        "filter": {"evaltype": 0, "conditions": [DE_LA_DEMO, cond(COND_TAG, EQUAL, tag=etiqueta)]},
        "window": {"duration": "1h", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0, "group_by_tags": 1,
                   "tags": [etiqueta], "event_count_tag": "eventos_correlacionados"},
        "operations": CERRAR_CON_REINICIO,
    }


REGLAS = [
    regla("Mall: causa y síntomas por alimentación eléctrica", 50, "alimentacion",
          "Lo que depende de la red eléctrica del centro comercial: el primer evento es la causa y los siguientes, sus síntomas."),
    regla("Mall: causa y síntomas en el aire acondicionado", 51, "clima",
          "La cadena del frío: chillers, agua helada y temperatura de los niveles. El chiller es la causa; el resto, sus síntomas."),
    regla("Mall: causa y síntomas en la red de seguridad", 52, "seguridad",
          "Lo que cuelga del switch PoE: cámaras, grabación y lectura de placas del estacionamiento."),
    regla("Mall: causa y síntomas en las escaleras mecánicas", 53, "transporte",
          "Las escaleras mecánicas: el motor recalentado es la causa; la parada y la sobrecarga de la vecina, sus síntomas."),
]


def fijar_macro(api, hostid, macro, valor, secreta=False):
    existentes = {m["macro"]: m for m in api("usermacro.get", {"hostids": [hostid], "output": ["hostmacroid", "macro", "value"]})}
    actual = existentes.get(macro)
    if actual is None:
        parametros = {"hostid": hostid, "macro": macro, "value": valor}
        if secreta:
            parametros["type"] = SECRETA
        api("usermacro.create", parametros)
    elif secreta or actual.get("value") != valor:
        api("usermacro.update", {"hostmacroid": actual["hostmacroid"], "value": valor})


def main():
    api = crear_api(os.environ["ZABBIX_URL"], os.environ["ZABBIX_API_TOKEN"])
    ns = os.environ.get("OTEL_SERVICE_NAMESPACE", "mall")
    ch = (os.environ.get("CH_URL", "http://clickhouse:8123/"), os.environ.get("CH_USER", "zabbix"), os.environ.get("CH_PASSWORD", ""))

    t = {x["host"]: x["templateid"] for x in api("template.get", {"output": ["host"], "filter": {"host": [TEMPLATE_KPI, TEMPLATE_APM]}})}
    h = api("host.get", {"output": ["hostid"], "filter": {"host": [HOST_DISCOVERY]}})
    if len(t) != 2 or not h:
        raise SystemExit("!! Faltan templates o el host de discovery: revisar la importación")
    hid = h[0]["hostid"]
    for objetivo in (t[TEMPLATE_KPI], hid):
        fijar_macro(api, objetivo, "{$CH.URL}", ch[0])
        fijar_macro(api, objetivo, "{$CH.USER}", ch[1])
        fijar_macro(api, objetivo, "{$CH.PASSWORD}", ch[2], secreta=True)
    fijar_macro(api, t[TEMPLATE_KPI], "{$MALL.NS}", ns)
    fijar_macro(api, t[TEMPLATE_APM], "{$MALL.NS}", ns)
    fijar_macro(api, hid, "{$APM.NAMESPACE.MATCHES}", f"^{ns}$")
    print(f"OK macros de ClickHouse y namespace {ns}")

    for r in REGLAS:
        existente = api("ceprule.get", {"output": ["cep_ruleid"], "filter": {"name": [r["name"]]}})
        if existente:
            api("ceprule.update", [{"cep_ruleid": existente[0]["cep_ruleid"], **r}])
            print(f"OK regla '{r['name']}' actualizada")
        else:
            api("ceprule.create", [r])
            print(f"OK regla '{r['name']}' creada")


if __name__ == "__main__":
    main()
