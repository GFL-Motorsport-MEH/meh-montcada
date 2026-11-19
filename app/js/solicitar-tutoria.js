// Formulario público de solicitud de tutorías. No usa sesión: envía a la función «solicitar-tutoria».
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const HORAS = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '19:00', '19:30', '20:00'];
const $ = (id) => document.getElementById(id);

const t = $('rejilla');
t.innerHTML = '<thead><tr><th></th>' + DIAS.map((d) => `<th>${d}</th>`).join('') + '</tr></thead><tbody>'
  + HORAS.map((hh) => `<tr><td>${hh}h</td>` + DIAS.map((d) => `<td><input type="checkbox" data-dia="${d}" data-hora="${hh}" aria-label="${d} ${hh}"></td>`).join('') + '</tr>').join('') + '</tbody>';

const error = (m) => { $('error').textContent = m; $('error').hidden = !m; };

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  error('');
  const asiste = document.querySelector('input[name=asiste]:checked')?.value;
  const disponibilidad = [...t.querySelectorAll('input:checked')].map((i) => ({ dia: i.dataset.dia, hora: i.dataset.hora }));
  const datos = { email: $('email').value, alumno: $('alumno').value, adulto: $('adulto').value, tema: $('tema').value, asiste: asiste === 'si' ? true : asiste === 'no' ? false : null, disponibilidad, web: $('web').value };
  if (!datos.email.trim() || !datos.alumno.trim() || !datos.adulto.trim() || !datos.tema.trim()) return error('Completa todos los campos marcados con *.');
  if (datos.asiste === null) return error('Indica si necesitas que asista la profesora.');
  if (!disponibilidad.length) return error('Marca al menos un día y hora que te vengan bien.');
  $('enviar').disabled = true;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/solicitar-tutoria`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(datos) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se ha podido enviar. Inténtalo de nuevo.');
    $('f').hidden = true; $('hecho').hidden = false; window.scrollTo(0, 0);
  } catch (ex) { error(ex.message); } finally { $('enviar').disabled = false; }
});
