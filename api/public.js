import { read, publico, json, hoyISO, sumarDias, slotsLibres, rangosDelDia } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const accion = url.searchParams.get('accion') || 'config';
    const { data } = await read();

    if (accion === 'config') {
      return json(res, 200, publico(data));
    }

    if (accion === 'dias') {
      const dur = duracionDe(data, url.searchParams.get('servicio'));
      const hoy = hoyISO();
      const total = data.reglas.diasVista || 21;
      const dias = [];
      for (let i = 0; i <= total; i++) {
        const iso = sumarDias(hoy, i);
        const abre = rangosDelDia(data, iso).length > 0;
        const libres = abre ? slotsLibres(data, iso, dur).length : 0;
        const exc = data.excepciones.find((e) => e.fecha === iso);
        dias.push({ fecha: iso, abre, libres, nota: exc?.nota || '' });
      }
      return json(res, 200, { dias });
    }

    if (accion === 'horas') {
      const fecha = String(url.searchParams.get('fecha') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, 400, { error: 'Fecha inválida' });
      const dur = duracionDe(data, url.searchParams.get('servicio'));
      return json(res, 200, { horas: slotsLibres(data, fecha, dur), duracion: dur });
    }

    return json(res, 400, { error: 'Acción desconocida' });
  } catch (e) {
    return json(res, 500, { error: 'Error del servidor', detalle: String(e?.message || e) });
  }
}

function duracionDe(data, id) {
  const s = data.servicios.find((x) => x.id === id);
  return Number(s?.duracion) || data.reglas.intervalo || 30;
}
