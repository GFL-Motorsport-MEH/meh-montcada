"""Prueba de los filtros de Facturación (Gastos, Facturación, Control, Conciliación, Historial) con datos inventados.
No necesita test/fixtures.json (datos reales): genera unos mínimos. Uso:  python3 test/test_filtros_app.py
"""
import json, re, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB, TEST = ROOT / "app", ROOT / "test"
URL = "http://127.0.0.1:8769/"
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8769", "--bind", "127.0.0.1"], cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
errores, ok = [], 0
def check(cond, msg):
    global ok
    if not cond: raise AssertionError(msg)
    ok += 1; print("  ok:", msg)

# ---- datos mínimos inventados ----
CURSO = "c-2627"
cursos = [{"id": CURSO, "nombre": "2026.27", "fecha_inicio": "2026-09-01", "fecha_fin": "2027-08-31", "activo": True}]
cat = [{"id": "cat-1", "nombre": "GESTORIA", "orden": 1}]
sub = [{"id": "sub-1", "categoria_id": "cat-1", "nombre": "Cuota Autonomo", "orden": 1}]
def gasto(i, fecha, emp, pago):
    return {"id": f"00000000-0000-0000-0000-{i:012d}", "curso_id": CURSO, "centro_id": "cen-1", "fecha_factura": fecha, "fecha_pago": fecha, "empresa": emp, "concepto": f"Concepto {i}",
            "cantidad": 10.0 * i, "categoria_id": "cat-1", "subcategoria_id": "sub-1", "tipo": "Factura", "periodicidad": "Mensual", "metodo_pago": "Tarjeta", "pago": pago,
            "check_banca": False, "sin_factura": False, "revisado": True, "mes": ["septiembre", "octubre", "noviembre", "diciembre"][i % 4], "created_at": f"2026-11-0{i}T10:00:00Z", "updated_at": "2026-11-06T00:00:00Z"}
gastos = [gasto(1, "2026-09-05", "Luz SA", "True"), gasto(2, "2026-10-20", "Agua SL", "False"), gasto(3, "2026-11-02", "Luz SA", "True"), gasto(4, "2026-12-15", "Gas SL", "False")]
fx = {"cursos": cursos, "categorias": cat, "subcategorias": sub, "gastos": gastos, "ingresos": [], "ingresos_metodo": [], "alumnos_mes": [], "facturacion": [], "empresas": [],
      "listas": [{"id": "l1", "lista": "tipo", "valor": "Factura", "orden": 1}, {"id": "l2", "lista": "metodo_pago", "valor": "Tarjeta", "orden": 1}, {"id": "l3", "lista": "periodicidad", "valor": "Mensual", "orden": 1}],
      "centros": [{"id": "cen-1", "nombre": "MONTCADA", "principal": True, "activo": True, "orden": 0}], "plantillas_gasto": [], "cuentas_bancarias": [], "movimientos_banco": [], "movimiento_gastos": [], "notas": [], "tarifas": [], "parametros": [],
      "profiles": [{"id": "00000000-0000-0000-0000-00000000aaaa", "nombre": "Admin", "email": "admin@example.com", "rol": "admin", "activo": True, "created_at": "2026-11-05T10:00:00Z"}]}

try:
    with sync_playwright() as p:
        try: b = p.chromium.launch()
        except Exception: b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        page = b.new_page(viewport={"width": 1400, "height": 900})
        page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase.js"), content_type="application/javascript"))
        page.route("**/__fixtures.json", lambda r: r.fulfill(body=json.dumps(fx), content_type="application/json"))
        page.route(re.compile(r"https://cdn\.jsdelivr\.net/npm/pdfjs-dist@.*"), lambda r: r.fulfill(path=str(TEST / "mock-pdfjs.js"), content_type="application/javascript"))
        page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        page.on("console", lambda m: errores.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.on("dialog", lambda d: d.accept())

        page.goto(URL)
        page.get_by_label("Email").fill("admin@example.com"); page.get_by_label("Contraseña").fill("secreto123")
        page.get_by_role("button", name="Entrar").click()
        expect(page.locator(".kpi").first).to_be_visible(timeout=10000)

        def ir(r):
            page.evaluate("r => { window.location.hash = '#/' + r }", r); page.wait_for_timeout(500)
            expect(page.locator(".loading")).to_have_count(0, timeout=8000)

        print("1. Gastos")
        ir("gastos")
        check(page.locator("table.tabla-gastos tbody tr").count() == 4, "4 gastos sin filtrar")
        check(page.locator(".aviso-filtros:visible").count() == 0, "sin filtros no hay aviso")
        page.locator(".filters-gastos select").select_option("sin_pago")
        check(page.locator("table.tabla-gastos tbody tr").count() == 2, "estado «pendientes de pago» → 2 gastos")
        check(page.locator(".aviso-filtros:visible").count() == 1, "aparece el aviso de filtro activo")
        # filtro de fechas de la cabecera (F. fact.): posterior a 2026-10-01
        page.locator("th.th-filtro:has(button[aria-label='Filtro de F. fact.'])").locator(".ffecha-btn").click()
        page.locator("th.th-filtro:has(button[aria-label='Filtro de F. fact.']) .ffecha-panel select").select_option("despues")
        page.locator("th.th-filtro:has(button[aria-label='Filtro de F. fact.']) .ffecha-panel input[type=date]").first.fill("2026-10-01")
        check(page.locator("table.tabla-gastos tbody tr").count() == 2, "posterior al 01/10/2026 + pendientes de pago → 2")
        page.locator("th.th-filtro:has(button[aria-label='Filtro de F. fact.']) .ffecha-panel select").select_option("antes")
        check(page.locator("table.tabla-gastos tbody tr").count() == 1, "anterior al 01/10/2026 + pendientes de pago → 0 o 1 según el modo")
        page.locator("th.th-filtro:has(button[aria-label='Filtro de F. fact.']) .ffecha-panel select").select_option("despues")
        page.reload(); expect(page.locator("table.tabla-gastos")).to_be_visible(timeout=10000); page.wait_for_timeout(500)
        check(page.locator("table.tabla-gastos tbody tr").count() == 2, "tras refrescar siguen los filtros (estado + fecha)")
        check(page.locator(".filters-gastos select").input_value() == "sin_pago", "el desplegable de estado sigue elegido")
        txt = page.locator(".aviso-filtros").first.inner_text()
        check("Estado" in txt and "posterior" in txt, f"el aviso detalla los filtros: {txt}")
        page.locator(".aviso-filtros button").first.click(); page.wait_for_timeout(300)
        check(page.locator("table.tabla-gastos tbody tr").count() == 4 and page.locator(".aviso-filtros:visible").count() == 0, "«Quitar filtros» deja todo como al principio")
        page.reload(); expect(page.locator("table.tabla-gastos")).to_be_visible(timeout=10000)
        check(page.locator("table.tabla-gastos tbody tr").count() == 4, "…y tras refrescar tampoco vuelven")
        # los filtros se acumulan (AND) y cada columna se recuerda por separado, aunque comparta clase CSS (Pago / Banco / Gest.)
        page.locator("th select[aria-label='Filtro pagado']").select_option("si")
        check(page.locator("table.tabla-gastos tbody tr").count() == 2, "Pago = ✓ → 2")
        page.locator("th select[aria-label='Filtro banco']").select_option("si")
        check(not re.search(r"Luz SA|Agua SL|Gas SL", page.locator("table.tabla-gastos tbody").inner_text()), "Pago = ✓ y Banco = ✓ a la vez → 0 (se respeta el primer filtro)")
        page.reload(); expect(page.locator("table.tabla-gastos")).to_be_visible(timeout=10000); page.wait_for_timeout(500)
        check(page.locator("th select[aria-label='Filtro pagado']").input_value() == "si" and page.locator("th select[aria-label='Filtro banco']").input_value() == "si", "tras refrescar siguen Pago y Banco")
        check(not re.search(r"Luz SA|Agua SL|Gas SL", page.locator("table.tabla-gastos tbody").inner_text()), "…y siguen combinados (0 filas)")
        page.locator(".aviso-filtros button").first.click(); page.wait_for_timeout(300)
        page.locator("th", has_text="Banco").first.click(); page.wait_for_timeout(300)
        check(page.locator("th[aria-sort='ascending'], th[aria-sort='descending']").first.inner_text().upper().startswith("BANCO"), "ordenar por Banco marca la columna Banco")
        page.locator("th", has_text="Banco").first.click(); page.locator("th", has_text="Banco").first.click(); page.wait_for_timeout(200)

        print("2. Facturación")
        ir("facturacion")
        check(page.locator(".ffecha").count() >= 1, "Facturación tiene el filtro de fechas con modos")
        check(page.locator(".aviso-filtros:visible").count() == 0, "el rango del curso por defecto no cuenta como filtro")
        page.locator(".ffecha select").first.select_option("antes")
        page.locator(".ffecha input[type=date]").first.fill("2026-10-01")
        expect(page.locator(".aviso-filtros:visible")).to_have_count(1)
        page.reload(); expect(page.locator(".ffecha")).to_be_visible(timeout=10000); page.wait_for_timeout(300)
        check(page.locator(".ffecha select").first.input_value() == "antes", "el modo de fecha elegido sigue tras refrescar")
        page.locator(".aviso-filtros button").first.click(); page.wait_for_timeout(200)
        check(page.locator(".aviso-filtros:visible").count() == 0, "Facturación: «Quitar filtros» vuelve al rango del curso")

        print("3. Control y Conciliación tienen su filtro de fechas")
        ir("control")
        check(page.locator(".ffecha").count() >= 1, "Control › Facturas pendientes tiene filtro de fechas")
        page.get_by_role("tab", name="Conciliación bancaria").click(); page.wait_for_timeout(500)
        check(page.locator(".ffecha").count() >= 1 and page.locator(".filters select").count() >= 3, "Conciliación: filtro de fechas y desplegables")
        ir("config")
        page.get_by_role("tab", name="Historial y copias").click(); page.wait_for_timeout(600)
        check(page.locator(".ffecha").count() >= 1, "Historial: filtro de fechas con modos")
        check(not [e for e in errores if "favicon" not in e and "ERR_FAILED" not in e], "sin errores: " + "; ".join(errores[:3]))
        b.close()
    print(f"\nTODO OK ({ok} comprobaciones)")
except Exception as ex:
    print("\nFALLO:", ex); print("errores:", errores[:5]); sys.exit(1)
finally:
    srv.terminate()
