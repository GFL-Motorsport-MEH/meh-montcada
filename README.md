# MEH Montcada · Gestión

App web de contabilidad de My English House Montcada (sustituye poco a poco al Excel
"Montcada - Accountancy Control").

- `app/`: la web (HTML + módulos JS, sin compilación). Netlify publica esta carpeta.
- `supabase/migrations/`: estructura y seguridad de la base de datos (Supabase).
- `scripts/`: extracción de datos del Excel y generación de CSV de carga.
- `test/`: prueba de extremo a extremo con Playwright y un Supabase simulado
  (`python3 test/test_app.py`; necesita `test/fixtures.json`, que no se sube porque contiene datos reales).

Los datos reales nunca se suben a este repositorio.
