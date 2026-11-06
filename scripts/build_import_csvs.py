"""
Genera CSVs listos para "Import data from CSV" del dashboard de Supabase,
con las mismas transformaciones que generate_seed.py pero con los UUIDs
de cursos/categorias/subcategorias ya resueltos (extract/lookup_ids.json,
leidos de la base de datos real).

Salida: import/gastos_import.csv, import/ingresos_import.csv,
        import/facturacion_import.csv  + import/resumen.json (totales para
        verificar despues de importar).
"""
import csv, json, os, unicodedata, datetime
from decimal import Decimal, ROUND_HALF_UP

def norm(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFKD", str(s).strip())
    return "".join(c for c in s if not unicodedata.combining(c)).lower()

def txt(s):
    # igual que esc(): vacio -> NULL (celda vacia en el CSV)
    if s is None or s == "":
        return ""
    return str(s)

def num(s):
    if s is None or str(s).strip() == "":
        return ""
    try:
        d = Decimal(str(float(s))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except ValueError:
        return ""
    return str(d)

def boolean(s):
    if s is None:
        return "false"
    return "true" if str(s).strip().upper() in ("TRUE", "1", "VERDADERO", "X") else "false"

EXCEL_EPOCH = datetime.date(1899, 12, 30)

def date(s):
    if s is None or str(s).strip() == "":
        return ""
    ss = str(s).strip()
    try:
        return datetime.datetime.fromisoformat(ss).date().isoformat()
    except ValueError:
        pass
    # numero de serie de Excel (p.ej. 46201 -> 2026-06-28)
    try:
        f = float(ss)
        if 20000 < f < 80000:
            return (EXCEL_EPOCH + datetime.timedelta(days=int(f))).isoformat()
    except ValueError:
        pass
    return ""

os.makedirs("import", exist_ok=True)
with open("extract/taxonomia.json", encoding="utf-8") as f:
    tax = json.load(f)
with open("extract/lookup_ids.json", encoding="utf-8") as f:
    ids = json.load(f)

cat_norm_to_real = {norm(c): c for c in tax["categorias"]}
sub_norm_to_real = {(c, norm(s)): s for c in tax["categorias"] for s in tax["estructura"][c]}
resumen = {}

# ---------------- gastos ----------------
cols = ["curso_id", "tipo", "empresa", "factura_nr", "fecha_factura", "pago",
        "concepto", "fecha_pago", "cantidad", "link_factura", "categoria_id",
        "subcategoria_id", "categoria_texto", "subcategoria_texto",
        "periodicidad", "metodo_pago", "comentarios", "nif", "iban", "swift",
        "check_banca", "fiscontal", "sin_factura"]
n = 0; total = Decimal("0"); cantidad_vacia = 0; por_curso = {}
with open("extract/gastos.csv", encoding="utf-8") as fi, \
     open("import/gastos_import.csv", "w", encoding="utf-8", newline="") as fo:
    w = csv.writer(fo); w.writerow(cols)
    for row in csv.DictReader(fi):
        cat_txt = (row["categoria"] or "").strip()
        sub_txt = (row["subcategoria"] or "").strip()
        cat_real = cat_norm_to_real.get(norm(cat_txt))
        sub_real = sub_norm_to_real.get((cat_real, norm(sub_txt))) if cat_real else None
        cant = num(row["cantidad"])
        if cant == "":
            cantidad_vacia += 1
            cant = "0.00"   # columna NOT NULL default 0
        w.writerow([
            ids["cursos"][row["curso"]],
            txt(row["tipo"]), txt(row["empresa"]), txt(row["factura_nr"]),
            date(row["fecha_factura"]), txt(row["pago"]), txt(row["concepto"]),
            date(row["fecha_pago"]), cant, txt(row["link_factura"]),
            ids["categorias"][cat_real] if cat_real else "",
            ids["subcategorias"][f"{cat_real}|{sub_real}"] if sub_real else "",
            txt(cat_txt), txt(sub_txt), txt(row["periodicidad"]),
            txt(row["metodo_pago"]), txt(row["comentarios"]), txt(row["nif"]),
            txt(row["iban"]), txt(row["swift"]), boolean(row["check_banca"]),
            txt(row["fiscontal"]), boolean(row["sin_factura"]),
        ])
        n += 1; total += Decimal(cant)
        por_curso[row["curso"]] = str(Decimal(por_curso.get(row["curso"], "0")) + Decimal(cant))
resumen["gastos"] = {"filas": n, "suma_cantidad": str(total),
                     "cantidad_vacia_puesta_a_0": cantidad_vacia, "por_curso": por_curso}

# ---------------- ingresos ----------------
cols = ["curso_id", "trimestre", "mes", "grupo", "level", "tipo", "cantidad"]
n = 0; total = Decimal("0"); cantidad_vacia = 0; por_curso = {}
with open("extract/ingresos.csv", encoding="utf-8") as fi, \
     open("import/ingresos_import.csv", "w", encoding="utf-8", newline="") as fo:
    w = csv.writer(fo); w.writerow(cols)
    for row in csv.DictReader(fi):
        cant = num(row["cantidad"])
        if cant == "":
            cantidad_vacia += 1
            cant = "0.00"
        w.writerow([ids["cursos"][row["curso"]], txt(row["trimestre"]), txt(row["mes"]),
                    txt(row["grupo"]), txt(row["level"]), txt(row["tipo"]), cant])
        n += 1; total += Decimal(cant)
        por_curso[row["curso"]] = str(Decimal(por_curso.get(row["curso"], "0")) + Decimal(cant))
resumen["ingresos"] = {"filas": n, "suma_cantidad": str(total),
                       "cantidad_vacia_puesta_a_0": cantidad_vacia, "por_curso": por_curso}

# ---------------- facturacion ----------------
cols = ["centro", "alumno", "id_crm", "fecha_pago", "tipo_operacion",
        "fecha_operacion", "num_factura", "num_recibo", "metodo_pago",
        "modalidad_pago", "descripcion", "qty", "cantidad", "iva", "importe",
        "total", "fecha_inicio", "fecha_fin", "mimag_comprobacion",
        "fiscontal_comprobacion"]
n = 0; dup = 0; total = Decimal("0"); vistos = set(); duplicados = []
with open("extract/facturacion.csv", encoding="utf-8") as fi, \
     open("import/facturacion_import.csv", "w", encoding="utf-8", newline="") as fo:
    w = csv.writer(fo); w.writerow(cols)
    for row in csv.DictReader(fi):
        vals = [txt(row["centro"]), txt(row["alumno"]), txt(row["id_crm"]),
                date(row["fecha_pago"]), txt(row["tipo_operacion"]),
                date(row["fecha_operacion"]), txt(row["num_factura"]),
                txt(row["num_recibo"]), txt(row["metodo_pago"]),
                txt(row["modalidad_pago"]), txt(row["descripcion"]),
                num(row["qty"]), num(row["cantidad"]), num(row["iva"]),
                num(row["importe"]), num(row["total"]),
                date(row["fecha_inicio"]), date(row["fecha_fin"]),
                txt(row["mimag_comprobacion"]), txt(row["fiscontal_comprobacion"])]
        # misma expresion que la columna generada clave_linea
        clave = "|".join([vals[2], vals[7], vals[6], vals[10], vals[14]])
        if clave in vistos:
            dup += 1
            duplicados.append(clave)
            continue   # equivale a "on conflict (clave_linea) do nothing"
        vistos.add(clave)
        w.writerow(vals)
        n += 1
        if vals[14]:
            total += Decimal(vals[14])
resumen["facturacion"] = {"filas": n, "duplicados_descartados": dup,
                          "suma_importe": str(total), "ejemplos_duplicados": duplicados[:10]}

with open("import/resumen.json", "w", encoding="utf-8") as f:
    json.dump(resumen, f, ensure_ascii=False, indent=2)
print(json.dumps(resumen, ensure_ascii=False, indent=2))
