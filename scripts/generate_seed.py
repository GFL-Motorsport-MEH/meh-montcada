"""
Genera app/supabase/seed/seed.sql a partir de los datos extraidos del
Excel (extract/taxonomia.json, extract/gastos.csv, extract/ingresos.csv,
extract/facturacion.csv).

Usa INSERTs con subconsultas (select id from ... where nombre = ...) en
vez de generar UUIDs en Python, para que el seed funcione igual aunque
Supabase genere los UUIDs con otros valores.
"""
import json
import csv
import unicodedata
import datetime

def norm(s):
    if s is None:
        return ""
    s = str(s).strip()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()

def esc(s):
    if s is None or s == "":
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def esc_num(s):
    if s is None or str(s).strip() == "":
        return "NULL"
    try:
        return str(float(s))
    except ValueError:
        return "NULL"

def esc_bool(s):
    if s is None:
        return "false"
    sv = str(s).strip().upper()
    return "true" if sv in ("TRUE", "1", "VERDADERO", "X") else "false"

def esc_date(s):
    if s is None or str(s).strip() == "":
        return "NULL"
    # viene en isoformat desde los scripts de extraccion, puede llevar hora
    ss = str(s).strip()
    try:
        d = datetime.datetime.fromisoformat(ss)
        return "'" + d.date().isoformat() + "'"
    except ValueError:
        return "NULL"

with open("extract/taxonomia.json", encoding="utf-8") as f:
    tax = json.load(f)

CURSOS = ["2023.24", "2024.25", "2025.26", "2026.27", "2027.28", "2028.29"]

def curso_fechas(nombre):
    y1 = int("20" + nombre.split(".")[0][-2:]) if len(nombre.split(".")[0]) == 2 else int(nombre.split(".")[0])
    y1 = int(nombre[:4])
    y2 = y1 + 1
    return f"{y1}-09-01", f"{y2}-08-31"

out = []
out.append("-- Seed generado automaticamente desde el Excel. No editar a mano;")
out.append("-- regenerar con generate_seed.py si cambian los datos de origen.")
out.append("begin;")

# --- cursos ---
out.append("\n-- Cursos")
for c in CURSOS:
    fi, ff = curso_fechas(c)
    activo = "true" if c in ("2025.26",) else "false" if c > "2025.26" else "true"
    out.append(
        f"insert into public.cursos (nombre, fecha_inicio, fecha_fin, activo) values "
        f"({esc(c)}, '{fi}', '{ff}', {activo}) on conflict (nombre) do nothing;"
    )

# --- categorias / subcategorias ---
out.append("\n-- Categorias y Subcategorias")
for i, cat in enumerate(tax["categorias"]):
    out.append(
        f"insert into public.categorias (nombre, orden) values ({esc(cat)}, {i}) "
        f"on conflict (nombre) do nothing;"
    )
for i, cat in enumerate(tax["categorias"]):
    for j, sub in enumerate(tax["estructura"][cat]):
        out.append(
            f"insert into public.subcategorias (categoria_id, nombre, orden) "
            f"select id, {esc(sub)}, {j} from public.categorias where nombre = {esc(cat)} "
            f"on conflict (categoria_id, nombre) do nothing;"
        )

# --- lookup maps for matching gastos categoria/subcategoria (normalized) ---
cat_norm_to_real = {norm(c): c for c in tax["categorias"]}
sub_norm_to_real = {}  # (cat_real, norm(sub)) -> sub_real
for cat in tax["categorias"]:
    for sub in tax["estructura"][cat]:
        sub_norm_to_real[(cat, norm(sub))] = sub

# --- gastos ---
out.append("\n-- Gastos")
unmatched_cat = 0
unmatched_sub = 0
total_gastos = 0
with open("extract/gastos.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        total_gastos += 1
        curso = row["curso"]
        cat_txt = (row["categoria"] or "").strip()
        sub_txt = (row["subcategoria"] or "").strip()
        cat_real = cat_norm_to_real.get(norm(cat_txt))
        sub_real = sub_norm_to_real.get((cat_real, norm(sub_txt))) if cat_real else None
        if cat_real is None:
            unmatched_cat += 1
        elif sub_real is None and sub_txt:
            unmatched_sub += 1

        cat_id_expr = (
            f"(select id from public.categorias where nombre = {esc(cat_real)})"
            if cat_real else "NULL"
        )
        sub_id_expr = (
            f"(select id from public.subcategorias where nombre = {esc(sub_real)} and "
            f"categoria_id = (select id from public.categorias where nombre = {esc(cat_real)}))"
            if sub_real else "NULL"
        )

        cols = [
            "curso_id", "tipo", "empresa", "factura_nr", "fecha_factura", "pago",
            "concepto", "fecha_pago", "cantidad", "link_factura", "categoria_id",
            "subcategoria_id", "categoria_texto", "subcategoria_texto",
            "periodicidad", "metodo_pago", "comentarios", "nif", "iban", "swift",
            "check_banca", "fiscontal", "sin_factura",
        ]
        vals = [
            f"(select id from public.cursos where nombre = {esc(curso)})",
            esc(row["tipo"]), esc(row["empresa"]), esc(row["factura_nr"]),
            esc_date(row["fecha_factura"]), esc(row["pago"]), esc(row["concepto"]),
            esc_date(row["fecha_pago"]), esc_num(row["cantidad"]), esc(row["link_factura"]),
            cat_id_expr, sub_id_expr, esc(cat_txt), esc(sub_txt),
            esc(row["periodicidad"]), esc(row["metodo_pago"]), esc(row["comentarios"]),
            esc(row["nif"]), esc(row["iban"]), esc(row["swift"]),
            esc_bool(row["check_banca"]), esc(row["fiscontal"]), esc_bool(row["sin_factura"]),
        ]
        out.append(f"insert into public.gastos ({', '.join(cols)}) values ({', '.join(vals)});")

print(f"Gastos: {total_gastos} filas, {unmatched_cat} sin categoria reconocida, "
      f"{unmatched_sub} sin subcategoria reconocida (quedan con categoria_texto/"
      f"subcategoria_texto rellenos para revisar).")

# --- ingresos ---
out.append("\n-- Ingresos (IngresosBase)")
total_ing = 0
with open("extract/ingresos.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        total_ing += 1
        cols = ["curso_id", "trimestre", "mes", "grupo", "level", "tipo", "cantidad"]
        vals = [
            f"(select id from public.cursos where nombre = {esc(row['curso'])})",
            esc(row["trimestre"]), esc(row["mes"]), esc(row["grupo"]),
            esc(row["level"]), esc(row["tipo"]), esc_num(row["cantidad"]),
        ]
        out.append(f"insert into public.ingresos ({', '.join(cols)}) values ({', '.join(vals)});")
print(f"Ingresos: {total_ing} filas")

# --- facturacion ---
out.append("\n-- Facturacion (Fact Meharic / Table1)")
total_fact = 0
with open("extract/facturacion.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        total_fact += 1
        cols = ["centro", "alumno", "id_crm", "fecha_pago", "tipo_operacion",
                "fecha_operacion", "num_factura", "num_recibo", "metodo_pago",
                "modalidad_pago", "descripcion", "qty", "cantidad", "iva",
                "importe", "total", "fecha_inicio", "fecha_fin",
                "mimag_comprobacion", "fiscontal_comprobacion"]
        vals = [
            esc(row["centro"]), esc(row["alumno"]), esc(row["id_crm"]),
            esc_date(row["fecha_pago"]), esc(row["tipo_operacion"]),
            esc_date(row["fecha_operacion"]), esc(row["num_factura"]),
            esc(row["num_recibo"]), esc(row["metodo_pago"]), esc(row["modalidad_pago"]),
            esc(row["descripcion"]), esc_num(row["qty"]), esc_num(row["cantidad"]),
            esc_num(row["iva"]), esc_num(row["importe"]), esc_num(row["total"]),
            esc_date(row["fecha_inicio"]), esc_date(row["fecha_fin"]),
            esc(row["mimag_comprobacion"]), esc(row["fiscontal_comprobacion"]),
        ]
        out.append(
            f"insert into public.facturacion ({', '.join(cols)}) values ({', '.join(vals)}) "
            f"on conflict (clave_linea) do nothing;"
        )
print(f"Facturacion: {total_fact} filas")

out.append("\ncommit;")

with open("app/supabase/seed/seed.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print("Guardado app/supabase/seed/seed.sql (", len(out), "lineas )")
