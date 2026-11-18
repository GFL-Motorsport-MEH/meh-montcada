"""Roles y permisos: navegación según rol y matriz editable de Usuarios (Supabase simulado).
Uso:  python3 test/test_roles.py
"""
import re, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB, TEST = ROOT / "app", ROOT / "test"
URL = "http://127.0.0.1:8767/"
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "--bind", "127.0.0.1"], cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
ok, errores = 0, []
def check(c, m):
    global ok
    if not c: raise AssertionError(m)
    ok += 1; print("  ok:", m)

def abrir(b, rol, ruta="academia"):
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.add_init_script(f"window.__ROL = '{rol}'")
    page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase-academia.js"), content_type="application/javascript"))
    page.route(re.compile(r"https://cdn\.jsdelivr\.net/npm/xlsx@.*"), lambda r: r.fulfill(path=str(TEST / "mock-xlsx.js"), content_type="application/javascript"))
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
    page.on("pageerror", lambda e: errores.append(str(e)))
    page.goto(URL + "#/" + ruta)
    page.wait_for_timeout(1500)
    return page
def tabs(page): return [t.strip() for t in page.locator(".tabs .tab").all_inner_texts()]

try:
    with sync_playwright() as p:
        try: b = p.chromium.launch()
        except Exception: b = p.chromium.launch(executable_path="/usr/bin/google-chrome")

        print("1. profesora: solo sus pestañas")
        pg = abrir(b, "profesora", "ac_pagos")
        t = tabs(pg); print("  ", t)
        for quiere in ["Grupos", "Calendario", "Tutorías", "Seguimiento", "Biblioteca"]:
            check(any(quiere in x for x in t), f"profesora ve {quiere}")
        for no in ["Pagos", "Remesas", "Alumnos", "Bajas", "Recogidas", "Tareas"]:
            check(not any(x.startswith(no) for x in t), f"profesora NO ve {no}")
        check(pg.locator(".modulos button, .modulos a").count() <= 1, "sin selector de módulo (solo Academia)")
        pg.close()

        print("2. coordinación: academia sin pagos ni remesas")
        pg = abrir(b, "coordinacion")
        t = tabs(pg); print("  ", t)
        check(any("Alumnos" in x for x in t) and any("Bajas" in x for x in t), "coordinación ve Alumnos y Bajas")
        check(not any(x.startswith("Pagos") or x.startswith("Remesas") for x in t), "coordinación NO ve Pagos ni Remesas")
        pg.close()

        print("3. dirección: academia con pagos y remesas")
        pg = abrir(b, "direccion", "ac_pagos")
        t = tabs(pg)
        check(any(x.startswith("Pagos") for x in t) and any(x.startswith("Remesas") for x in t) and any("Escáner" in x for x in t), "dirección ve Pagos, Remesas y Escáner")
        check(not any(x.startswith("Balance") or x.startswith("Gastos") for x in t), "dirección NO ve Balance ni Gastos")
        pg.close()

        print("4. administrador: matriz editable")
        pg = abrir(b, "admin", "usuarios")
        expect(pg.get_by_role("heading", name="Usuarios y permisos")).to_be_visible(timeout=8000)
        pg.get_by_role("button", name="Permisos de los roles").click()
        expect(pg.locator("table.matriz-roles")).to_be_visible(timeout=5000)
        check(pg.locator("table.matriz-roles th.rol-col").count() == 5, "5 columnas: admin + 4 roles")
        sel = pg.get_by_label("Pagos (cuotas, DNI e IBAN de las familias) · Coordinación")
        check(sel.input_value() == "", "coordinación sin acceso a Pagos")
        sel.select_option("todo:0")
        check(pg.get_by_role("button", name="Guardar cambios (1)").is_enabled(), "cambio pendiente de guardar")
        pg.get_by_role("button", name="Guardar cambios (1)").click()
        pg.get_by_role("button", name="Guardar", exact=True).click()
        pg.wait_for_timeout(500)
        fila = [f for f in pg.evaluate("window.__mock.db.rol_permisos") if f["rol"] == "coordinacion" and f["permiso"] == "ac_pagos"]
        check(len(fila) == 1 and fila[0]["alcance"] == "todo" and fila[0]["editar"] is False, "permiso guardado en rol_permisos")
        pg.close()
        check(not errores, f"sin errores de página: {errores[:2]}")
finally:
    srv.terminate()
print(f"\nTODO OK ({ok} comprobaciones)")
