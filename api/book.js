import {
  update, json, leerBody, hoyISO, slotsLibres, montoAnticipo,
  folioNuevo, limpiar, soloDigitos, sumarDias,
} from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  try {
    const b = await leerBody(req);
    const nombre = limpiar(b.nombre, 60);
    const telefono = soloDigitos(b.telefono).slice(0, 15);
    const fecha = String(b.fecha || '');
    const hora = String(b.hora || '');
    const pago = b.pago === 'transferencia' ? 'transferencia' : 'efectivo';
    const nota = limpiar(b.nota, 200);

    if (nombre.length < 2) return json(res, 400, { error: 'Escribe tu nombre.' });
    if (telefono.length < 10) return json(res, 400, { error: 'El WhatsApp debe traer 10 dígitos.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, 400, { error: 'Fecha inválida.' });
    if (!/^\d{2}:\d{2}$/.test(hora)) return json(res, 400, { error: 'Hora inválida.' });

    const salida = await update((data) => {
      const serv = data.servicios.find((s) => s.id === b.servicio && s.activo !== false);
      if (!serv) throw { code: 400, mensaje: 'Ese servicio ya no está disponible.' };

      const hoy = hoyISO();
      if (fecha < hoy) throw { code: 400, mensaje: 'Esa fecha ya pasó.' };
      if (fecha > sumarDias(hoy, data.reglas.diasVista || 21)) {
        throw { code: 400, mensaje: 'Esa fecha todavía no está abierta para reservar.' };
      }

      const dur = Number(serv.duracion) || 30;
      if (!slotsLibres(data, fecha, dur).includes(hora)) {
        throw { code: 409, mensaje: 'Alguien acaba de tomar ese horario. Elige otro, porfa.' };
      }

      const activas = data.citas.filter(
        (c) => c.telefono === telefono && ['pendiente', 'confirmada'].includes(c.estado) && c.fecha >= hoy
      );
      if (activas.length >= 3) throw { code: 429, mensaje: 'Ya tienes 3 citas activas con ese número.' };

      const anticipo = montoAnticipo(data, Number(serv.precio) || 0);
      const cita = {
        folio: folioNuevo(data.citas),
        fecha, hora,
        duracion: dur,
        servicioId: serv.id,
        servicio: serv.nombre,
        precio: Number(serv.precio) || 0,
        anticipo,
        pago,
        cliente: nombre,
        telefono,
        nota,
        estado: data.anticipo.activo ? 'pendiente' : 'confirmada',
        creada: Date.now(),
        actualizada: Date.now(),
        historial: [{ t: Date.now(), q: 'cliente', a: 'creada' }],
      };
      data.citas.push(cita);
      return {
        cita,
        vigenciaHoras: data.reglas.vigenciaHoras,
        anticipoCfg: data.anticipo,
        negocio: data.negocio,
      };
    });

    return json(res, 200, salida);
  } catch (e) {
    if (e && e.code) return json(res, e.code, { error: e.mensaje });
    return json(res, 500, { error: 'No se pudo guardar la cita. Intenta de nuevo.' });
  }
}
