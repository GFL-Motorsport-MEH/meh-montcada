"""
Extrae de las hojas "20xx.xx Ing" el resumen que no esta en IngresosBase:
  - cobros por modalidad de pago y mes (DOMICILIACION, TRANSFERENCIA, TPV / TARJETA, EFECTIVO, VARIOS)
  - numero de alumnos por grupo y mes
  - celdas de la cuadricula donde Pagado != Total
Uso: python3 extract_ingresos_resumen.py <libro.xlsm> <salida.json>
"""
import sys, json, openpyxl

MESES = ["Septiembre", "Octubre", "Noviembre", "Diciembre", "Enero", "Febrero",
         "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto"]
METODOS = ["DOMICILIACION", "TRANSFERENCIA", "TPV / TARJETA", "EFECTIVO", "VARIOS"]


def num(v):
    return round(float(v), 2) if isinstance(v, (int, float)) else 0.0


def main(src, dst):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    out = {"metodos": [], "alumnos": [], "pagado_distinto": []}
    for curso in ["2023.24", "2024.25", "2025.26"]:
        ws = wb[curso + " Ing"]
        g = [list(r) for r in ws.iter_rows(min_row=1, max_row=70, max_col=42, values_only=True)]
        cell = lambda r, c: g[r - 1][c - 1] if c - 1 < len(g[r - 1]) else None
        if curso == "2023.24":
            colmes = [6 + 2 * k for k in range(12)]
            for k, c in enumerate(colmes):
                for i, m in enumerate(METODOS):
                    out["metodos"].append([curso, MESES[k], m, num(cell(9 + i, c))])
                for i, gr in enumerate(["Babies", "Kids", "Teens", "Adultos", "1 to 1"]):
                    out["alumnos"].append([curso, MESES[k], gr, int(num(cell(9 + i, c + 1)))])
            fila0, fila1 = 17, 42
            pares = [(4, 5)] + [(c, c + 1) for c in colmes]
        else:
            colmes = [7 + 3 * k for k in range(12)]
            for k, c in enumerate(colmes):
                for i, m in enumerate(METODOS):
                    out["metodos"].append([curso, MESES[k], m, num(cell(59 + i, c))])
                for i, gr in enumerate(["Babies", "Kids", "Teens", "Adultos", "1 to 1", "Empresas"]):
                    out["alumnos"].append([curso, MESES[k], gr, int(num(cell(45 + i, c)))])
            fila0, fila1 = 12, 39
            pares = [(4, 5)] + [(c, c + 1) for c in colmes]
        for r in range(fila0, fila1 + 1):
            if not cell(r, 1):
                continue
            for k, (cp, ct) in enumerate(pares):
                p, t = num(cell(r, cp)), num(cell(r, ct))
                if abs(p - t) > 0.005:
                    out["pagado_distinto"].append([curso, cell(r, 1), cell(r, 2), "WP" if k == 0 else MESES[k - 1], p, t])
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    for curso in ["2023.24", "2024.25", "2025.26"]:
        tm = sum(x[3] for x in out["metodos"] if x[0] == curso)
        print(curso, "metodos", round(tm, 2), {m: round(sum(x[3] for x in out["metodos"] if x[0] == curso and x[2] == m), 2) for m in METODOS})
    print("pagado distinto:", out["pagado_distinto"][:20], len(out["pagado_distinto"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
