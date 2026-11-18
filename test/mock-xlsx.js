// Sustituto de SheetJS para la prueba: el «xlsx» es un JSON { hoja: [[fila], …] } guardado con extensión .xlsx.
export function read(buf) { const j = JSON.parse(new TextDecoder().decode(buf)); return { SheetNames: Object.keys(j), Sheets: j }; }
export const utils = { sheet_to_json: (hoja) => hoja };
