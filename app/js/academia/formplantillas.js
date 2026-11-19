// Plantillas incluidas de serie (copiadas de los formularios de Google de la academia). Al crear un formulario nuevo se ofrecen
// junto a las plantillas que el personal guarde en la base de datos. Son una COPIA: se pueden cambiar todo lo que se quiera.
const t = (id, etiqueta, o = {}) => ({ id, tipo: 'texto', etiqueta, ...o });
const radio = (id, etiqueta, opciones, o = {}) => ({ id, tipo: 'radio', etiqueta, opciones, ...o });
const info = (id, etiqueta, ayuda) => ({ id, tipo: 'info', etiqueta, ayuda });
const seccion = (id, etiqueta, ayuda, si) => ({ id, tipo: 'seccion', etiqueta, ...(ayuda ? { ayuda } : {}), ...(si ? { si } : {}) });
const req = { requerido: true };

// ---------------- Prematrículas ----------------
const PREMATRICULAS = {
  titulo: '¡Prematrículas abiertas curso 2026/2027!', tipo: 'generico', plantilla: false, activo: true,
  descripcion: '¡No esperes más que las plazas vuelan! 🚀✨\n\nReserva ya la matrícula del curso que viene para que tus hijos no se pierdan el inglés que está revolucionando Montcada i Reixac. Tenemos clases para bebés, niños, adolescentes y adultos, ¡para toda la familia! 🌈',
  mensaje_final: '¡Gracias! Hemos recibido la prematrícula. Nos pondremos en contacto contigo lo más rápido posible para terminar de tramitar la reserva. Recuerda: la plaza no es oficial hasta que se realice el pago del material y confirmemos que el horario está disponible.',
  config: { cabecera: 'banner' },
  campos: [
    info('aviso', '', 'Hasta el **21 de abril** las prematrículas son únicamente para nuestros alumnos actuales, con prioridad sobre los nuevos alumnos, que podrán apuntarse a partir de esa fecha.\n\n⚠️ **LA RESERVA DE LA PLAZA NO SERÁ OFICIAL HASTA QUE NO SE REALICE EL PAGO DEL MATERIAL CORRESPONDIENTE Y CONFIRMEMOS QUE EL HORARIO SELECCIONADO ESTÁ DISPONIBLE**\n\nPara rellenar correctamente el formulario, sigue todos los pasos. En la elección de horarios, rellena únicamente el grupo al que corresponda: BABIES, KIDS, TEENS o ADULTS.'),
    info('grupos', '✨ ¿Qué grupos tenemos?', '- **BABIES** (de 1 a 2 años): clases de 50 minutos, 1 día a la semana.\n- **KIDS** (de 3 a 12 años): trabajamos por talleres. Clases de 1 hora, 1 o 2 días a la semana. Los grupos de 2 días se pueden combinar: Lunes y Miércoles / Lunes y Jueves / Lunes y Viernes / Martes y Jueves / Martes y Miércoles / Martes y Viernes.\n- **TEENS** (de 13 a 18 años): valoramos primero su nivel para ir al grupo correspondiente (A2 - B1 - B2 - C1). Clases de 1 hora, 2 días a la semana, o de 2 horas, 1 día a la semana.\n- **ADULTS**: cursos de nivel (A2 - B1 - B2 - C1), speaking o preparación de examen. Clases de 1,5 horas, 2 días a la semana.\n\nComo guía, los cursos se dividen por año de nacimiento: BABIES 2024-2025 · KIDS 2014-2023 · TEENS 2008-2014 · ADULTS mayores de 16 años.'),
    info('precios', '🚀 Sin coste de matrícula', 'Solo hay un coste de material que se paga al inicio del curso y que a la vez sirve como reserva de plaza para garantizar horario y grupo.\n\n- **BABIES: 25 €** (pago único anual). Material para las actividades y talleres: manualidades, experimentos y recetas.\n- **KIDS: 90 €** (pago único anual). Mochila, libro y todo el material de proyectos de ciencias, manualidades y cocina.\n- **TEENS y ADULTS: 65 €** (pago único anual). Bolsa, carpeta, libro oficial del nivel y libro interactivo de My English House.\n\n🔔 El pago se ha de efectuar antes del **11 de mayo de 2026**. Si eliges transferencia te enviaremos los datos bancarios. Si eliges tarjeta o efectivo, el pago se hace en el centro.'),
    info('extraescolares', '✨ Extraescolares (colegios)', '**Mas Rampinyo.** Curso de extraescolar al mediodía en la academia; recogemos y devolvemos al colegio a los alumnos de L3, L4 y L5. Martes y jueves de 13:30 a 14:30 (L3, L4 y L5 de 6º de Primaria); miércoles y viernes de 15:00 a 16:00 (L5 de 1º de la ESO).\n\n**Elvira Cuyas.** Un día a la semana, de L1 a L5: lunes L1, martes L2, miércoles L3, jueves L4, viernes L5, de 13:45 a 14:45.\n\n**Fedac.** Un día a la semana: miércoles 13:40-14:40 (L1) y viernes 13:40-14:40 (L2).\n\n⚠️ Los horarios de las extraescolares son informativos, basados en el curso anterior, y se ajustarán según decida el AFA de cada colegio. Los horarios no serán 100 % seguros hasta que se formen todos los grupos; puedes solicitar cambios siempre que haya plazas.'),
    info('contacto', '✨ ¿Necesitas más información?', 'Llámanos o escríbenos por WhatsApp. Puedes seguirnos en Instagram (@myenglishhousemontcada) y Facebook (My English House Montcada). Nos encontramos en la zona de Mas Rampinyo, Montcada.\n\n*(Aquí puedes añadir los enlaces al folleto, a WhatsApp, al vídeo y al mapa con la barra «Enlace».)*'),
    seccion('datos', 'Datos del alumno'),
    t('email', 'Correo electrónico', { tipo: 'email', ...req }),
    t('telefono', 'Teléfono de contacto', { tipo: 'telefono', ...req }),
    t('alumno', 'Nombre completo del alumno', { ...req, ayuda: '¡Por favor! Una prematrícula por alumno. Si hay hermanos, realiza el proceso tantas veces como hermanos sean.', google: ['nombre alumno'] }),
    t('adulto', 'Nombre completo del adulto', req),
    { id: 'fecha_nacimiento', tipo: 'fecha', etiqueta: 'Fecha de nacimiento del alumno', ...req },
    t('colegio', '¿A qué colegio pertenece el alumno?', req),
    radio('es_alumno', '¿Actualmente es alumno de nuestra academia?', ['Sí', 'No', 'Lo he sido en el pasado'], req),
    radio('pago_material', '¿Cómo quieres pagar el material del curso?', ['Efectivo (en la academia)', 'Tarjeta (pago por TPV en la academia)', 'Transferencia (te mandamos los datos bancarios por mensaje)'], req),
    radio('curso', 'Curso de interés', ['BABIES', 'KIDS', 'TEENS', 'ADULTS'], req),
    seccion('p_babies', 'Horarios BABIES', 'Indica los días y horas que mejor te vienen. Confirmaremos la disponibilidad antes de reservar.', { campo: 'curso', op: 'es', valor: 'BABIES' }),
    { id: 'horario_babies', tipo: 'textarea', etiqueta: 'Horarios que te interesan (BABIES)', ayuda: 'Día y hora. Puedes dar varias opciones por orden de preferencia.', requerido: true },
    seccion('p_kids', 'Horarios KIDS', 'Indica los días y horas que mejor te vienen. Los grupos de 2 días se pueden combinar (Lunes y Miércoles, Lunes y Jueves, Martes y Jueves…).', { campo: 'curso', op: 'es', valor: 'KIDS' }),
    { id: 'horario_kids', tipo: 'textarea', etiqueta: 'Horarios que te interesan (KIDS)', ayuda: 'Día(s) y hora. Puedes dar varias opciones por orden de preferencia.', requerido: true },
    seccion('p_teens', 'Horarios TEENS', 'Valoraremos primero su nivel para asignarle el grupo.', { campo: 'curso', op: 'es', valor: 'TEENS' }),
    radio('nivel_teens', 'Nivel que crees que tiene', ['A2', 'B1', 'B2', 'C1', 'No lo sé (necesita prueba de nivel)']),
    { id: 'horario_teens', tipo: 'textarea', etiqueta: 'Horarios que te interesan (TEENS)', ayuda: 'Día(s) y hora. Puedes dar varias opciones por orden de preferencia.', requerido: true },
    seccion('p_adults', 'Horarios ADULTS', 'Cursos de nivel, speaking o preparación de examen.', { campo: 'curso', op: 'es', valor: 'ADULTS' }),
    radio('nivel_adults', 'Nivel que crees que tienes', ['A2', 'B1', 'B2', 'C1', 'No lo sé (necesito prueba de nivel)']),
    { id: 'horario_adults', tipo: 'textarea', etiqueta: 'Horarios que te interesan (ADULTS)', ayuda: 'Día(s) y hora. Puedes dar varias opciones por orden de preferencia.', requerido: true },
  ],
};

// ---------------- Summer Camp ----------------
const SEMANAS = ['Semana del 22 de junio al 26 de junio', 'Semana del 29 de junio al 3 de julio', 'Semana del 6 al 10 de julio', 'Semana del 13 al 17 de julio', 'Semana del 20 al 24 de julio', 'Semana del 27 al 31 de julio', 'Semana del 31 de agosto al 4 de septiembre'];
const CAMPAMENTO = {
  titulo: 'Summer Camp 2026', tipo: 'generico', plantilla: false, activo: true,
  descripcion: 'Welcome to My English House Summer Camp! 🥰\n\nEste verano te traemos un súper casal en nuestro centro donde vuestros hijos aprenderán inglés a la vez que se divierten y disfrutan con nuestros increíbles talleres.',
  mensaje_final: '¡Gracias! Hemos recibido la solicitud. Te enviaremos todo lo necesario para la reserva de plaza. Recuerda: el pago se ha de efectuar antes del 15 de junio o la plaza quedará cancelada. ¡See you soon! 🚀',
  config: { cabecera: 'banner' },
  campos: [
    info('horarios', 'Horarios disponibles', '🍋 **Bon dia:** de 8 a 9 h\n🍋 **Casal:** de 9 a 14 h\n🍋 **Hora de menjar:** de 14 a 16 h\n🍋 **Bona tarda:** de 16 a 17 h\n\n*Para la hora de comer, los alumnos podrán traer su tupper y todo lo necesario. Comerán todo el grupo junto a la profesora.*\n\n*Para bon dia, menjador y bona tarda será necesario un mínimo de alumnos, por lo que estos servicios no son seguros hasta la confirmación directa a cada familia.*'),
    info('actividades', '✨ ¿Qué actividades haremos?', 'Cocina, jardinería, ciencia, robótica, teatro, medios de comunicación, manualidades… Compaginaremos las actividades dentro de la academia con actividades al aire libre en las cercanías. ¡No hay límite para el aprendizaje! El precio incluye el material y los ingredientes de todos los talleres y de todo lo que se lleven a casa. Cuando se acerque la fecha compartiremos un planning detallado.'),
    info('fechas', '✨ ¿Qué fechas están disponibles?', SEMANAS.map((s) => '☀️ ' + s).join('\n') + '\n\n⚠️ **EL PAGO DEL SUMMER CAMP SE HA DE EFECTUAR ANTES DEL 15 DE JUNIO O LA PLAZA QUEDARÁ AUTOMÁTICAMENTE CANCELADA.**\n\n⚠️ Las inscripciones estarán abiertas hasta el 15 de junio de 2026, siempre que queden plazas. Las plazas son limitadas.'),
    info('contacto', '✨ ¿Necesitas más información?', 'Llámanos o escríbenos por WhatsApp. Síguenos en Instagram (@myenglishhousemontcada) y Facebook (My English House Montcada). Estamos en la zona de Mas Rampinyo, Montcada.\n\n*(Aquí puedes añadir los enlaces al folleto, a WhatsApp, al vídeo y al mapa con la barra «Enlace».)*'),
    { id: 'email', tipo: 'email', etiqueta: 'Correo electrónico', ...req },
    t('alumno', 'Nombre completo del alumno'),
    t('adulto', 'Nombre completo del adulto', req),
    { id: 'fecha_nacimiento', tipo: 'fecha', etiqueta: 'Fecha de nacimiento', ...req },
    { id: 'telefono', tipo: 'telefono', etiqueta: 'Teléfono de contacto', ...req },
    radio('es_alumno', '¿Eres alumno de My English House?', ['Sí', 'No']),
    t('alergias', 'Alergias / intolerancias'),
    radio('redes', '¿Puede salir en redes sociales?', ['Sí', 'No'], req),
    { id: 'semanas', tipo: 'casillas', etiqueta: 'Semanas escogidas', opciones: [...SEMANAS, 'DÍAS ESPORÁDICOS'], ...req },
    t('dias_esporadicos', 'Si has escogido días esporádicos, especifica cuáles', { si: { campo: 'semanas', op: 'es', valor: 'DÍAS ESPORÁDICOS' }, requerido: true }),
    { id: 'servicios', tipo: 'casillas', etiqueta: 'Marca si necesitas un servicio extra', opciones: ['BON DIA DE 8 A 9H', 'MENJADOR DE 14 A 16H', 'BONA TARDA DE 16 A 17H', 'SOLO CASAL DE 9 A 14H'], ...req },
  ],
};

// ---------------- Encuesta de satisfacción ----------------
const ESCALAS = {
  satisf: ['Muy satisfecho/a', 'Satisfecho/a', 'Ni satisfecho/a ni insatisfecho/a', 'Poco satisfecho/a', 'Nada satisfecho/a'],
  excel: ['Excelente', 'Muy buena', 'Buena', 'Regular', 'Mala'],
};
const ENCUESTA = {
  titulo: 'Encuesta de satisfacción · Familias', tipo: 'generico', plantilla: false, activo: true,
  descripcion: '¡Gracias por dedicar un ratito a ayudarnos a mejorar My English House! 💛\n\nTu opinión es muy valiosa para nosotros y nos ayuda a seguir creando experiencias educativas divertidas, motivadoras y llenas de aprendizaje. La encuesta es **anónima**, aunque si lo deseas puedes dejar tu nombre.',
  mensaje_final: '¡Muchas gracias por tu opinión! 💛 Let’s keep growing together! 🌟',
  config: { cabecera: 'logo' },
  campos: [
    info('resena', '👉 ¿Te gustaría ayudarnos aún más?', 'Si podéis dedicar unos minutos a compartir vuestra experiencia en Google Maps, os estaríamos infinitamente agradecidos. Aceptamos reseñas constructivas, of course! 😉\n\nComo pequeño agradecimiento, si nos enviáis una captura de la reseña, vuestro hijo/a sumará ✨ **2 POINTS** ✨ en nuestro sistema de puntos. Y si ya la habéis compartido, ¡también podéis sumar esos 2 POINTS!\n\n*(Añade aquí el enlace para dejar la reseña con la barra «Enlace».)*'),
    t('adulto', 'Nombre y apellidos del adulto (opcional)'),
    radio('edad', 'Edad del alumno/a', ['3–5 años', '6–8 años', '9–11 años', '12–14 años', '15–18 años'], req),
    radio('antiguedad', 'Tiempo que lleva el alumno/a en My English House', ['Este es su primer año', 'Este es su segundo año', 'Este es su tercer año', 'Este es su cuarto año'], req),
    radio('satisfaccion_clases', 'Nivel de satisfacción general con las clases', ESCALAS.satisf, req),
    radio('metodologia', '¿Cómo valoras la metodología basada en talleres?', ['Excelente', 'Buena', 'Adecuada', 'Mejorable', 'Insuficiente'], req),
    radio('progreso', '¿Crees que tu hijo/a aprende y progresa en inglés?', ['Mucho', 'Bastante', 'Algo', 'Poco', 'Nada'], req),
    radio('motivacion', 'Nivel de motivación del alumno/a para asistir a clase', ['Muy alto', 'Alto', 'Medio', 'Bajo', 'Muy bajo'], req),
    radio('profesorado', 'Valoración del profesorado', ESCALAS.excel, req),
    radio('atencion', 'Valoración de la atención recibida por el equipo de My English House Montcada', ESCALAS.excel, req),
    radio('comunicacion', '¿Cómo valoras la comunicación con la academia (WhatsApp, email, llamadas, tutorías, etc.)?', ['Muy clara y fluida', 'Clara', 'Adecuada', 'Poco clara', 'Nada clara'], req),
    radio('tutorias', 'Utilidad de las tutorías para el seguimiento del alumno/a', ['Muy útiles', 'Útiles', 'Poco útiles', 'Nada útiles', 'No he asistido'], req),
    radio('fun_days', 'Valoración de los Fun Days', ['Excelente', 'Muy buena', 'Buena', 'Regular', 'No hemos participado'], { ...req, ayuda: 'Actividades extra o especiales que organizamos, principalmente los sábados, donde los niños participan en juegos, talleres creativos, lectura de cuentos y celebraciones de fechas señaladas como Carnaval o Halloween.' }),
    radio('camps', 'Valoración de los CAMPS', ['Excelente', 'Muy buena', 'Buena', 'Regular', 'No hemos participado'], { ...req, ayuda: 'Casales que organizamos durante verano, Navidad y Semana Santa, principalmente por las mañanas: juegos, talleres creativos, sesiones de cine y experiencias que complementan su aprendizaje del inglés.' }),
    { id: 'mejorar_fun_days', tipo: 'textarea', etiqueta: '¿Qué aspectos crees que podríamos mejorar de los FUN DAYS?', ...req },
    { id: 'mejorar_camps', tipo: 'textarea', etiqueta: '¿Qué aspectos crees que podríamos mejorar de los CAMPS?' },
    radio('eventos', 'Valoración de los festivales o eventos de fin de curso', ['Excelente', 'Muy buena', 'Buena', 'Regular', 'No hemos asistido'], req),
    radio('precio', 'Relación calidad–precio del servicio', ['Excelente', 'Buena', 'Adecuada', 'Mejorable', 'Mala'], req),
    radio('satisfaccion_general', 'Grado de satisfacción general con My English House Montcada', ESCALAS.satisf, req),
    radio('recomendaria', '¿Recomendarías My English House Montcada a otras familias?', ['Sí, sin duda', 'Probablemente sí', 'No lo sé', 'Probablemente no', 'No'], req),
    { id: 'lo_mas_valorado', tipo: 'textarea', etiqueta: '¿Qué es lo que más valoras de My English House?', ...req },
    { id: 'desarrollo', tipo: 'textarea', etiqueta: 'Desde tu punto de vista, ¿en qué aspectos has notado mayor desarrollo en tu hijo/a (confianza, expresión oral, autonomía, motivación, etc.)?', ...req },
    { id: 'mejorar_general', tipo: 'textarea', etiqueta: '¿Qué aspectos crees que podríamos mejorar EN GENERAL?', ...req },
    { id: 'mensaje', tipo: 'textarea', etiqueta: 'Algún mensaje positivo o crítica constructiva que nos quieras hacer llegar' },
  ],
};

// ---------------- Prueba de nivel B2 (con corrección: hay que marcar la respuesta correcta de cada pregunta) ----------------
const Q = [
  ['I wish I ________ in touch with him, but I don´t have his email address.', ['could get', 'get', 'got', 'would get']],
  ['Many people discourage their children ________ actors.', ['became', 'for becoming', 'from becoming', 'to become']],
  ['The singer denies ________ the tune from an old Beatles song.', ['having plagiarised', 'having to plagiarise', 'to have plagiarised', 'to plagiarise']],
  ['William was suspected ________ instruments from the theatre.', ['for stealing', 'from stealing', 'of stealing', 'to steal']],
  ['It was such a long time ago that I can hardly remember ________ Paris.', ['my visit', 'to visit', 'visit', 'visiting']],
  ['The play received very good ________ in the press.', ['announcements', 'critical', 'reviews', 'surveys']],
  ['I will wait for you until you ________ back.', ['came', 'come', 'will come', 'would come']],
  ['The government wants to ________ football hooligans from travelling abroad.', ['avoid', 'miss', 'prevent', 'protect']],
  ['I was so tired that I ________ down and closed my eyes.', ['lain', 'lay', 'lie', 'lied']],
  ['The novel is really worth ________.', ['reading', 'reading it', 'to read', 'to read it']],
  ['These birds make an incredible 10,000 km ________ to Africa every winter.', ['expedition', 'journey', 'outing', 'voyage']],
  ['I had no difficulty ________ a place to live. In fact it was surprisingly easy.', ['about finding', 'finding', 'in order to find', 'to find']],
  ['As I have such a sweet ________ it is very difficult for me to lose weight.', ['mouth', 'taste', 'tongue', 'tooth']],
  ['The last family ________ took place on aunt Sarah´s 100th birthday.', ['anniversary', 'encounter', 'gathering', 'together']],
  ['He was accused of corruption, so he ________ from his post.', ['abandoned', 'left', 'resigned', 'set']],
  ['She ________ her living as a magician at children´s parties.', ['earns', 'gains', 'has', 'wins']],
  ['I´ve always ________ Bill for his courage and determination.', ['looked after', 'looked up to', 'taken after', 'taken out for']],
  ['The ________ of war in Iraq took us all by surprise.', ['outbreak', 'outburst', 'outcry', 'output']],
  ['The drug has powerful side effects. ________, it can be addictive.', ['Furthermore', 'Nevertheless', 'So that', 'Whereas']],
  ['I´ll draw a map for you ________ you can´t find our house.', ['as long as', 'in case', 'provided', 'unless']],
  ['This is a private letter addressed to me. I´d rather you ________ it.', ['didn´t read', 'don´t read', 'won´t read', 'wouldn´t read']],
  ['After ten years, I got ________ a uniform at school.', ['use to wear', 'used to wear', 'used to wearing', 'wearing']],
  ['I know him ________ although we´ve never been introduced to each other.', ['at first sight', 'by sight', 'in sight', 'out of sight']],
  ['She ________ committed that crime. She was at home with me at the time it took place.', ['can´t have', 'mightn´t have', 'mustn´t have', 'should have']],
  ['I only had time to ________ at the newspapers, but I couldn´t read them carefully.', ['gaze', 'glance', 'stare', 'watch']],
  ['She´s not in her office right now but if you ________ on for a minute, I´ll try and find her.', ['count', 'hang', 'keep', 'pass']],
];
const TEXTO_LECTURA = `**THE LONG-DISTANCE CYCLIST**

As 33-year-old Londer Luke Bream pedalled past the finishing post of the Tour of France last year, he felt a surge of excitement that made the pain of the past three weeks worthwile. Unlike the professional team cyclists with their starte-of-art bikes and convoys of support vehicles, Luke - an amateur who had recently taken up cycling -, had decided to have a go at the Tour of France on a last-minute whim. "Looking back, it was a bit mad," he admits, laughing. "I had no fitness, no biking experience and I'd never been up a mountain. The other cyclists thought I was out of my mind!"

As an amateur, Luke couldn't ride alongside the professional cyclists but instead rode each of the 21 stages one day in advance of them. Whereas they were hooked up to food drips at night, Luke had his mum in a white transit van supplying him with Coca-Cola, Mars Bars and jam butties throughout the day.

Having never even seen the route on TV, Luke was in shock. "The mountains are 15 miles long and there might be four or five of them in a day. It just killed me. But I never got off the bike to walk." Day after day he battled on, setting out early to compensate for cycling at about half the speed of the professionals and finishing each stage by nightfall.

Only three weeks previously he had been sitting drinking coffee, contemplating how to fill his time. His sandwich business had recently gone bust and he was left with no money and a 40-cigarette-a-day habit. So he gave up smoking and bought himself a bike, the first he'd had since he was eight. "There I was in Starbucks, reading in the paper about the first leg of the Tour of France. Will you come?"

His mum, 68-year-old Carolyn, a former primary school teacher, immediately agreed, but she turned out to be almost as badly prepared as her son: she suffers from chronic vertigo, so had to drive on the wrong side of the road through Pyrenees and Alps hugging the cliffs. She was also claustrophobic, so she wasn't able to sleep in the back of the van with the bike like Luke, sleeping across the front seat instead.

On the fifth day Luke got food poisoning and was all up night being sick. But with some tough love from Mum he managed to finish the stage. This year he plans to do it again on his own, pitching a tent at the end of each stage. "Losing all my money was the best thing that could have happened to me," he says now. Setting himself near-impossible challenges and completing them gives him a sense of pride he never felt through work. Separated from his wife and with two small boys, he has set up a new business selling food supplements to cyclists, but limits himself to part-time hours.

His next project is to do the Race Across America, where amateur cyclist cover 3.000 miles in 12 days - cycling up to 23 hours a day. Only a handful of "nutters", as Luke puts it, are willing to try it. His father jokes that if Luke is "scared senselles" by something, he will want to do it.

As Luke says: "Endurance sports are like life - it's long and it can be paintful, but what matters is how you respond when things get difficult."`;
const LECTURA = [
  ['According to the text, ...', ['Bream felt too tired to go for a walk during the tour', "Bream's mum gave him a lot of jam sandwiches", 'professional cyclists were addicted to food drips']],
  ['Bream was very surprised when he saw the mountains because ...', ['he did not know beforehand what they were like', 'they were extremely close to each other', 'when he set out and arrived it was too dark to see them']],
  ["Through the Pyrenees and Alps, Bream's mother ...", ["could not sleep well because of her son's bicycle", 'drove away from the road outer side', 'hardly knew how to drive properly']],
  ['Bream feels proud of ...', ['having lost all his money', 'having started a new part-time job', 'overcoming difficult challenges']],
  ['Bream wants to do the Race Across America ...', ['as another way to test his endurance', 'because his father finds it funny', 'since there will only be a few nutters involved']],
];
const PRUEBA_NIVEL = {
  titulo: 'B2 English Level Test', tipo: 'generico', plantilla: false, activo: true,
  descripcion: 'Completa las siguientes frases y preguntas con las respuestas correctas: solo hay una opción correcta por cada una. Más abajo encontrarás la segunda parte del test, que es comprensión lectora: lee el texto con atención y responde a las preguntas.',
  mensaje_final: '¡Gracias! Hemos recibido tu prueba. Nos pondremos en contacto contigo con el resultado.',
  config: { test: true, mostrar_nota: false },
  campos: [
    { id: 'email', tipo: 'email', etiqueta: 'Correo', ...req },
    t('nombre', 'Nombre y apellidos'),
    { id: 'fecha_nacimiento', tipo: 'fecha', etiqueta: 'Fecha de nacimiento', ...req },
    { id: 'telefono', tipo: 'telefono', etiqueta: 'Teléfono de contacto', ...req },
    t('empresa', 'Empresa'),
    seccion('parte1', 'Parte 1: gramática y vocabulario'),
    ...Q.map(([p, o], i) => radio(`q${i + 1}`, `${i + 1}. ${p}`, o)),
    seccion('parte2', 'Parte 2: comprensión escrita'),
    info('lectura', '', TEXTO_LECTURA),
    ...LECTURA.map(([p, o], i) => radio(`l${i + 1}`, p, o)),
  ],
};

export const PLANTILLAS = [
  { clave: 'prematriculas', ...PREMATRICULAS }, { clave: 'campamento', ...CAMPAMENTO },
  { clave: 'encuesta', ...ENCUESTA }, { clave: 'prueba-nivel', ...PRUEBA_NIVEL },
];
