import { read, update, json, leerBody, soloDigitos } from '../lib/db.js';

const publicaCita = (c) => ({
  folio: c.folio, fecha: c.fecha, hora: c.hora, servicio: c.servicio,
  precio: c.precio, anticipo: c.anticipo, pago: c.pago, estado: c.estado,
  cliente: c.cliente, creada: c.creada, duracion: c.duracion,
});

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const folio = String(url.searchParams.get('folio') || '').toUpperCase().trim();
      const { data } = await read();
      const c = data.citas.find((x) => x.folio === folio);
      if (!c) return json(res, 404, { error: 'No encontramos ese folio.' });
      const vence = c.estado === 'pendiente' ? c.creada + (data.reglas.vigenciaHoras || 12) * 3600000 : null;
      return json(res, 200, { cita: publicaCita(c), vence, anticipoCfg: data.anticipo, negocio: data.negocio });
    }

    if (req.method === 'POST') {
      const b = await leerBody(req);
      const folio = String(b.folio || '').toUpperCase().trim();
      const tel = soloDigitos(b.telefono);
      const salida = await update((data) => {
        const c = data.citas.find((x) => x.folio === folio);
        if (!c) throw { code: 404, mensaje: 'No encontramos ese folio.' };
        if (c.telefono.slice(-4) !== tel.slice(-4)) {
          throw { code: 403, mensaje: 'Los últimos 4 dígitos de tu teléfono no coinciden.' };
        }
        if (c.estado === 'cancelada') throw { code: 400, mensaje: 'Esa cita ya estaba cancelada.' };
        if (c.estado === 'completada') throw { code: 400, mensaje: 'Esa cita ya se realizó.' };
        c.estado = 'cancelada';
        c.actualizada = Date.now();
        (c.historial = c.historial || []).push({ t: Date.now(), q: 'cliente', a: 'cancelada' });
        return { cita: publicaCita(c), negocio: data.negocio };
      });
      return json(res, 200, salida);
    }

    return json(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    if (e && e.code) return json(res, e.code, { error: e.mensaje });
    return json(res, 500, { error: 'Error del servidor' });
  }
}
