"""Capturas rápidas para revisar el diseño (usa el mismo Supabase simulado que test_app.py).
Uso: python3 test/shots.py ruta[:modo] ... [--ancho 1366] [--alto 900]
  p.ej. python3 test/shots.py gastos balance:curso facturacion academia
"""
import re, subprocess, sys, time, pathlib, json
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB, TEST = ROOT / "app", ROOT / "test"
SHOTS = TEST / "shots"; SHOTS.mkdir(exist_ok=True)
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
av = sys.argv[1:]
args = [a for i, a in enumerate(av) if not a.startswith("--") and not (i and av[i - 1].startswith("--"))]
opt = dict(zip(sys.argv[1:], sys.argv[2:]))
W, H = int(opt.get("--ancho", 1366)), int(opt.get("--alto", 900))
E = json.load(open(TEST / "esperados.json", encoding="utf-8"))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "--bind", "127.0.0.1"], cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": W, "height": H})
        page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase.js"), content_type="application/javascript"))
        page.route("**/__fixtures.json", lambda r: r.fulfill(path=str(TEST / "fixtures.json"), content_type="application/json"))
        page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto("http://127.0.0.1:8766/")
        page.get_by_label("Email").fill(E["admin_email"]); page.get_by_label("Contraseña").fill("secreto123")
        page.get_by_role("button", name="Entrar").click()
        page.locator(".kpi").first.wait_for(timeout=10000)
        for a in args:
            ruta, _, modo = a.partition(":")
            page.goto(f"http://127.0.0.1:8766/#/{ruta}")
            page.wait_for_timeout(700)
            if modo:
                page.get_by_role("tab", name=re.compile(modo, re.I)).first.click(); page.wait_for_timeout(500)
            sw = page.evaluate("[document.documentElement.scrollWidth, ...[...document.querySelectorAll('.table-wrap')].map(e => e.scrollWidth - e.clientWidth)]")
            nombre = f"dev-{ruta}{'-' + modo if modo else ''}-{W}.png".replace(" ", "_")
            page.screenshot(path=str(SHOTS / nombre))
            print(nombre, "scroll(página, tablas):", sw)
        print("errores:", errs)
finally:
    srv.terminate()
