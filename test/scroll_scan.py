"""Busca scroll lateral en todas las pantallas y pestañas. Uso: python3 test/scroll_scan.py 1280 1366 1536 1920"""
import re, subprocess, sys, time, pathlib, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent; WEB, TEST = ROOT / "app", ROOT / "test"
SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
E = json.load(open(TEST / "esperados.json", encoding="utf-8"))
anchos = [int(a) for a in sys.argv[1:]] or [1280, 1366, 1440, 1536, 1920]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "--bind", "127.0.0.1"], cwd=WEB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)
MED = """() => { const r = []; const d = document.documentElement; if (d.scrollWidth > d.clientWidth + 1) r.push('PÁGINA +' + (d.scrollWidth - d.clientWidth));
  document.querySelectorAll('.table-wrap, .card, .dialog, main *').forEach(e => { const cs = getComputedStyle(e); if (!/(auto|scroll)/.test(cs.overflowX)) return;
    if (e.scrollWidth > e.clientWidth + 1 && e.offsetParent) { const t = e.querySelector('table'); r.push((t ? 'tabla.' + [...t.classList].join('.') : e.className) + ' +' + (e.scrollWidth - e.clientWidth)); } }); const cort = [...document.querySelectorAll('table.balance td, table.balance tfoot th, table.grid-ing td, table.grid-ing input, table.tabla-factcheck td, table.tabla-factcheck input, table.tabla-fact td.num')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1);
  if (cort.length) r.push('CIFRAS CORTADAS: ' + cort.length + ' p.ej. ' + (cort[0].value || cort[0].textContent));
  return [...new Set(r)]; }"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for W in anchos:
            page = b.new_page(viewport={"width": W, "height": 900})
            page.route(SUPA, lambda r: r.fulfill(path=str(TEST / "mock-supabase.js"), content_type="application/javascript"))
            page.route("**/__fixtures.json", lambda r: r.fulfill(path=str(TEST / "fixtures.json"), content_type="application/json"))
            page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
            page.goto("http://127.0.0.1:8767/")
            page.get_by_label("Email").fill(E["admin_email"]); page.get_by_label("Contraseña").fill("secreto123")
            page.get_by_role("button", name="Entrar").click(); page.locator(".kpi").first.wait_for(timeout=10000)
            print(f"===== {W}px")
            for ruta in ["panel", "gastos", "ingresos", "balance", "facturacion", "control", "config", "usuarios", "academia"]:
                page.goto(f"http://127.0.0.1:8767/#/{ruta}"); page.wait_for_timeout(1200)
                tabs = page.locator("main [role=tab]").all_inner_texts() or [""]
                for t in tabs:
                    if t:
                        page.locator("main [role=tab]", has_text=t).first.click(); page.wait_for_timeout(900)
                    res = page.evaluate(MED)
                    if res: print(f"  {ruta}{' > ' + t if t else ''}: {res}")
            page.close()
finally:
    srv.terminate()
