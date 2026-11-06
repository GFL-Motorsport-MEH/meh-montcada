"""
Extrae IngresosBase (Tabla5: Curso, Trimestre, Mes, Grupo, Level, Tipo,
Cantidad) a extract/ingresos.csv.
"""
import openpyxl
import csv

wb = openpyxl.load_workbook("source.xlsm", data_only=True, read_only=True)
ws = wb["IngresosBase"]

COLS = ["curso", "trimestre", "mes", "grupo", "level", "tipo", "cantidad"]

rows_out = []
for row in ws.iter_rows(min_row=4, max_col=7, values_only=True):
    if row[0] is None or str(row[0]).strip() == "":
        continue
    rec = dict(zip(COLS, row))
    rows_out.append(rec)

print("Total filas IngresosBase:", len(rows_out))

with open("extract/ingresos.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=COLS)
    writer.writeheader()
    for r in rows_out:
        writer.writerow(r)

print("Guardado extract/ingresos.csv")
