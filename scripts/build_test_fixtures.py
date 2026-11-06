"""
Genera test/fixtures.json (datos para el Supabase simulado de las pruebas) a partir de:
  - los CSV de carga (gastos_import.csv, ingresos_import.csv), ruta en el argumento 1
  - test/maestros.json: cursos, categorias y subcategorias tal como estan en la BD
  - test/excepciones_mes.json: gastos cuyo "mes" no coincide con el mes de la fecha de pago
Ninguno de estos archivos se sube al repo (contienen datos reales).

Uso: python3 scripts/build_test_fixtures.py "<carpeta con los CSV>"
"""
import csv, json, sys, uuid, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = ROOT / "test"
src = pathlib.Path(sys.argv[1])
M = json.load(open(TEST / "maestros.json", encoding="utf-8"))
EXC = json.load(open(TEST / "excepciones_mes.json", encoding="utf-8"))
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

cursos = [{"id": i, "nombre": n, "fecha_inicio": a, "fecha_fin": b, "activo": True} for i, n, a, b in M["cursos"]]
categorias = [{"id": i, "nombre": n, "orden": o} for i, n, o in M["categorias"]]
subcategorias = [{"id": i, "categoria_id": c, "nombre": n, "orden": o} for i, c, n, o in M["subcategorias"]]
sub_cuota = next(s for s in subcategorias if s["nombre"] == "Cuota Autonomo")

exc = {}
for empresa, factura, fpago, cant, concepto, mes in EXC:
    exc[(empresa, factura, fpago, round(float(cant), 2), concepto)] = mes

gastos = []
for i, r in enumerate(csv.DictReader(open(src / "gastos_import.csv", encoding="utf-8"))):
    g = {k: (v if v != "" else None) for k, v in r.items()}
    g["id"] = str(uuid.UUID(int=i + 1))
    g["cantidad"] = float(g["cantidad"])
    g["check_banca"] = g["check_banca"] == "true"
    g["sin_factura"] = g["sin_factura"] == "true"
    fecha = g["fecha_pago"] or g["fecha_factura"]
    clave = (g["empresa"], g["factura_nr"], g["fecha_pago"], round(g["cantidad"], 2), g["concepto"])
    g["mes"] = exc.get(clave) or MESES[int(fecha[5:7]) - 1]
    # correccion hecha en la BD el 05-nov (subcategoria "Autonomo" -> "Cuota Autonomo")
    if g["subcategoria_texto"] == "Autonomo" and not g["subcategoria_id"]:
        g["subcategoria_id"], g["subcategoria_texto"] = sub_cuota["id"], "Cuota Autonomo"
    g["updated_at"] = "2026-11-06T00:00:00Z"
    gastos.append(g)
encontradas = sum(1 for g in gastos if (g["empresa"], g["factura_nr"], g["fecha_pago"], round(g["cantidad"], 2), g["concepto"]) in exc)

ingresos = []
for i, r in enumerate(csv.DictReader(open(src / "ingresos_import.csv", encoding="utf-8"))):
    x = {k: (v if v != "" else None) for k, v in r.items()}
    x["id"] = str(uuid.UUID(int=100000 + i))
    x["cantidad"] = float(x["cantidad"])
    ingresos.append(x)

profiles = [
    {"id": "00000000-0000-0000-0000-00000000aaaa", "nombre": "Admin", "email": "admin@example.com", "rol": "admin", "activo": True, "created_at": "2026-11-05T10:00:00Z"},
    {"id": "00000000-0000-0000-0000-00000000bbbb", "nombre": "Empleado", "email": "empleado@example.com", "rol": "empleado", "activo": False, "created_at": "2026-11-05T11:00:00Z"},
]
json.dump({"cursos": cursos, "categorias": categorias, "subcategorias": subcategorias, "gastos": gastos, "ingresos": ingresos, "profiles": profiles},
          open(TEST / "fixtures.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"gastos {len(gastos)} (excepciones de mes aplicadas: {encontradas}/{len(EXC)}), ingresos {len(ingresos)}")
