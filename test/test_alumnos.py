"""Módulo Alumnos (ficha 360º, notas, tareas, informes, comunicaciones, documentación y actividades) con Supabase simulado.
Uso:  python3 test/test_alumnos.py
"""
import re, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB, TEST = ROOT / "app", ROOT / "test"
URL = "http://127.0.0.1:8768/"
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8768", "--bind", "127.0.0.1"], cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
ok, errores = 0, []
def check(c, m):
    global ok
    if not c: raise AssertionError(m)
    ok += 1; print("  ok:", m)
def db(page, t): return page.evaluate("t => window.__mock.db[t]", t)

SEMILLA = """() => { const m = window.__mock.db, hoy = new Date().toISOString().slice(0, 10);
  m.ac_responsables.push({ id: 'r1', nombre: 'Marta', apellidos: 'Ruiz', email: 'marta@ejemplo.es', telefono: '600111222' });
  m.ac_profesoras.push({ id: 'p1', nombre: 'Mar Franco', activa: true, orden: 0, profile_id: 'u-admin', siglas: 'MF' });
  m.ac_alumnos.push({ id: 'a1', num: 1, nombre: 'Ana', apellidos: 'García', estado: 'inscrito', nivel: 'LEVEL 2', modalidad: 'Kids', responsable_id: 'r1', fecha_nacimiento: '2016-04-10', autoriza_rrss: true },
                    { id: 'a2', num: 2, nombre: 'Luis', apellidos: 'Pérez', estado: 'inscrito', nivel: 'LEVEL 2', modalidad: 'Kids', fecha_nacimiento: '2015-02-01' });
  m.ac_grupos.push({ id: 'g1', curso_id: m.cursos[1].id, nombre: 'KIDS 2 L-X', profesora_id: 'p1', activo: true, capacidad: 8 });
  m.ac_sesiones.push({ id: 's1', grupo_id: 'g1', dia: 1, hora_inicio: '17:00', hora_fin: '18:00', profesora_id: 'p1' });
  m.ac_alumno_grupo.push({ id: 'ag1', alumno_id: 'a1', grupo_id: 'g1', fecha_baja: null }, { id: 'ag2', alumno_id: 'a2', grupo_id: 'g1', fecha_baja: null });
  m.ac_calendario_marcas.push({ id: 'cm1', curso_id: m.cursos[1].id, fecha: '2099-12-25', tipo: 'Festivo', nombre: 'Navidad' });
  m.ac_prestamos.push({ id: 'pr1', tipo: 'mascota', alumno_id: 'a1', libro: 'Mascota Nivel 1', fecha_salida: '2020-01-01', fecha_devolucion: null });
  m.ac_formularios.push({ id: 'f1', slug: 'granja', titulo: 'Salida granja', tipo: 'generico', activo: true, campos: [] });
  m.ac_formulario_respuestas.push({ id: 'fr1', formulario_id: 'f1', alumno_id: 'a2', estado: 'procesada', datos: {} }, { id: 'fr2', formulario_id: 'f1', alumno_id: null, estado: 'nueva', datos: {} });
  m.al_studyclub_sesiones.push({ id: 'sc1', centro_id: 'ce1', fecha: new Date(Date.now() + 86400000).toISOString().slice(0, 10), hora_inicio: '20:10:00', hora_fin: '20:40:00', titulo: 'Past Simple', profesora_id: 'p1', plazas: 2, estado: 'abierta', notas: null, profesora: { id: 'p1', nombre: 'Mar Franco' } },
    { id: 'sc2', centro_id: 'ce1', fecha: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), hora_inicio: '20:10:00', hora_fin: '20:40:00', titulo: null, profesora_id: null, plazas: 6, estado: 'abierta', notas: null });
  m.al_studyclub_reservas.push({ id: 'rs1', sesion_id: 'sc1', nombre: 'Ana García', email: 'marta@ejemplo.es', telefono: '600111222', tema: 'Past Simple', estado: 'apuntado', origen: 'web', created_at: '2099-01-01T10:00:00Z' });
  m.ac_tutorias.push({ id: 'tu1', alumno_id: 'a1', alumno: { id: 'a1' }, fecha: '2099-01-10', estado: 'pendiente', profesora_id: 'p1' });
}"""

def ir(page, ruta):
    page.evaluate("r => { window.location.hash = '#/' + r }", ruta)
    page.wait_for_timeout(350)
    expect(page.locator(".loading")).to_have_count(0, timeout=8000)

def abrir(b, rol="admin", ruta="al_ficha"):
    page = b.new_page(viewport={"width": 1280, "height": 900})
    page.add_init_script(f"window.__ROL = '{rol}'; window.__SEED = {SEMILLA}")
    page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase-academia.js"), content_type="application/javascript"))
    page.route(re.compile(r"https://cdn\.jsdelivr\.net/npm/xlsx@.*"), lambda r: r.fulfill(path=str(TEST / "mock-xlsx.js"), content_type="application/javascript"))
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
    page.on("pageerror", lambda e: errores.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto(URL + "#/" + ruta)
    page.wait_for_timeout(1500)
    return page

try:
    with sync_playwright() as p:
        try: b = p.chromium.launch()
        except Exception: b = p.chromium.launch(executable_path="/usr/bin/google-chrome")

        print("1. administrador: módulo y pestañas")
        pg = abrir(b)
        mods = [m.split("\n")[0].strip() for m in pg.locator(".modulos .modulo").all_inner_texts()]
        check("Alumnos" in mods, f"el selector de módulos incluye Alumnos {mods}")
        pg.locator(".modulos .modulo", has_text="Alumnos").click(); pg.wait_for_timeout(600)
        check(pg.evaluate("document.body.dataset.modulo") == "alumnos", "se abre el módulo Alumnos")
        tt = [t.strip() for t in pg.locator(".tabs .tab").all_inner_texts()]
        check(tt == ["Ficha", "Notas", "Tareas y material", "Informes y notas", "Comunicaciones", "Documentación", "Actividades", "Study Club", "Configuración"], f"pestañas {tt}")
        for r in ["al_ficha", "al_notas", "al_tareas", "al_informes", "al_comunicaciones", "al_documentos", "al_actividades"]:
            ir(pg, r); check(pg.locator(".banner.error").count() == 0, f"{r} carga sin errores")

        print("2. ficha 360º")
        ir(pg, "al_ficha")
        pg.locator(".buscador-alumno input").fill("García, Ana · nº 1"); pg.locator(".buscador-alumno input").dispatch_event("change"); pg.wait_for_timeout(700)
        txt = pg.locator("main").inner_text()
        for quiere in ["Datos", "Grupo y horario", "KIDS 2 L-X", "Lunes 17:00–18:00", "Notas", "Tutorías", "Biblioteca y mascotas", "Mascota Nivel 1", "Documentación", "Navidad", "marta@ejemplo.es"]:
            check(quiere.lower() in txt.lower(), f"la ficha muestra «{quiere}»")  # los títulos de tarjeta salen en mayúsculas por CSS
        check("días fuera" in txt, "avisa de la mascota que lleva más de 14 días fuera")
        check("falta" in txt, "la documentación obligatoria aparece como «falta»")

        print("3. notas: una a una y de todo un grupo")
        ir(pg, "al_notas")
        pg.get_by_role("button", name="+ Nueva nota").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer")
        d.locator(".buscador-alumno input").fill("García, Ana · nº 1")
        d.get_by_label("Nota (0–10)").fill("8.5"); d.get_by_label("Valoración").fill("Muy buen speaking")
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(600)
        ev = db(pg, "al_evaluaciones")
        check(len(ev) == 1 and ev[0]["alumno_id"] == "a1" and float(ev[0]["nota"]) == 8.5 and ev[0]["visible_familia"] is False, "nota guardada, interna por defecto")
        pg.get_by_role("button", name="+ Nueva nota").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.locator(".buscador-alumno input").fill("Pérez, Luis · nº 2"); d.get_by_label("Nota (0–10)").fill("11")
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(400)
        check(len(db(pg, "al_evaluaciones")) == 1, "una nota de 11 se rechaza")
        d.get_by_role("button", name="Cerrar").click()
        pg.get_by_role("button", name="Notas de un grupo").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.locator("select").first.select_option(label="KIDS 2 L-X"); pg.wait_for_timeout(300)
        d.locator(".al-bulk input[type=number]").nth(0).fill("7"); d.locator(".al-bulk input[type=number]").nth(1).fill("9")
        d.get_by_role("button", name="Guardar notas").click(); pg.wait_for_timeout(600)
        check(len(db(pg, "al_evaluaciones")) == 3, "las notas de los 2 alumnos del grupo se guardan de una vez")

        print("4. tareas: asignar a todo un grupo")
        ir(pg, "al_tareas")
        pg.get_by_role("button", name="+ Nueva").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer")
        d.locator(".al-dest select").first.select_option("grupo"); d.locator(".al-dest select").nth(1).select_option(label="KIDS 2 L-X")
        d.get_by_label("Título").fill("Repaso unit 4")
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(700)
        ta = db(pg, "al_tareas_extra")
        check(len(ta) == 2 and ta[0]["lote"] and ta[0]["lote"] == ta[1]["lote"] and ta[0]["visible_familia"] is True, "una fila por alumno del grupo, con el mismo lote y visible para la familia")

        print("5. informes y notas de profesoras")
        ir(pg, "al_informes")
        pg.get_by_role("button", name="+ Nuevo informe").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.locator(".buscador-alumno input").fill("García, Ana · nº 1"); d.get_by_label("Título").fill("Informe 1T")
        d.locator("select").nth(2).select_option("publicado"); d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(600)
        inf = db(pg, "al_informes")
        check(len(inf) == 1 and inf[0]["estado"] == "publicado" and inf[0]["publicado_at"], "informe publicado con fecha de publicación")
        pg.get_by_role("button", name="+ Nueva nota").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.locator(".buscador-alumno input").fill("García, Ana · nº 1"); d.locator("textarea").fill("Participa mucho en clase")
        d.locator(".al-check input").check(); d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(600)
        an = db(pg, "ac_anotaciones")
        check(len(an) == 1 and an[0]["visible_familia"] is True, "nota de profesora creada y visible para la familia")

        print("6. ficha «como la familia»")
        ir(pg, "al_ficha")
        pg.get_by_label("Ver como la familia").check(); pg.wait_for_timeout(700)
        txt = pg.locator("main").inner_text()
        check("Tutorías" not in txt and "Biblioteca" not in txt and "Informe 1T" in txt and "Repaso unit 4" in txt, "la vista de familia oculta lo interno y muestra lo publicado")
        check("Muy buen speaking" not in txt, "una nota interna no se ve en la vista de familia")
        pg.get_by_label("Ver como la familia").uncheck()

        print("7. comunicaciones")
        ir(pg, "al_comunicaciones")
        pg.get_by_role("button", name="+ Nueva comunicación").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.locator(".buscador-alumno input").fill("García, Ana · nº 1"); d.get_by_label("Asunto").fill("Recordatorio excursión")
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(600)
        check(len(db(pg, "al_mensajes")) == 1 and db(pg, "al_mensajes")[0]["sentido"] == "a_familia", "comunicación guardada")
        pg.evaluate("() => window.__mock.db.al_mensajes.push({ id: 'm9', alumno_id: 'a2', sentido: 'de_familia', canal: 'portal', asunto: 'Falta mañana', visible_familia: true, created_at: new Date().toISOString(), leido_at: null })")
        ir(pg, "al_comunicaciones")
        check("sin leer" in pg.locator("main").inner_text(), "avisa de los mensajes de familias sin leer")

        print("8. documentación: qué falta y subir un DNI")
        ir(pg, "al_documentos")
        check("García, Ana" in pg.locator("main").inner_text() and pg.locator("main .pill", has_text="falta").count() >= 3, "«Qué falta» lista a los alumnos con documentación pendiente")
        pg.get_by_role("button", name="+ Subir documento").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.locator(".buscador-alumno input").fill("García, Ana · nº 1")
        d.locator("input[type=file]").set_input_files({"name": "dni.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 test"})
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(700)
        dd = db(pg, "al_documentos_familia")
        check(len(dd) == 1 and dd[0]["alumno_id"] == "a1" and dd[0]["tipo"] == "dni_responsable" and dd[0]["ruta"], "documento subido y registrado con su ruta")
        up = pg.evaluate("window.__mock.uploads || []")
        check(len(up) == 1 and up[0].startswith("a1/"), f"el archivo se guarda en la carpeta del alumno {up}")

        print("9. actividades: apuntar e importar del formulario")
        ir(pg, "al_actividades")
        pg.get_by_role("button", name="+ Nueva actividad").click(); pg.wait_for_timeout(300)
        d = pg.locator(".drawer"); d.get_by_label("Nombre").fill("Salida a la granja"); d.get_by_label("Plazas").fill("1")
        d.get_by_label("Formulario de inscripción").select_option(label="Salida granja")
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(600)
        ac = db(pg, "al_actividades")
        check(len(ac) == 1 and ac[0]["formulario_id"] == "f1" and ac[0]["plazas"] == 1, "actividad creada con su formulario")
        pg.get_by_text("Salida a la granja").first.click(); pg.wait_for_timeout(500)
        d = pg.locator(".drawer"); d.locator(".al-barra .buscador-alumno input").fill("García, Ana · nº 1"); d.get_by_role("button", name="Apuntar", exact=True).click(); pg.wait_for_timeout(500)
        d.get_by_role("button", name="Importar apuntados del formulario").click(); pg.wait_for_timeout(700)
        ins = {x["alumno_id"]: x for x in db(pg, "al_actividad_inscritos")}
        check(ins["a1"]["estado"] == "apuntado" and ins["a2"]["estado"] == "lista_espera" and ins["a2"]["respuesta_id"] == "fr1", "Ana apuntada; Luis, importado del formulario, queda en lista de espera por falta de plazas")
        d.get_by_role("button", name="Cerrar").click()
        ir(pg, "al_ficha")
        check("Salida a la granja" in pg.locator("main").inner_text() and "apuntado/a" in pg.locator("main").inner_text(), "la ficha del alumno muestra que está apuntado a la actividad")
        pg.close()

        print("9b. Study Club: sesiones, temario, profesora, apuntados y calendario")
        pg = abrir(b, "admin", "al_studyclub")
        check(pg.locator("main").inner_text().count("Past Simple") >= 1 and "por definir" in pg.locator("main").inner_text(), "lista las sesiones con su temario y las que no tienen")
        pg.get_by_text("por definir").first.click(); pg.wait_for_timeout(400)
        d = pg.locator(".drawer"); d.get_by_label("Temario que se repasa").fill("Present Perfect"); d.get_by_label("Profesora").select_option(label="Mar Franco")
        check(d.get_by_role("link", name="Añadir a Google Calendar").get_attribute("href").startswith("https://calendar.google.com/calendar/render?"), "enlace a Google Calendar de la sesión")
        d.get_by_role("button", name="Guardar").click(); pg.wait_for_timeout(600)
        s2 = [x for x in db(pg, "al_studyclub_sesiones") if x["id"] == "sc2"][0]
        check(s2["titulo"] == "Present Perfect" and s2["profesora_id"] == "p1", f"temario y profesora guardados {s2.get('titulo')}")
        pg.get_by_text("Past Simple").first.click(); pg.wait_for_timeout(400)
        d = pg.locator(".drawer"); d.locator(".al-barra input[type=text]").first.fill("Luis Pérez"); d.get_by_role("button", name="Apuntar", exact=True).click(); pg.wait_for_timeout(500)
        rs = db(pg, "al_studyclub_reservas")
        check(len(rs) == 2 and rs[1]["origen"] == "manual", "se apunta a mano a un alumno")
        d.get_by_role("button", name="Cancelar plaza").first.click(); pg.wait_for_timeout(400)
        check(db(pg, "al_studyclub_reservas")[0]["estado"] == "cancelado", "se cancela una plaza")
        d.get_by_role("button", name="Cerrar").click()
        pg.get_by_role("tab", name="Calendario por profesora").click(); pg.wait_for_timeout(300)
        check("Mar Franco" in pg.locator("main").inner_text(), "calendario semanal por profesora")
        pg.get_by_role("tab", name="Calendario mensual").click(); pg.wait_for_timeout(300)
        for _ in range(3):
            if pg.locator(".sc-chip", has_text="Past Simple").count(): break
            pg.get_by_role("button", name="Siguiente ›").click()
        check(pg.locator(".sc-chip", has_text="Past Simple").count() == 1, "el mes de la sesión muestra su chip en el calendario mensual")
        pg.locator(".sc-dia.con", has=pg.locator(".sc-chip", has_text="Past Simple")).hover(); pg.wait_for_timeout(250)
        pop = pg.locator(".sc-pop").inner_text()
        check("Mar Franco" in pop and "Past Simple" in pop, f"el popup del día muestra la profesora y el temario")
        pg.close()

        print("10. profesora: ve las pestañas de lo suyo y no la documentación")
        pg = abrir(b, "profesora", "al_ficha")
        tt = [t.strip() for t in pg.locator(".tabs .tab").all_inner_texts()]
        check(tt == ["Ficha", "Notas", "Tareas y material", "Informes y notas", "Comunicaciones", "Actividades", "Study Club", "Configuración"], f"profesora: pestañas {tt}")
        ir(pg, "al_documentos")
        check(pg.locator(".tabs .tab[aria-current=page]").inner_text().strip() == "Ficha" and pg.get_by_role("heading", name="Documentación de familias").count() == 0, "la profesora no puede abrir Documentación (vuelve a su primera pantalla)")
        ir(pg, "al_actividades")
        check(pg.get_by_role("button", name="+ Nueva actividad").count() == 0, "la profesora no crea actividades (solo ve)")
        ir(pg, "al_notas")
        check(pg.get_by_role("button", name="+ Nueva nota").count() == 1, "la profesora sí puede apuntar notas")
        pg.close()

    check(not errores, f"sin errores de JavaScript: {errores[:3]}")
    print(f"\nTODO OK ({ok} comprobaciones)")
finally:
    srv.terminate()
