"""Prueba de la web pública de formularios (páginas, condicionales, nota) y del editor visual de la app.
Uso:  python3 test/test_formularios.py
"""
import json, re, subprocess, sys, time, pathlib, base64
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST = ROOT / "test"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
(pathlib.Path("/tmp") / "logo-test.png").write_bytes(PNG)
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
srvs = [subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT / d, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for port, d in [(8771, "app"), (8772, "forms")]]
time.sleep(0.8)
ok = 0; errores = []
def check(cond, msg):
    global ok
    if not cond: raise AssertionError(msg)
    ok += 1; print("  ok:", msg)

DEF = {"slug": "pre", "titulo": "Prematrícula", "descripcion": "Lee **esto** y [pulsa aquí](https://example.com/info)\n\n- uno\n- dos", "imagen_cabecera": "https://img.test/logo.png",
       "config": {"color": "#d97706", "cabecera": "logo", "boton": "Reservar plaza"}, "campos": [
    {"id": "email", "tipo": "email", "etiqueta": "Correo", "requerido": True},
    {"id": "curso", "tipo": "radio", "etiqueta": "Curso", "requerido": True, "opciones": ["KIDS", "TEENS"]},
    {"id": "sec_k", "tipo": "seccion", "etiqueta": "Horarios KIDS", "ayuda": "Elige **días**", "si": {"campo": "curso", "op": "es", "valor": "KIDS"}},
    {"id": "dias", "tipo": "casillas", "etiqueta": "Días", "requerido": True, "opciones": ["Lunes", "Martes"]},
    {"id": "sec_t", "tipo": "seccion", "etiqueta": "Horarios TEENS", "si": {"campo": "curso", "op": "es", "valor": "TEENS"}},
    {"id": "nivel", "tipo": "select", "etiqueta": "Nivel", "requerido": True, "opciones": ["B1", "B2"]},
    {"id": "sec_f", "tipo": "seccion", "etiqueta": "Valoración"},
    {"id": "txt", "tipo": "info", "etiqueta": "Aviso", "ayuda": "Pago antes del **11 de mayo**."},
    {"id": "gusta", "tipo": "escala", "etiqueta": "Valora", "min": 1, "max": 5, "etiq_min": "Mal", "etiq_max": "Genial"},
    {"id": "porque", "tipo": "texto", "etiqueta": "¿Por qué?", "requerido": True, "si": {"campo": "gusta", "op": "es", "valor": "1|2"}},
]}
posts = []
def fn(route):
    r = route.request
    h = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json"}
    if r.method == "OPTIONS": return route.fulfill(status=204, headers=h)
    if r.method == "GET":
        if "slug=pre" in r.url: return route.fulfill(status=200, headers=h, body=json.dumps(DEF))
        return route.fulfill(status=404, headers=h, body=json.dumps({"error": "No existe"}))
    posts.append(json.loads(r.post_data)); route.fulfill(status=200, headers=h, body=json.dumps({"ok": True, "mensaje": "¡Plaza reservada!", "nota": {"puntos": 3, "max": 4}}))

try:
    with sync_playwright() as p:
        try: b = p.chromium.launch()
        except Exception: b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        # ---------------- web pública ----------------
        pub = b.new_page(viewport={"width": 420, "height": 800})
        pub.route(re.compile(r"https://dpnacxuavulpyyaobuev\.supabase\.co/functions/v1/formulario.*"), fn)
        pub.route("https://img.test/**", lambda r: r.fulfill(body=PNG, content_type="image/png"))
        pub.on("pageerror", lambda e: errores.append(str(e)))
        print("1. web pública: páginas y condicionales")
        pub.goto("http://127.0.0.1:8772/?f=pre"); expect(pub.locator("h1")).to_have_text("Prematrícula", timeout=8000)
        check(pub.locator("img.cabecera.logo").count() == 1, "cabecera con logo")
        check(pub.locator(".sub strong").inner_text() == "esto" and pub.locator(".sub a").get_attribute("href") == "https://example.com/info" and pub.locator(".sub li").count() == 2, "texto con negrita, enlace y lista")
        check(pub.evaluate("getComputedStyle(document.querySelector('.fp-raiz')).getPropertyValue('--acento').trim()") == "#d97706", "color de acento")
        check(pub.get_by_text("Paso 1 de 2").count() == 1, "empieza en el paso 1 de 2 (las ramas Kids/Teens aún no cuentan)")
        pub.get_by_role("button", name="Siguiente").click()
        check("Completa: Correo" in pub.locator(".error").inner_text(), "obligatoria: avisa y no avanza")
        pub.get_by_label("Correo").fill("a@b.es"); pub.get_by_label("KIDS").check()
        pub.get_by_role("button", name="Siguiente").click()
        check(pub.get_by_role("heading", name="Horarios KIDS").is_visible() and pub.locator(".pagina:visible .md strong").inner_text() == "días", "rama KIDS: página con su título y texto")
        check(pub.get_by_text("Horarios TEENS").count() == 1 and not pub.get_by_text("Horarios TEENS").is_visible(), "la página TEENS queda oculta")
        check(pub.get_by_text("Paso 2 de 3").count() == 1, "al elegir KIDS el contador pasa a 3 pasos (solo cuenta las páginas que se ven)")
        pub.get_by_role("button", name="Atrás").click(); check(pub.get_by_label("Correo").is_visible(), "Atrás vuelve a la primera página")
        pub.get_by_role("button", name="Siguiente").click()
        pub.get_by_role("button", name="Siguiente").click(); check("Completa: Días" in pub.locator(".error").inner_text(), "obligatoria de la página KIDS")
        pub.get_by_label("Martes").check(); pub.get_by_role("button", name="Siguiente").click()
        check(pub.get_by_text("Pago antes del").is_visible() and pub.get_by_role("button", name="Reservar plaza").is_visible(), "última página: texto informativo y botón personalizado")
        check(not pub.get_by_label("¿Por qué?").is_visible(), "«¿Por qué?» oculta mientras no se valore bajo")
        pub.locator(".esc", has_text="2").click(); check(pub.get_by_label("¿Por qué?").is_visible(), "valorando 2 aparece «¿Por qué?»")
        pub.get_by_role("button", name="Reservar plaza").click(); check("Completa: ¿Por qué?" in pub.locator(".error").inner_text(), "la pregunta condicional visible es obligatoria")
        pub.locator(".esc", has_text="5").click(); check(not pub.get_by_label("¿Por qué?").is_visible(), "valorando 5 vuelve a ocultarse")
        pub.get_by_role("button", name="Reservar plaza").click(); pub.wait_for_timeout(400)
        check(len(posts) == 1 and posts[0]["datos"] == {"email": "a@b.es", "curso": "KIDS", "dias": ["Martes"], "gusta": 5}, f"se envía solo lo visible: {posts[0]['datos'] if posts else None}")
        check("¡Plaza reservada!" in pub.locator(".ok").inner_text() and "Tu nota: 3 / 4" in pub.locator(".ok").inner_text(), "mensaje final y nota")
        pub.goto("http://127.0.0.1:8772/?f=nada"); expect(pub.locator("h1")).to_have_text("Formulario no disponible", timeout=8000)
        check(True, "formulario inexistente: mensaje amable")
        pub.close()

        # ---------------- editor en la app ----------------
        page = b.new_page(viewport={"width": 1400, "height": 900})
        page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase-academia.js"), content_type="application/javascript"))
        page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        page.route("https://img.test/**", lambda r: r.fulfill(body=PNG, content_type="image/png"))
        page.route(re.compile(r"https://calendar\.google\.com/.*"), lambda r: r.abort())
        page.on("console", lambda m: errores.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.on("dialog", lambda d: d.accept("https://ejemplo.es/folleto"))
        db = lambda t: page.evaluate("t => window.__mock.db[t]", t)
        print("2. editor visual")
        page.goto("http://127.0.0.1:8771/#/ac_formularios"); page.wait_for_timeout(1500)
        page.get_by_role("button", name="+ Nuevo formulario").click(); page.locator(".fe-plantilla", has_text="en blanco").click(); page.wait_for_timeout(300)
        ajustes = page.locator(".fe-card").first
        ajustes.locator(".field", has_text="Título").locator("input").first.fill("Campamento de verano")
        check(ajustes.locator(".field", has_text="Dirección").locator("input").input_value() == "campamento-de-verano", "la dirección web se propone desde el título")
        with page.expect_file_chooser() as fc: page.get_by_role("button", name="Subir imagen / logo").click()
        fc.value.set_files("/tmp/logo-test.png"); page.wait_for_timeout(500)
        check(page.locator(".fe-mini img").count() == 1 and page.locator(".fe-previa img.cabecera").count() == 1, "la imagen de cabecera se sube y sale en la vista previa")
        ajustes.locator(".field", has_text="Texto de presentación").locator("textarea").fill("Verano **2026**")
        page.wait_for_timeout(400); check(page.locator(".fe-previa .sub strong").inner_text() == "2026", "la vista previa muestra la presentación con formato en vivo")
        P = page.locator(".fe-paleta")
        P.get_by_role("button", name="Correo electrónico").click(); page.locator(".fe-cuerpo .field", has_text="Pregunta").locator("input").first.fill("Correo de contacto")
        page.locator(".fe-cuerpo .fe-chk", has_text="Obligatoria").locator("input").check()
        P.get_by_role("button", name="Una opción (botones)").click(); page.locator(".fe-cuerpo .field", has_text="Pregunta").locator("input").first.fill("¿Eres alumno?")
        page.locator(".fe-cuerpo .field", has_text="Opciones").locator("textarea").fill("Sí\nNo")
        P.get_by_role("button", name="Varias opciones").click(); page.locator(".fe-cuerpo .field", has_text="Pregunta").locator("input").first.fill("Semanas")
        page.locator(".fe-cuerpo .field", has_text="Opciones").locator("textarea").fill("Semana 1\nDÍAS ESPORÁDICOS")
        P.get_by_role("button", name="Texto corto").click(); page.locator(".fe-cuerpo .field", has_text="Pregunta").locator("input").first.fill("Especifica los días")
        page.locator(".fe-cond .fe-chk input").first.check()
        cond = page.locator(".fe-cond")
        cond.locator("select").first.select_option(label="Semanas"); cond.locator(".fe-opts label", has_text="ESPOR").locator("input").check()
        page.wait_for_timeout(400)
        check(page.locator(".fe-previa").get_by_text("Especifica los días").count() == 1 and not page.locator(".fe-previa").get_by_text("Especifica los días").is_visible(), "vista previa: la pregunta condicional está oculta")
        page.locator(".fe-previa label", has_text="ESPORÁDICOS").locator("input").check(); check(page.locator(".fe-previa").get_by_text("Especifica los días").is_visible(), "vista previa: aparece al marcar «días esporádicos»")
        P.get_by_role("button", name="Nueva página").click(); page.locator(".fe-cuerpo .field", has_text="Título de la página").locator("input").fill("Extras")
        P.get_by_role("button", name="Texto informativo").click()
        ta = page.locator(".fe-cuerpo .field", has_text="Texto (admite").locator("textarea"); ta.fill("Precio")
        ta.select_text(); page.locator(".fe-cuerpo .fe-barra").get_by_role("button", name="N", exact=True).click()
        check(ta.input_value() == "**Precio**", "la barra de formato pone negrita")
        page.locator(".fe-cuerpo .fe-barra").get_by_role("button", name="Enlace").click(); check("](https://ejemplo.es/folleto)" in ta.input_value(), "la barra inserta enlaces")
        n_antes = page.locator(".fe-bloque").count()
        page.locator(".fe-bloque", has_text="¿Eres alumno?").locator(".fe-acc button[title=Subir]").click(); page.wait_for_timeout(200)
        check(page.locator(".fe-t").all_inner_texts()[:2] == ["¿Eres alumno?", "Correo de contacto"] and n_antes == 6, "la flecha ↑ sube un bloque")
        page.locator(".fe-bloque", has_text="¿Eres alumno?").locator(".fe-acc button[title=Bajar]").click(); page.wait_for_timeout(200)
        check(page.locator(".fe-t").all_inner_texts()[:2] == ["Correo de contacto", "¿Eres alumno?"], "la flecha ↓ lo devuelve a su sitio")
        page.get_by_role("button", name="Guardar formulario").click(); page.wait_for_timeout(700)
        f = [x for x in db("ac_formularios") if x["slug"] == "campamento-de-verano"][0]
        ids = [c["id"] for c in f["campos"]]
        check(ids[:4] == ["correo_de_contacto", "eres_alumno", "semanas", "especifica_los_dias"] and ids[4] == "extras" and f["imagen_cabecera"].startswith("https://img.test/") and f["campos"][0]["requerido"] is True, f"se guarda con ids estables {ids}")
        esp = [c for c in f["campos"] if c["id"] == "especifica_los_dias"][0]
        check(esp["si"] == {"campo": "semanas", "op": "es", "valor": "DÍAS ESPORÁDICOS"}, "se guarda la condición")
        check([c["tipo"] for c in f["campos"]][-2:] == ["seccion", "info"] and f["campos"][-1]["ayuda"].startswith("[**Precio**]"), "secciones y textos informativos se guardan")

        print("3. test con corrección y plantillas")
        page.locator(".filters select").first.select_option(f["id"]); page.wait_for_timeout(200)
        page.get_by_role("button", name="Duplicar").click(); page.wait_for_timeout(300)
        check(page.locator(".fe-card").first.locator(".field", has_text="Título").locator("input").first.input_value() == "Copia de Campamento de verano", "duplicar abre una copia con otro título")
        page.locator(".fe-card").first.locator(".fe-chk", has_text="plantilla").locator("input").check()
        page.locator(".fe-card").first.locator(".fe-chk", has_text="test con corrección").locator("input").check()
        page.locator(".fe-bloque", has_text="¿Eres alumno?").locator(".fe-head").click(); page.wait_for_timeout(200)
        page.locator(".fe-corr select").select_option("No")
        page.locator(".fe-card").first.locator(".field", has_text="Dirección").locator("input").fill("plantilla-campamento")
        page.get_by_role("button", name="Guardar formulario").click(); page.wait_for_timeout(700)
        pl = [x for x in db("ac_formularios") if x["slug"] == "plantilla-campamento"][0]
        check(pl["plantilla"] is True and pl["config"].get("test") is True and [c for c in pl["campos"] if c["id"] == "eres_alumno"][0]["correcta"] == "No", "plantilla con respuesta correcta guardada")
        page.get_by_role("button", name="+ Nuevo formulario").click(); page.wait_for_timeout(300)
        check(page.locator(".fe-plantilla", has_text="Copia de Campamento").count() == 1 and "con corrección" in page.locator(".fe-plantilla", has_text="Copia de Campamento").inner_text(), "las plantillas se ofrecen al crear un formulario")
        page.locator(".fe-plantilla", has_text="Copia de Campamento").click(); page.wait_for_timeout(300)
        check(page.locator(".fe-bloque").count() == 6 and page.locator(".fe-card").first.locator(".field", has_text="Dirección").locator("input").input_value().startswith("copia-de-campamento"), "crear desde plantilla copia los bloques y propone una dirección nueva")
        page.get_by_role("button", name="← Volver").click(); page.wait_for_timeout(300)
        check(page.get_by_role("button", name="+ Nuevo formulario").count() == 1, "volver (con cambios sin guardar pide confirmar y sale)")

        print("4. respuestas con nota")
        page.evaluate("""() => { const m = window.__mock.db; const f = m.ac_formularios.find((x) => x.slug === 'plantilla-campamento'); f.plantilla = false;
          m.ac_formulario_respuestas.push({ id: 'rq1', formulario_id: f.id, created_at: '2026-11-19T10:00:00Z', estado: 'nueva', puntuacion: 0, puntuacion_max: 1, datos: { correo_de_contacto: 'x@y.es', eres_alumno: 'Sí' } }); sessionStorage.setItem('ac_form_sel', f.id); }""")
        page.evaluate("async () => { (await import('/js/academia/api.js')).invalidar(); window.dispatchEvent(new Event('hashchange')); }"); page.wait_for_timeout(900)
        check("0 / 1" in page.locator("table tbody tr").first.inner_text(), "la lista muestra la columna Nota")
        page.locator("table tbody tr").first.click(); page.wait_for_timeout(400)
        check("Nota: 0 / 1" in page.locator(".drawer").inner_text() and "✗ (correcta: No)" in page.locator(".drawer").inner_text(), "la ficha marca los fallos y la respuesta correcta")
        print("5. plantillas de la academia"); page.keyboard.press("Escape")
        guardadas = {}
        for titulo, minimo in [("Prematrículas", 14), ("Summer Camp", 13), ("Encuesta de satisfacción", 24), ("B2 English Level Test", 30)]:
            ir_lista = page.evaluate("async () => { (await import('/js/academia/api.js')).invalidar(); window.location.hash = '#/ac_formularios'; window.dispatchEvent(new Event('hashchange')); }")
            page.wait_for_timeout(700)
            page.get_by_role("button", name="+ Nuevo formulario").click(); page.wait_for_timeout(300)
            page.locator(".fe-plantilla", has_text=titulo).first.click(); page.wait_for_timeout(500)
            slug = page.locator(".fe-card").first.locator(".field", has_text="Dirección").locator("input").input_value()
            check(len(slug) >= 4 and page.locator(".fe-bloque").count() >= minimo, f"plantilla «{titulo}»: se abre con sus bloques ({page.locator('.fe-bloque').count()}) y dirección propuesta «{slug}»")
            page.get_by_role("button", name="Guardar formulario").click(); page.wait_for_timeout(700)
            f = [x for x in db("ac_formularios") if x["slug"] == slug]
            check(len(f) == 1, f"plantilla «{titulo}»: se guarda como formulario nuevo")
            guardadas[titulo] = f[0]
        check(any(c["tipo"] == "seccion" and c.get("si") for c in guardadas["Prematrículas"]["campos"]), "Prematrículas: páginas condicionales por curso")
        check(guardadas["B2 English Level Test"]["config"].get("test") is True, "Prueba de nivel: es un test con corrección")
        pub = b.new_page(viewport={"width": 420, "height": 800})
        pub.route(re.compile(r"https://dpnacxuavulpyyaobuev\.supabase\.co/functions/v1/formulario.*"), fn)
        pub.route("https://img.test/**", lambda r: r.fulfill(body=PNG, content_type="image/png"))
        pub.on("pageerror", lambda e: errores.append(str(e)))
        for titulo, f in guardadas.items():
            DEF.clear(); DEF.update({"slug": "pre", "titulo": f["titulo"], "descripcion": f["descripcion"], "imagen_cabecera": f["imagen_cabecera"], "config": f["config"], "campos": f["campos"]})
            pub.goto("http://127.0.0.1:8772/?f=pre"); expect(pub.locator("h1")).to_have_text(f["titulo"], timeout=8000)
            check(pub.locator("input, select, textarea").count() >= 3, f"la web pública pinta «{titulo}»")
        pub.close()
        check(not errores, "sin errores de consola: " + "; ".join(errores[:3]))
        b.close()
    print(f"\nTODO OK ({ok} comprobaciones)")
except Exception as ex:
    print("\nFALLO:", ex); print("errores:", errores[:5]); sys.exit(1)
finally:
    for s in srvs: s.terminate()
