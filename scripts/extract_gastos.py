"""
Extrae las filas de Gastos reales de las 3 hojas de curso (2023.24,
2024.25, 2025.26) a extract/gastos.csv, listo para cargar en la tabla
`gastos` de la base de datos nueva.

Cabecera real (fila 3, A:U):
Tipo, Empresa, Factura nr, Fecha factura, Pago, Concepto, Fecha pago,
Cantidad, Link a factura, Mes, Cat, Sub Cat, Periodicidad, Metodo pago,
Comentarios, NIF, IBAN, SWIFT, Check banca, FISCONTAL, Sin Factura
"""
import openpyxl
import csv
import datetime

wb = openpyxl.load_workbook("source.xlsm", data_only=True, read_only=True)

CURSOS = ["2023.24", "2024.25", "2025.26"]

COLS = ["tipo", "empresa", "factura_nr", "fecha_factura", "pago", "concepto",
        "fecha_pago", "cantidad", "link_factura", "mes", "categoria",
        "subcategoria", "periodicidad", "metodo_pago", "comentarios", "nif",
        "iban", "swift", "check_banca", "fiscontal", "sin_factura"]


def to_iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    return v


rows_out = []
for curso in CURSOS:
    ws = wb[curso]
    n = 0
    for row in ws.iter_rows(min_row=4, max_col=21, values_only=True):
        cat = row[10]  # K = Cat (0-indexed col 10)
        if cat is None or str(cat).strip() == "":
            continue
        rec = {"curso": curso}
        for i, colname in enumerate(COLS):
            v = row[i]
            rec[colname] = to_iso(v)
        rows_out.append(rec)
        n += 1
    print(curso, "->", n, "filas")

fieldnames = ["curso"] + COLS
with open("extract/gastos.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for r in rows_out:
        writer.writerow(r)

print("Total filas:", len(rows_out))
print("Guardado extract/gastos.csv")
