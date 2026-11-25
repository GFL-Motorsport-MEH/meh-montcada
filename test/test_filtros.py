"""Prueba de los filtros: se recuerdan al refrescar, avisan de que hay un filtro activo y los de fecha / estado funcionan.
Uso:  python3 test/test_filtros.py     (usa el Supabase simulado de Academia)
"""
import re, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB, TEST = ROOT / "app", ROOT / "test"
URL = "http://127.0.0.1:8767/"
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "--bind", "127.0.0.1"], cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
errores, ok = [], 0
def check(cond, msg):
    global ok
    if not cond: raise AssertionError(msg)
    ok += 1; print("  ok:", msg)
def ir(page, ruta):
    page.evaluate("r => { window.location.hash = '#/' + r }", ruta)
    page.wait_for_timeout(350)
    expect(page.locator(".loading")).to_have_count(0, timeout=8000)

try:
    with sync_playwright() as p:
        try: b = p.chromium.launch()
        except Exception: b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        page = b.new_page(viewport={"width": 1280, "height": 900})
        page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase-academia.js"), content_type="application/javascript"))
        page.route(re.compile(r"https://(calendar\.google\.com|fonts\.(googleapis|gstatic)\.com)/.*"), lambda r: r.abort())
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.on("dialog", lambda d: d.accept())

        print("1. filtro de fechas (lógica)")
        page.goto(URL + "#/ac_alumnos")
        expect(page.locator("main")).to_be_visible(timeout=10000)
        r = page.evaluate("""async () => { const m = await import('/js/vista.js');
          const e = { modo: 'entre', a: '2026-09-01', b: '2026-09-30' };
          return [m.pasaFecha('2026-09-10', e), m.pasaFecha('2026-10-01', e), m.pasaFecha('2026-09-30', e), m.pasaFecha('', e),
            m.pasaFecha('2026-09-02', { modo: 'despues', a: '2026-09-01' }), m.pasaFecha('2026-09-01', { modo: 'despues', a: '2026-09-01' }),
            m.pasaFecha('2026-08-31', { modo: 'antes', a: '2026-09-01' }), m.pasaFecha('2026-09-01', { modo: 'antes', a: '2026-09-01' }),
            m.pasaFecha('2026-09-01', { modo: 'igual', a: '2026-09-01' }), m.pasaFecha('2020-01-01', { modo: 'entre', a: '', b: '' }),
            m.aISO('15/06/26'), m.aISO('2026-06-15T10:00:00Z'), JSON.stringify(m.rangoFecha({ modo: 'despues', a: '2026-09-01' }))]; }""")
        check(r[:10] == [True, False, True, False, True, False, True, False, True, True], f"entre / posterior / anterior / igual a una fecha: {r[:10]}")
        check(r[10] == "2026-06-15" and r[11] == "2026-06-15" and r[12] == '{"desde":"2026-09-02","hasta":""}', f"conversión de fechas: {r[10:]}")

        print("2. el estado de la vista se guarda y se recupera tras refrescar")
        r = page.evaluate("""async () => { const m = await import('/js/vista.js'); m.fijarUsuario('u1');
          const a = m.vista('prueba', { q: '', estado: 'x', fecha: { modo: 'entre', a: '', b: '' } }); a.q = 'hola'; a.fecha = { modo: 'antes', a: '2026-01-01', b: '' };
          const b = m.vista('prueba', { q: '', estado: 'x', fecha: { modo: 'entre', a: '', b: '' } }); m.fijarUsuario('u2');
          const c = m.vista('prueba', { q: '', estado: 'x', fecha: { modo: 'entre', a: '', b: '' } });
          return [b.q, b.estado, b.fecha.modo, c.q]; }""")
        check(r == ["hola", "x", "antes", ""], f"se recupera lo guardado y es por usuario: {r}")

        print("3. tabla genérica: filtro de fecha, desplegable de estado, aviso y persistencia")
        page.evaluate("""async () => { const m = await import('/js/vista.js'); m.fijarUsuario('u1'); }""")
        montar = """async () => { const k = await import('/js/academia/kit.js'); const { h } = await import('/js/ui.js');
          document.querySelectorAll('#t-prueba').forEach((x) => x.remove());
          const filas = [['A', '05/09/2026', 'Pagado'], ['B', '20/10/2026', 'Pendiente'], ['C', '02/11/2026', 'Pagado']];
          const el = k.tabla([{ t: 'Alumno', v: (f) => f[0] }, { t: 'Fecha', v: (f) => f[1] }, { t: 'Estado', v: (f) => f[2] }], filas);
          const w = h('div', { id: 't-prueba' }, el); document.body.append(w); }"""
        borrar = "async () => { const m = await import('/js/vista.js'); m.borrarV('tabla.' + 'x'); for (const k of Object.keys(localStorage)) if (k.includes('.tabla.')) localStorage.removeItem(k); }"
        page.evaluate(borrar)
        # el estado en memoria de la tabla es por sesión: se recarga la página para empezar limpio
        page.reload(); expect(page.locator("main")).to_be_visible(timeout=10000)
        page.evaluate("async () => { const m = await import('/js/vista.js'); m.fijarUsuario('u1'); }")
        page.evaluate(montar)
        t = page.locator("#t-prueba")
        check(t.locator("tbody tr").count() == 3, "3 filas sin filtrar")
        check(t.locator(".ffecha-btn").count() == 1, "la columna de fechas tiene filtro de fechas")
        check(t.locator("tr.ac-fila-filtros th.ac-filtro > select").count() == 1, "la columna Estado es un desplegable aunque haya pocas filas")
        check(t.locator(".aviso-filtros:visible").count() == 0, "sin filtros no hay aviso")
        t.locator("tr.ac-fila-filtros th.ac-filtro > select").select_option("Pagado")
        check(t.locator("tbody tr").count() == 2, "el desplegable filtra por estado")
        check(t.locator(".aviso-filtros:visible").count() == 1 and "Estado" in t.locator(".aviso-filtros").inner_text(), "aparece el aviso de filtro activo")
        t.locator(".ffecha-btn").click()
        t.locator(".ffecha-panel select").select_option("despues")
        t.locator(".ffecha-panel input[type=date]").first.fill("2026-09-30")
        check(t.locator("tbody tr").count() == 1 and "C" in t.locator("tbody").inner_text(), "posterior a una fecha + estado")
        check("2 filtros" in t.locator(".aviso-filtros").inner_text(), "el aviso cuenta los dos filtros")
        page.evaluate(montar)  # se vuelve a pintar (como al refrescar la vista): los filtros siguen
        t = page.locator("#t-prueba")
        check(t.locator("tbody tr").count() == 1, "los filtros se mantienen al volver a pintar la tabla")
        t.locator(".aviso-filtros button").click()
        check(t.locator("tbody tr").count() == 3 and t.locator(".aviso-filtros:visible").count() == 0, "«Quitar filtros» limpia todo")
        # orden por varias columnas: el último clic manda y el anterior desempata
        col = lambda: t.locator("tbody tr td:first-child").all_inner_texts()
        t.locator("th.sortable", has_text="Alumno").click(); t.locator("th.sortable", has_text="Alumno").click()
        check(col() == ["C", "B", "A"], f"Alumno ↓ → {col()}")
        t.locator("th.sortable", has_text="Estado").click()
        check(col() == ["C", "A", "B"], f"Alumno ↓ y luego Estado ↑: por estado y, dentro, por alumno ↓ → {col()}")
        check("1" in t.locator("th.sortable", has_text="Estado").inner_text() and "2" in t.locator("th.sortable", has_text="Alumno").inner_text(), "las flechas muestran el nivel de cada columna")

        print("3b. orden automático: cualquier tabla de listado se ordena pinchando en su cabecera")
        page.evaluate("async () => { const m = await import('/js/vista.js'); m.fijarUsuario('u1'); for (const k of Object.keys(localStorage)) if (k.includes('.orden.')) localStorage.removeItem(k); }")
        poner = """() => { document.querySelectorAll('#t-auto').forEach((x) => x.remove());
          const f = (a) => { const tr = document.createElement('tr'); a.forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.append(td); }); return tr; };
          const t = document.createElement('table'); t.id = 't-auto'; t.className = 'data prueba-auto';
          t.innerHTML = '<thead><tr><th>Nombre</th><th>Importe</th><th>Fecha</th></tr></thead>';
          const tb = document.createElement('tbody'); tb.append(f(['A', '1.200,50 €', '20/10/2026']), f(['B', '300 €', '05/09/2026']), f(['C', '', '02/11/2026']), f(['D', '300 €', '01/01/2027']));
          t.append(tb); document.body.append(t); }"""
        page.evaluate(poner); page.wait_for_timeout(300)
        ta = page.locator("#t-auto")
        nom = lambda: ta.locator("tbody tr td:first-child").all_inner_texts()
        check(ta.locator("th.sortable").count() == 3, "la tabla sin orden propio ahora tiene las cabeceras ordenables")
        ta.locator("th", has_text="Importe").click()
        check(nom() == ["B", "D", "A", "C"], f"Importe ↑ (números con coma y €, vacíos al final) → {nom()}")
        ta.locator("th", has_text="Importe").click()
        check(nom() == ["A", "B", "D", "C"], f"Importe ↓ → {nom()}")
        ta.locator("th", has_text="Fecha").click()
        check(nom() == ["B", "A", "C", "D"], f"Fecha ↑ (fechas dd/mm/aaaa) → {nom()}")
        check("1" in ta.locator("th", has_text="Fecha").inner_text() and "2" in ta.locator("th", has_text="Importe").inner_text(), "varias columnas: la última pulsada es el nivel 1 y la anterior el 2")
        antes = nom()
        page.evaluate(poner); page.wait_for_timeout(300)  # se vuelve a pintar la tabla (como al refrescar): el orden sigue
        check(page.locator("#t-auto tbody tr td:first-child").all_inner_texts() == antes, "el orden se mantiene al volver a pintar la tabla")
        page.evaluate("() => document.querySelectorAll('#t-auto').forEach((x) => x.remove())")

        print("4. pantallas: el filtro sobrevive a refrescar la página y avisa")
        page.reload(); expect(page.locator("main")).to_be_visible(timeout=10000)  # vuelve el usuario real de la sesión
        ir(page, "ac_tutorias")
        sel = page.locator(".filters select").first
        sel.select_option("hecha")
        expect(page.locator(".aviso-filtros:visible")).to_have_count(1)
        page.reload(); expect(page.locator(".filters select").first).to_be_visible(timeout=10000)
        check(page.locator(".filters select").first.input_value() == "hecha", "Tutorías: el estado elegido sigue tras refrescar")
        check(page.locator(".aviso-filtros:visible").count() == 1, "Tutorías: el aviso sigue visible tras refrescar")
        page.locator(".aviso-filtros button").click()
        check(page.locator(".filters select").first.input_value() == "" and page.locator(".aviso-filtros:visible").count() == 0, "Tutorías: «Quitar filtros» restablece el desplegable")

        ir(page, "ac_alumnos")
        page.locator(".filters input[type=search]").first.fill("zzz")
        page.wait_for_timeout(200)
        page.reload(); expect(page.locator(".filters input[type=search]").first).to_be_visible(timeout=10000)
        check(page.locator(".filters input[type=search]").first.input_value() == "zzz", "Alumnos: la búsqueda sigue tras refrescar")
        check("Búsqueda" in page.locator(".aviso-filtros").first.inner_text(), "Alumnos: avisa de la búsqueda activa")

        check(not [e for e in errores if "favicon" not in e], "sin errores de página: " + "; ".join(errores[:3]))
        b.close()
    print(f"\nTODO OK ({ok} comprobaciones)")
except Exception as ex:
    print("\nFALLO:", ex); print("errores:", errores[:5]); sys.exit(1)
finally:
    srv.terminate()
