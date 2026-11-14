# Plaza Zabbix: un centro comercial en hora pico

Un centro comercial en pixel art y en corte lateral: la azotea con los chillers del aire acondicionado, tres niveles de locales unidos por cuatro escaleras mecánicas, las puertas automáticas de la entrada y, en el sótano, el estacionamiento con su barrera, el generador, la UPS y la red de seguridad. Cuatro fallas distintas pueden ocurrir a la vez y CEP de Zabbix 8.0 separa cada una en su propio incidente, con su causa y sus síntomas, aunque crucen energía, clima, transporte vertical, seguridad, negocio y servicios instrumentados con APM.

Todo es simulado y ficticio: Plaza Zabbix no existe y no hay sensores ni equipos reales. Las salidas del estacionamiento y las ventas de tarjetas de regalo sí generan trazas OpenTelemetry reales.

Un solo contenedor corre la escena, cuatro servicios instrumentados, el generador de carga, el simulador, el control y el provisioning. Para desplegarla, sigue `docs/DESPLIEGUE-DOKPLOY.md`.

## La escena

| Franja | Qué muestra |
|---|---|
| Azotea | Los dos chillers con sus ventiladores, el letrero del centro comercial, y el estado de los sistemas y del negocio |
| Nivel 2 | Patio de comidas y cine |
| Nivel 1 | Electrónica y deportes |
| Planta baja | Puertas automáticas, supermercado, módulo de atención al cliente y café |
| Atrio | Cuatro escaleras mecánicas con sus pasajeros, y el termostato de cada nivel |
| Sótano | Estacionamiento con la barrera de salida, la cámara de lectura de placas y la fila de autos; sala técnica con el generador, la UPS, el rack de la red de seguridad y la pantalla de problemas de Zabbix, que muestra la causa y los síntomas que marcó CEP |

En cada nivel se ven las rejillas del aire acondicionado y las cámaras de seguridad con su piloto.

Clic en la salida del estacionamiento o en el módulo de atención: una operación real por los servicios, con su resultado en un cartel. Clic en una escalera, los chillers, las puertas, un nivel, el estacionamiento, el generador, la UPS, el rack o la pantalla de Zabbix: un cartel con sus datos.

## Escenarios

| Tecla | Acción | Qué se ve en Zabbix |
|---|---|---|
| 1 | Corte de la red eléctrica | CEP: la red es la causa; UPS, iluminación de emergencia, escaleras y chillers detenidos, puertas en manual y la autonomía del generador son sus síntomas |
| 2 | Chiller 1 disparado por alta presión | CEP: el chiller es la causa; la sobrecarga del chiller 2, el agua helada y la temperatura de los niveles 2 y 1 son sus síntomas |
| 3 | Switch PoE de seguridad sin respuesta | CEP: el switch es la causa; cámaras, grabación, lectura de placas, fila en la salida y errores de APM del estacionamiento son sus síntomas |
| 4 | Motor de la escalera 2 sobrecalentado | CEP: el motor es la causa; la parada por protección térmica y la sobrecarga de la escalera 1 son sus síntomas |
| 0 | Reset | Todo vuelve a la normalidad y se cierran las ventanas CEP |

Los cuatro escenarios se pueden combinar: cada uno queda en su propio incidente.

El apagón es una línea de tiempo fija, con la causa siempre primero:

| Segundo | Evento | Trigger |
|---|---|---|
| 0 | Cae el suministro de la red | Energía: sin suministro de la red externa |
| 8 | La UPS pasa a batería; la iluminación queda en emergencia | UPS: en batería · Iluminación: modo de emergencia |
| 12 | Se detienen las escaleras mecánicas y los chillers | Escaleras mecánicas: detenidas · Aire acondicionado: chillers detenidos |
| 15 | Las puertas automáticas quedan abiertas, en manual | Puertas automáticas: en modo manual |
| 20 | Arranca el generador, con poco combustible | Generador: autonomía menor a 45 min |
| 30 | La UPS vuelve a la línea y las puertas, a automático | Se resuelven solos "UPS: en batería" y "Puertas automáticas: en modo manual" |

Las escaleras y los chillers no son carga esencial: siguen detenidos hasta que vuelve la red. En un corte breve la temperatura sube, pero la inercia del edificio no la lleva al umbral de confort.

Medido en el laboratorio, a velocidad 1:

| Escenario | Incidente | Causa visible en | Último síntoma en | Recuperación tras el reset |
|---|---|---|---|---|
| 1 Apagón | 1 causa y 4 síntomas abiertos (UPS y puertas abren y se resuelven solos al arrancar el generador) | 4 s | 24 s | 5 s |
| 2 Chiller | 1 causa y 4 síntomas | 4 s | 68 s (temperatura del nivel 1) | 20 s |
| 3 Red de seguridad | 1 causa y 6 síntomas | 4 s | 64 s (APM lectura de placas) | 85 s |
| 4 Escalera | 1 causa y 2 síntomas | 4 s | 28 s | 10 s |

Con los cuatro activos a la vez quedan cuatro incidentes separados, sin problemas sueltos, y todo se resuelve en unos 90 s. En esa combinación el apagón también detiene el chiller 2 y la escalera 1, así que no aparecen sus síntomas de sobrecarga. Los problemas de APM por Telemetry query son los últimos en abrir y en cerrar.

## Variables

Las variables comentadas están en `.env.example`. Las obligatorias son `ZABBIX_NETWORK`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `ZABBIX_URL`, `ZABBIX_API_TOKEN` y `CONTROL_TOKEN`.

| Variable | Por defecto | Para qué |
|---|---|---|
| `ZABBIX_NETWORK` | (obligatoria) | Red Docker del stack de Zabbix |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (obligatoria) | Colector APM del proxy de Zabbix, con `http://` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `http/protobuf` solo para un collector OTel |
| `OTEL_SERVICE_NAMESPACE` | `mall` | Un namespace por despliegue: define el host `apm-<namespace>-<entorno>` |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `production` | Entorno de las trazas |
| `ZABBIX_TRAPPER_HOST`, `ZABBIX_TRAPPER_PORT` | `zabbix-server`, `10051` | Destino de los trappers del simulador |
| `ZABBIX_URL`, `ZABBIX_API_TOKEN` | (obligatorias) | API de Zabbix y token de un Super admin |
| `PROVISION` | `1` | `0` para no tocar Zabbix al arrancar |
| `CH_URL`, `CH_USER`, `CH_PASSWORD` | `http://clickhouse:8123/`, `zabbix`, vacío | ClickHouse tal como lo ve el Zabbix server |
| `TRAPPER_ALLOWED` | subredes privadas | Desde qué IPs aceptan datos los ítems trapper (macro global compartida) |
| `DASHBOARDS_PREFIJO` | `Mall` | Dashboards que se listan en `/salida/resumen.json` |
| `CONTROL_TOKEN` | (obligatoria) | Token del servicio de control |
| `MALL_CONTROLES` | `1` | `0` deja la escena solo para mirar |
| `APP_PORT`, `CONTROL_PORT` | `8101`, `8102` | Puertos del host |

El Zabbix server necesita `TelemetryProvider` configurado: sin eso, los ítems Telemetry query no devuelven datos.

## Puertos

| Interno | Host por defecto | Uso | Dominio |
|---|---|---|---|
| 8000 | `APP_PORT` (8101) | Escena pixel art | Sí |
| 8091 | `CONTROL_PORT` (8102) | Control con Bearer token | No |

La escena no pide contraseña y puede provocar fallas. Con `MALL_CONTROLES=0` queda solo para mirar.

## Objetos en Zabbix

- Hosts con prefijo `Mall - `: Energía, Clima, Escaleras, Puertas, Seguridad, Estacionamiento, Negocio y APM discovery.
- `apm-<namespace>-<entorno>` lo crea el discovery cuando llegan trazas (nombre visible `APM <namespace> (<entorno>)`). Nada depende de ese host para arrancar.
- Servicios instrumentados: `estacionamiento`, `lpr` (lectura de placas), `giftcards` (tarjetas de regalo) y `caja`.
- KPI desde las trazas en "Mall KPIs by ClickHouse"; p95 y errores en "Mall APM by Telemetry query".
- Cuatro reglas CEP con prefijo `Mall:`, creadas por `provision/post_provision.py`. Agrupan por los tags `alimentacion`, `clima`, `seguridad` y `transporte`, y cada una tiene su propio evento de reinicio (`mall.cep.reinicio[<tag>]`).
- Dashboards: "Tablero ejecutivo · Mall" y "Mall · Operación e infraestructura" (páginas Clima y energía, Escaleras y puertas, Seguridad y estacionamiento, Servicios y APM). Las vistas de APM asumen `OTEL_SERVICE_NAMESPACE=mall`.

Los eventos llevan `demo=mall` y tags propios, para no entrar en las reglas de otras demos.

## Preguntas por MCP

1. ¿Cuánta gente hay en el centro comercial y cuánto estamos vendiendo por hora?
2. ¿Por qué hace calor en el patio de comidas?
3. ¿Cuánta autonomía le queda al generador?
4. ¿Por qué hay fila en la salida del estacionamiento?
5. ¿La escalera detenida tiene que ver con el apagón?
6. ¿Cuántas cámaras están en línea y se está grabando?

## Verificación

1. En los logs: `Provisioning completo` y `9 procesos en marcha`.
2. Copia `cliente/demo.env.example` a `cliente/demo.env`, complétalo y ejecuta `cliente/demo.sh check`.
3. Aparece `apm-<namespace>-<entorno>` y hay trazas en APM → Traces.
