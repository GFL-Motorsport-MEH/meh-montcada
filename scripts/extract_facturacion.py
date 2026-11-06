"""
Extrae Table1 de "Fact Meharic" (filas de facturacion real del CRM) a
extract/facturacion.csv. Cabecera real en fila 16, datos desde fila 17.
"""
import openpyxl
import csv
import datetime

wb = openpyxl.load_workbook("source.xlsm", data_only=True, read_only=True)
ws = wb["Fact Meharic"]

COLS = ["centro", "alumno", "id_crm", "fecha_pago", "tipo_operacion",
        "fecha_operacion", "num_factura", "num_recibo", "metodo_pago",
        "modalidad_pago", "descripcion", "qty", "cantidad", "iva", "importe",
        "total", "fecha_inicio", "fecha_fin", "mimag_comprobacion",
        "fiscontal_comprobacion"]


def to_iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    return v


rows_out = []
n = 0
for row in ws.iter_rows(min_row=17, max_col=20, values_only=True):
    if row[0] is None and row[6] is None and row[7] is None:
        continue
    rec = {}
    for i, colname in enumerate(COLS):
        rec[colname] = to_iso(row[i])
    rows_out.append(rec)
    n += 1

print("Total filas Fact Meharic:", n)

with open("extract/facturacion.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=COLS)
    writer.writeheader()
    for r in rows_out:
        writer.writerow(r)

print("Guardado extract/facturacion.csv")
