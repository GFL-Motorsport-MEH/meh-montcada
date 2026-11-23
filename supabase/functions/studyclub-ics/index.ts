import { createClient } from 'npm:@supabase/supabase-js@2';

// Calendario .ics de Study Club por profesora (suscribible desde Google Calendar / Apple / Outlook).
// GET ?t=<token>  -> sesiones de esa profesora (sin datos personales de los alumnos). Sin verificación JWT: el token es el secreto.

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (l: string) => {
  const out: string[] = []; let s = l;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); }
  out.push(s); return out.join('\r\n');
};
const ymdhm = (fecha: string, hora: string) => fecha.replace(/-/g, '') + 'T' + hora.slice(0, 5).replace(':', '') + '00';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response('Not found', { status: 404 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: t } = await sb.from('al_studyclub_ics').select('profesora_id, ac_profesoras(nombre)').eq('token', token).maybeSingle();
  if (!t) return new Response('Not found', { status: 404 });

  const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const { data: ses } = await sb.from('al_studyclub_sesiones')
    .select('id, fecha, hora_inicio, hora_fin, titulo, plazas, estado, notas')
    .eq('profesora_id', t.profesora_id).neq('estado', 'cancelada').gte('fecha', desde).order('fecha');
  const ids = (ses ?? []).map((s) => s.id);
  const ocup: Record<string, number> = {};
  if (ids.length) {
    const { data: rs } = await sb.from('al_studyclub_reservas').select('sesion_id').in('sesion_id', ids).eq('estado', 'apuntado');
    for (const r of rs ?? []) ocup[r.sesion_id] = (ocup[r.sesion_id] ?? 0) + 1;
  }

  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My English House//Study Club//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Study Club - ' + esc(String((t as any).ac_profesoras?.nombre ?? '')), 'X-WR-TIMEZONE:Europe/Madrid',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Madrid',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const s of ses ?? []) {
    const n = ocup[s.id] ?? 0;
    const cerrada = s.estado === 'cerrada';
    L.push('BEGIN:VEVENT', `UID:${s.id}@studyclub.myenglishhouse`, `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Madrid:${ymdhm(s.fecha, s.hora_inicio)}`, `DTEND;TZID=Europe/Madrid:${ymdhm(s.fecha, s.hora_fin)}`,
      fold('SUMMARY:' + esc(`Study Club${s.titulo ? ': ' + s.titulo : ''}${cerrada ? ' (cerrada)' : ''}`)),
      fold('DESCRIPTION:' + esc(`Temario: ${s.titulo ?? 'por definir'}\nApuntados: ${n}/${s.plazas}`)),
      'LOCATION:My English House', 'STATUS:' + (cerrada ? 'CANCELLED' : 'CONFIRMED'), 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return new Response(L.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=900', 'Content-Disposition': 'inline; filename="study-club.ics"' },
  });
});
