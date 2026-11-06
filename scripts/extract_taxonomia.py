"""
Taxonomia real de categorias/subcategorias de Gastos, tal como esta
documentada y validada en el proyecto (fuente: ListasNuevas!$AT$1:$AT$74,
74 entradas = 9 categorias + 65 subcategorias). Se usa la version ya
documentada en vez de re-parsear la columna AT porque una subcategoria de
INVERSION se llama literalmente "Local", igual que la categoria LOCAL, lo
que rompe un parseo automatico por nombre -- la lista de abajo es la que
ya se usa en las formulas reales de Balance Subcat / Balance Anual.
"""
import json

ESTRUCTURA = {
    "BANCO": ["Comisiones", "Polizas credito", "Otros BANCO"],
    "MATERIAL": ["Decoracion", "Limpieza", "Oficina", "Organizacion academia",
                 "Profesoras", "Talleres", "Talleres extra", "Otros MAT"],
    "LOCAL": ["Agua", "Alarma", "Alquiler", "Basura", "Contraincendios",
              "Internet", "Limpieza", "Luz", "Mantenimiento", "Otros LOCAL"],
    "GESTORIA": ["Cuota Autonomo", "Cuota gestoria", "Formaciones",
                 "Impuesto Sociedades", "IRPF Facturas", "Licencias", "Notaria",
                 "Prevencion de riesgos", "Proteccion datos", "Otras gestiones",
                 "Otros GEST"],
    "TRABAJADORES": ["Busqueda trabajadores", "IRPF Trabajadores", "Nominas",
                      "Seguridad Social", "Otros TRAB"],
    "INVERSION": ["Canon entrada", "Cuota prestamo", "Decoracion",
                  "Imagen de marca", "Local", "Mobiliario y material",
                  "Moviles/Ordenadores", "Obra", "Permisos", "Otros INV"],
    "FRANQUICIA": ["Cursos", "Exams", "Mantenimiento web", "Marketing fijo",
                   "Marketing variable", "Merchandising", "Royalty", "Software",
                   "OTROS FRANQ"],
    "SEGUROS": ["Seguro Accidentes", "Seguro Local", "Seguro Resp Civil"],
    "WELCOME PACK": ["Adults", "ALL", "Babies", "Business", "Kids", "Teens"],
}

categorias = list(ESTRUCTURA.keys())
total_sub = sum(len(v) for v in ESTRUCTURA.values())
print("categorias:", len(categorias), "subcategorias:", total_sub, "total:", len(categorias) + total_sub)
assert len(categorias) == 9
assert total_sub == 65

with open("extract/taxonomia.json", "w", encoding="utf-8") as f:
    json.dump({"categorias": categorias, "estructura": ESTRUCTURA}, f, ensure_ascii=False, indent=2)

print("Guardado extract/taxonomia.json")
