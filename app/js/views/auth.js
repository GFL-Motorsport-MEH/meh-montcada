import { h, clear } from '../ui.js';
import { login, pedirResetPassword, cambiarPassword, logout } from '../db.js';

function marca() {
  return h('div', { class: 'auth-brand' },
    h('div', { class: 'brand-mark' }, 'M'),
    h('div', {}, h('div', { class: 'brand-name' }, 'My English House — Montcada'), h('div', { class: 'brand-sub' }, 'Gestión y contabilidad')));
}

function pantalla(root, ...contenido) {
  clear(root, h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' }, marca(), ...contenido)));
}

function errorBox() {
  const box = h('div', { class: 'banner error', role: 'alert', hidden: true });
  return { box, set(msg) { box.textContent = msg || ''; box.hidden = !msg; } };
}

export function renderLogin(root, { onLogin, mensaje, error } = {}) {
  const err = errorBox();
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.set('');
      btn.disabled = true; btn.textContent = 'Entrando…';
      try {
        await login(email.value.trim(), pass.value);
        await onLogin();
      } catch (ex) {
        err.set(ex.message);
        btn.disabled = false; btn.textContent = 'Entrar';
      }
    },
  },
  h('label', { class: 'field' }, 'Email', email),
  h('label', { class: 'field' }, 'Contraseña', pass),
  btn);
  if (error) err.set(error);
  pantalla(root,
    h('h2', {}, 'Iniciar sesión'),
    mensaje ? h('div', { class: 'banner ok' }, mensaje) : null,
    err.box, form,
    h('div', { class: 'small muted' },
      h('button', { class: 'link-btn', type: 'button', onclick: () => renderRecuperar(root, { onLogin }) }, '¿Has olvidado la contraseña?'),
      h('br'), 'Si no tienes cuenta, pídesela a Gustavo.'));
}

function renderRecuperar(root, { onLogin }) {
  const err = errorBox();
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, autofocus: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Enviar enlace');
  pantalla(root,
    h('h2', {}, 'Recuperar contraseña'),
    h('div', { class: 'small muted' }, 'Te enviaremos un enlace por email para elegir una contraseña nueva.'),
    err.box,
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.set('');
        btn.disabled = true; btn.textContent = 'Enviando…';
        try {
          await pedirResetPassword(email.value.trim());
          renderLogin(root, { onLogin, mensaje: 'Si el email está dado de alta, te llegará un enlace en unos minutos. Revisa también la carpeta de spam.' });
        } catch (ex) { err.set(ex.message); btn.disabled = false; btn.textContent = 'Enviar enlace'; }
      },
    }, h('label', { class: 'field' }, 'Email', email), btn),
    h('button', { class: 'link-btn small', type: 'button', onclick: () => renderLogin(root, { onLogin }) }, 'Volver'));
}

export function renderNuevaPassword(root, { titulo, onDone, onCancel }) {
  const err = errorBox();
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true, autofocus: true });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar contraseña');
  pantalla(root,
    h('h2', {}, titulo),
    h('div', { class: 'small muted' }, 'Mínimo 8 caracteres.'),
    err.box,
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.set('');
        if (p1.value.length < 8) return err.set('La contraseña debe tener al menos 8 caracteres.');
        if (p1.value !== p2.value) return err.set('Las dos contraseñas no coinciden.');
        btn.disabled = true; btn.textContent = 'Guardando…';
        try { await cambiarPassword(p1.value); await onDone(); } catch (ex) { err.set(ex.message); btn.disabled = false; btn.textContent = 'Guardar contraseña'; }
      },
    },
    h('label', { class: 'field' }, 'Contraseña nueva', p1),
    h('label', { class: 'field' }, 'Repite la contraseña', p2),
    btn),
    onCancel ? h('button', { class: 'link-btn small', type: 'button', onclick: onCancel }, 'Cancelar') : null);
}

export function renderPendiente(root, { email, onReintentar }) {
  pantalla(root,
    h('h2', {}, 'Cuenta pendiente de activar'),
    h('div', {}, 'Has entrado como ', h('strong', {}, email), '. Un administrador tiene que activar tu cuenta antes de que puedas ver los datos.'),
    h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' },
      h('button', { class: 'btn primary', onclick: onReintentar }, 'Ya me han activado'),
      h('button', { class: 'btn', onclick: async () => { await logout(); } }, 'Cerrar sesión')));
}
