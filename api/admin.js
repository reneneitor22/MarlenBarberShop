import {
  read, update, json, leerBody, crearToken, tokenValido, hoyISO, minutosAhora,
  slotsLibres, montoAnticipo, folioNuevo, limpiar, soloDigitos, aMin, diaSemana,
} from '../lib/db.js';

const ESTADOS = ['pendiente', 'confirmada', 'completada', 'cancelada', 'noshow'];

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const accion = url.searchParams.get('accion') || '';
    const body = req.method === 'POST' ? await leerBody(req) : {};

    /* ---- login ---- */
    if (accion === 'login') {
      const pin = String(body.pin || '');
      const r = await update((data) => {
        const s = data.seguridad;
        if (s.bloqueoHasta > Date.now()) {
          const min = Math.ceil((s.bloqueoHasta - Date.now()) / 60000);
          throw { code: 429, mensaje: `Demasiados intentos. Espera ${min} min.` };
        }
        if (pin !== data.pin) {
          s.fallos = (s.fallos || 0) + 1;
          if (s.fallos >= 5) { s.bloqueoHasta = Date.now() + 10 * 60000; s.fallos = 0; }
          throw { code: 401, mensaje: 'PIN incorrecto.' };
        }
        s.fallos = 0; s.bloqueoHasta = 0;
        return { token: crearToken(data.pin), negocio: data.negocio };
      });
      return json(res, 200, r);
    }

    /* ---- de aquí en adelante requiere sesión ---- */
    const token = req.headers['x-dm-token'] || url.searchParams.get('token') || '';
    const { data: actual } = await read();
    if (!tokenValido(token, actual.pin)) return json(res, 401, { error: 'Sesión expirada. Entra otra vez.' });

    if (accion === 'data') {
      const { pin, seguridad, ...resto } = actual;
      return json(res, 200, { ...resto, hoy: hoyISO(), ahora: minutosAhora() });
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });

    /* ---- acciones sobre una cita ---- */
    if (accion === 'cita') {
      const folio = String(body.folio || '').toUpperCase();
      const op = String(body.op || '');
      const r = await update((data) => {
        const i = data.citas.findIndex((c) => c.folio === folio);
        if (i < 0) throw { code: 404, mensaje: 'No existe esa cita.' };
        const c = data.citas[i];
        if (op === 'eliminar') {
          data.citas.splice(i, 1);
          return { ok: true, eliminada: folio };
        }
        if (op === 'nota') {
          c.nota = limpiar(body.nota, 200);
        } else if (op === 'anticipo') {
          c.anticipoPagado = !!body.valor;
          if (c.anticipoPagado && c.estado === 'pendiente') c.estado = 'confirmada';
        } else if (ESTADOS.includes(op)) {
          c.estado = op;
          if (op === 'confirmada') c.anticipoPagado = true;
        } else {
          throw { code: 400, mensaje: 'Operación desconocida.' };
        }
        c.actualizada = Date.now();
        (c.historial = c.historial || []).push({ t: Date.now(), q: 'marlen', a: op });
        return { ok: true, cita: c };
      });
      return json(res, 200, r);
    }

    /* ---- cita manual (teléfono / walk-in) ---- */
    if (accion === 'crear') {
      const r = await update((data) => {
        const serv = data.servicios.find((s) => s.id === body.servicio);
        if (!serv) throw { code: 400, mensaje: 'Elige un servicio.' };
        const fecha = String(body.fecha || '');
        const hora = String(body.hora || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw { code: 400, mensaje: 'Fecha inválida.' };
        if (!/^\d{1,2}:\d{2}$/.test(hora)) throw { code: 400, mensaje: 'Hora inválida.' };
        const dur = Number(body.duracion) || Number(serv.duracion) || 30;
        const ini = aMin(hora);
        const choca = data.citas.some((c) => {
          if (c.fecha !== fecha || ['cancelada', 'noshow'].includes(c.estado)) return false;
          const a = aMin(c.hora), b = a + (c.duracion || 30);
          return ini < b && ini + dur > a;
        });
        if (choca && !body.forzar) throw { code: 409, mensaje: 'Ya hay una cita encimada a esa hora. ¿La agendo de todos modos?' };

        const cita = {
          folio: folioNuevo(data.citas),
          fecha, hora, duracion: dur,
          servicioId: serv.id, servicio: serv.nombre,
          precio: Number(body.precio ?? serv.precio) || 0,
          anticipo: montoAnticipo(data, Number(body.precio ?? serv.precio) || 0),
          pago: body.pago === 'transferencia' ? 'transferencia' : 'efectivo',
          cliente: limpiar(body.cliente, 60) || 'Sin nombre',
          telefono: soloDigitos(body.telefono).slice(0, 15),
          nota: limpiar(body.nota, 200),
          estado: ESTADOS.includes(body.estado) ? body.estado : 'confirmada',
          anticipoPagado: body.estado !== 'pendiente',
          creada: Date.now(), actualizada: Date.now(),
          historial: [{ t: Date.now(), q: 'marlen', a: 'creada' }],
        };
        data.citas.push(cita);
        return { ok: true, cita };
      });
      return json(res, 200, r);
    }

    /* ---- guardar configuración ---- */
    if (accion === 'config') {
      const r = await update((data) => {
        const p = body.parche || {};
        if (p.negocio) data.negocio = { ...data.negocio, ...limpiarObj(p.negocio) };
        if (p.reglas) {
          data.reglas = {
            intervalo: clamp(p.reglas.intervalo, 5, 240, data.reglas.intervalo),
            anticipacionMin: clamp(p.reglas.anticipacionMin, 0, 2880, data.reglas.anticipacionMin),
            diasVista: clamp(p.reglas.diasVista, 1, 120, data.reglas.diasVista),
            vigenciaHoras: clamp(p.reglas.vigenciaHoras, 1, 168, data.reglas.vigenciaHoras),
          };
        }
        if (p.anticipo) {
          data.anticipo = {
            activo: !!p.anticipo.activo,
            tipo: p.anticipo.tipo === 'porcentaje' ? 'porcentaje' : 'fijo',
            valor: clamp(p.anticipo.valor, 0, 100000, data.anticipo.valor),
            banco: limpiar(p.anticipo.banco, 40),
            titular: limpiar(p.anticipo.titular, 60),
            tarjeta: limpiar(p.anticipo.tarjeta, 30),
            clabe: limpiar(p.anticipo.clabe, 30),
            nota: limpiar(p.anticipo.nota, 200),
          };
        }
        if (p.horario) {
          const h = {};
          for (let d = 0; d <= 6; d++) {
            const src = p.horario[d] || p.horario[String(d)] || { abierto: false, rangos: [] };
            const rangos = (Array.isArray(src.rangos) ? src.rangos : [])
              .map((r) => ({ ini: hm(r.ini), fin: hm(r.fin) }))
              .filter((r) => r.ini && r.fin && aMin(r.fin) > aMin(r.ini))
              .sort((a, b) => aMin(a.ini) - aMin(b.ini));
            h[d] = { abierto: !!src.abierto && rangos.length > 0, rangos };
          }
          data.horario = h;
        }
        if (Array.isArray(p.excepciones)) {
          data.excepciones = p.excepciones
            .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.fecha))
            .slice(0, 200)
            .map((e) => ({
              fecha: e.fecha,
              cerrado: !!e.cerrado,
              rangos: (Array.isArray(e.rangos) ? e.rangos : [])
                .map((r) => ({ ini: hm(r.ini), fin: hm(r.fin) }))
                .filter((r) => r.ini && r.fin && aMin(r.fin) > aMin(r.ini)),
              nota: limpiar(e.nota, 60),
            }));
        }
        if (Array.isArray(p.servicios)) {
          data.servicios = p.servicios.slice(0, 30).map((s, i) => ({
            id: s.id || `s${Date.now()}${i}`,
            nombre: limpiar(s.nombre, 40) || 'Servicio',
            desc: limpiar(s.desc, 120),
            icono: limpiar(s.icono, 4) || '💈',
            precio: clamp(s.precio, 0, 100000, 0),
            duracion: clamp(s.duracion, 5, 480, 30),
            activo: s.activo !== false,
          }));
        }
        if (p.pin !== undefined) {
          const nuevo = String(p.pin).trim();
          if (nuevo.length < 4) throw { code: 400, mensaje: 'El PIN debe tener al menos 4 caracteres.' };
          data.pin = nuevo;
        }
        return { ok: true, pinCambiado: p.pin !== undefined, token: p.pin !== undefined ? crearToken(data.pin) : null };
      });
      return json(res, 200, r);
    }

    /* ---- horas libres para el formulario manual ---- */
    if (accion === 'horas') {
      const fecha = String(body.fecha || '');
      const dur = Number(body.duracion) || 30;
      return json(res, 200, { horas: slotsLibres(actual, fecha, dur), dow: diaSemana(fecha) });
    }

    return json(res, 400, { error: 'Acción desconocida' });
  } catch (e) {
    if (e && e.code) return json(res, e.code, { error: e.mensaje });
    return json(res, 500, { error: 'Error del servidor', detalle: String(e?.message || e) });
  }
}

const clamp = (v, min, max, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const hm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v)) ? String(v).padStart(5, '0') : null);
const limpiarObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, limpiar(v, 200)]));
