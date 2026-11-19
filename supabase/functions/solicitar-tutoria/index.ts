// Función antigua (sustituida por «formulario»). Se deja respondiendo 410 para que ningún enlace viejo escriba nada.
Deno.serve(() => new Response(JSON.stringify({ error: 'Este formulario se ha movido. Pide el enlace nuevo a la academia.' }), { status: 410, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }));
