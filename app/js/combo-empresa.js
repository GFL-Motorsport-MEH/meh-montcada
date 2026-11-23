// Casilla de proveedor con desplegable: filtra el listado de empresas por nombre comercial, razón social o CIF,
// pero se puede escribir cualquier otro nombre. getEmpresas() devuelve [{ nombre_comercial, razon_social, cif, _k }].
import { h, normalizar } from './ui.js';

export function comboEmpresa(input, getEmpresas, alElegir) {
  const lista = h('ul', { class: 'combo-lista', role: 'listbox', hidden: true });
  const caja = h('div', { class: 'combo' }, input, lista);
  let activo = -1, items = [];
  const cerrar = () => { lista.hidden = true; activo = -1; };
  const elegir = (e) => { input.value = e.nombre_comercial; cerrar(); alElegir(e); };
  const pintar = () => {
    const k = normalizar(input.value).trim();
    items = (k ? getEmpresas().filter((e) => k.split(/\s+/).every((w) => e._k.includes(w))) : getEmpresas()).slice(0, 12);
    lista.replaceChildren(...items.map((e, i) => h('li', { role: 'option', class: i === activo ? 'activo' : '', onmousedown: (ev) => { ev.preventDefault(); elegir(e); } },
      h('strong', {}, e.nombre_comercial), e.razon_social && normalizar(e.razon_social) !== normalizar(e.nombre_comercial) ? h('span', { class: 'muted small' }, ` · ${e.razon_social}`) : null, e.cif && e.cif.length <= 12 ? h('span', { class: 'muted small' }, ` · ${e.cif}`) : null)));
    lista.hidden = !items.length;
  };
  input.addEventListener('input', () => { activo = -1; pintar(); });
  input.addEventListener('focus', pintar);
  input.addEventListener('blur', () => setTimeout(cerrar, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (lista.hidden) pintar(); activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1); pintar(); }
    else if (e.key === 'Enter' && !lista.hidden && activo >= 0) { e.preventDefault(); elegir(items[activo]); }
    else if (e.key === 'Escape') cerrar();
  });
  return caja;
}

