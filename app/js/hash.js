// Se importa ANTES que db.js: guarda los parámetros que Supabase deja en la URL
// al volver de un email (invitación, recuperar contraseña o error), antes de
// que el cliente de Supabase los consuma y limpie la URL.
function leer() {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (!/access_token=|error=|type=/.test(raw)) return {};
  const p = new URLSearchParams(raw);
  return {
    type: p.get('type'),
    error: p.get('error'),
    errorCode: p.get('error_code'),
    errorDescription: p.get('error_description'),
  };
}
export const authHash = leer();
