#!/usr/bin/env python3
"""Copia el motor de formularios compartido (forms/render.js y forms/fp.css) a la app para la vista previa del editor.
Uso: python3 scripts/sync_forms.py [--check]   (--check falla si las copias no están al día; lo usa el test)"""
import sys, pathlib
R = pathlib.Path(__file__).resolve().parent.parent
PARES = [(R/'forms/render.js', R/'app/js/academia/formrender.js'), (R/'forms/fp.css', R/'app/css/fp.css')]
ok = True
for a, b in PARES:
    if '--check' in sys.argv:
        if not b.exists() or a.read_text() != b.read_text(): print('DESACTUALIZADO:', b); ok = False
    else: b.write_text(a.read_text()); print('copiado', b.relative_to(R))
sys.exit(0 if ok else 1)
