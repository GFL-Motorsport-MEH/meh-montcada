// Crear un alumno a partir de la foto (o PDF) de su ficha: se lee con el servicio de la función «escanear-ficha»
// y se abre la ficha de «Nuevo alumno» rellena, para que la persona la revise antes de crearla.
import { h, toast } from '../ui.js';
import * as api from './api.js';
import { drawer } from './kit.js';

// reduce la foto (los móviles hacen fotos de 5-10 MB): máximo 1800 px de lado, JPEG
function reducir(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se puede abrir esa imagen.')); };
    img.src = url;
  });
}
const aBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });

// convierte lo leído en los campos de la ficha (alumno + responsable + dudas)
export function aPrefill(d) {
  const x = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
  const al = d?.alumno || {}; const re = d?.responsable || {};
  return {
    alumno: {
      apellidos: x(al.apellidos) || '', nombre: x(al.nombre) || '', fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(al.fecha_nacimiento || '') ? al.fecha_nacimiento : null,
      colegio: x(al.colegio), intolerancias: x(al.alergias), autoriza_rrss: al.autoriza_rrss === true, modalidad: x(al.modalidad), nivel: x(al.nivel),
      metodo_pago: x(al.metodo_pago), como_nos_conocio: x(al.como_nos_conocio), codigo_postal: x(al.codigo_postal), info: x(al.comentarios),
    },
    responsable: { apellidos: x(re.apellidos) || '', nombre: x(re.nombre) || '', email: x(re.email), telefono: x(re.telefono) },
    dni: x(re.dni), iban: x(re.iban) ? String(re.iban).replace(/\s+/g, '').toUpperCase() : null,
    dudas: Array.isArray(d?.dudas) ? d.dudas.map(String).filter(Boolean) : [],
  };
}

// abre el panel de escaneo; al leer la ficha llama a onLeido(prefill)
export function abrirEscaneo(onLeido) {
  const d = drawer({ titulo: 'Nuevo alumno desde una foto', ancho: 520 });
  const estado = h('div', { class: 'small muted', role: 'status' });
  const entrada = h('input', { type: 'file', accept: 'image/*,application/pdf', style: 'display:none', 'aria-label': 'Foto o PDF de la ficha' });
  const camara = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', 'aria-label': 'Hacer una foto' });
  async function procesar(file) {
    if (!file) return;
    estado.textContent = 'Leyendo la ficha… puede tardar unos segundos.';
    try {
      const pdf = file.type === 'application/pdf';
      if (pdf && file.size > 5e6) throw new Error('El PDF es demasiado grande (máximo 5 MB).');
      const datos = await api.escanearFicha(pdf ? await aBase64(file) : await reducir(file), pdf ? 'application/pdf' : 'image/jpeg');
      d.cerrar();
      onLeido(aPrefill(datos));
    } catch (ex) { estado.textContent = ''; toast(ex.message, 'error'); estado.textContent = ex.message; }
  }
  entrada.addEventListener('change', () => procesar(entrada.files[0]));
  camara.addEventListener('change', () => procesar(camara.files[0]));
  d.cuerpo.append(h('div', { class: 'form-section' },
    h('p', { class: 'full' }, 'Haz una foto de la ficha de inscripción (o sube un PDF). Se leerán los datos y se abrirá la ficha del alumno rellena para que la revises antes de crearla: no se guarda nada hasta que pulses «Crear alumno».'),
    h('div', { class: 'ac-fila full' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => camara.click() }, 'Hacer foto'),
      h('button', { class: 'btn', type: 'button', onclick: () => entrada.click() }, 'Elegir imagen o PDF')),
    h('div', { class: 'small muted full' }, 'La imagen se envía solo para leerla y no se conserva. Si la ficha tiene varios hijos, se lee el primero.'), estado, entrada, camara));
  d.pie.append(h('span'), h('button', { class: 'btn', type: 'button', onclick: d.cerrar }, 'Cerrar'));
}
