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

# resumen de las hojas "Ing" (scripts/extract_ingresos_resumen.py), si existe
ingresos_metodo, alumnos_mes = [], []
res_path = src / "extract" / "ingresos_resumen.json"
if res_path.exists():
    R = json.load(open(res_path, encoding="utf-8"))
    cid = {c["nombre"]: c["id"] for c in cursos}
    for i, (cu, mes, met, v) in enumerate(x for x in R["metodos"] if x[3]):
        ingresos_metodo.append({"id": f"met-{i}", "curso_id": cid[cu], "mes": mes, "metodo": met, "importe": v})
    for i, (cu, mes, gr, n) in enumerate(x for x in R["alumnos"] if x[3]):
        alumnos_mes.append({"id": f"alu-{i}", "curso_id": cid[cu], "mes": mes, "grupo": gr, "alumnos": n})

# facturacion (facturacion_import.csv), con la misma clave que la columna generada de la BD
facturacion = []
fpath = src / "facturacion_import.csv"
if fpath.exists():
    with open(fpath, encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f)):
            for c in ("qty", "cantidad", "iva", "importe", "total"):
                r[c] = float(r[c]) if r[c] not in ("", None) else None
            for c in list(r):
                if r[c] == "":
                    r[c] = None
            r["id"] = f"fac-{i}"
            imp = "" if r["importe"] is None else f"{r['importe']:.2f}"
            r["clave_linea"] = "|".join([r["id_crm"] or "", r["num_recibo"] or "", r["num_factura"] or "", r["descripcion"] or "", imp])
            facturacion.append(r)

# empresas: las usadas en los gastos, con el NIF/IBAN mas repetido (como la carga de la migracion 0005)
from collections import Counter
emp = {}
for g in gastos:
    n = (g.get("empresa") or "").strip()
    if not n:
        continue
    e = emp.setdefault(n.lower(), {"nombre": n, "nif": Counter(), "iban": Counter()})
    for c in ("nif", "iban"):
        v = (g.get(c) or "").strip()
        if v and v != "0":
            e[c][v] += 1
empresas = [{"id": f"emp-{i}", "nombre_comercial": e["nombre"], "razon_social": None,
             "cif": e["nif"].most_common(1)[0][0] if e["nif"] else None,
             "iban": e["iban"].most_common(1)[0][0] if e["iban"] else None, "fecha_registro": None}
            for i, e in enumerate(emp.values())]

# listas (metodo_pago, periodicidad, tipo) con los valores usados en los gastos, como la migracion 0006
listas = []
for campo in ("metodo_pago", "periodicidad", "tipo"):
    cnt = Counter((g.get(campo) or "").strip() for g in gastos if (g.get(campo) or "").strip())
    for i, (v, _) in enumerate(cnt.most_common()):
        listas.append({"id": f"lis-{campo}-{i}", "lista": campo, "valor": v, "orden": i + 1})

# centros (migracion 0007): todos los gastos al principal
centros = [{"id": "cen-montcada", "nombre": "MONTCADA", "principal": True, "activo": True, "orden": 0},
           {"id": "cen-alcantarilla", "nombre": "ALCANTARILLA", "principal": False, "activo": True, "orden": 1}]
for g in gastos:
    g["centro_id"] = "cen-montcada"

profiles = [
    {"id": "00000000-0000-0000-0000-00000000aaaa", "nombre": "Admin", "email": "admin@example.com", "rol": "admin", "activo": True, "created_at": "2026-11-05T10:00:00Z"},
    {"id": "00000000-0000-0000-0000-00000000bbbb", "nombre": "Empleado", "email": "empleado@example.com", "rol": "empleado", "activo": False, "created_at": "2026-11-05T11:00:00Z"},
]
json.dump({"cursos": cursos, "categorias": categorias, "subcategorias": subcategorias, "gastos": gastos, "ingresos": ingresos, "profiles": profiles,
           "ingresos_metodo": ingresos_metodo, "alumnos_mes": alumnos_mes, "facturacion": facturacion, "empresas": empresas, "listas": listas, "centros": centros, "plantillas_gasto": []},
          open(TEST / "fixtures.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"gastos {len(gastos)} (excepciones de mes aplicadas: {encontradas}/{len(EXC)}), ingresos {len(ingresos)}, "
      f"cobros por modalidad {len(ingresos_metodo)}, alumnos/mes {len(alumnos_mes)}")
