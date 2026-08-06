import { put, get } from '@vercel/blob';
import crypto from 'node:crypto';

const KEY = 'delmar-data.json';
export const TZ = 'America/Mexico_City';

/* ---------- datos por defecto ---------- */

export function defaultData() {
  return {
    version: 1,
    pin: '2026',
    negocio: {
      nombre: 'Del Mar Barber Studio',
      duena: 'Marlén Solís',
      telefono: '529585856218',
      direccion: 'Calle Bahía de San Agustín 28, Crucecita, 70988 Huatulco, Oax.',
      instagram: 'del_marbarberstudio',
    },
    servicios: [
      { id: 's1', nombre: 'Corte Clásico', desc: 'Corte a tijera o máquina, acabado limpio.', icono: '✂️', precio: 150, duracion: 40, activo: true },
      { id: 's2', nombre: 'Fade', desc: 'Degradado preciso, bajo o alto fade.', icono: '💈', precio: 180, duracion: 45, activo: true },
      { id: 's3', nombre: 'Corte + Barba', desc: 'Combo completo, incluye toalla caliente.', icono: '🔥', precio: 250, duracion: 60, activo: true },
      { id: 's4', nombre: 'Diseño / Line Up', desc: 'Diseños personalizados a navaja.', icono: '🎨', precio: 100, duracion: 30, activo: true },
      { id: 's5', nombre: 'Barba', desc: 'Perfilado y afeitado tradicional.', icono: '🪒', precio: 100, duracion: 30, activo: true },
    ],
    // 0 = domingo ... 6 = sábado
    horario: {
      0: { abierto: false, rangos: [] },
      1: { abierto: false, rangos: [] },
      2: { abierto: true, rangos: [{ ini: '10:00', fin: '19:00' }] },
      3: { abierto: true, rangos: [{ ini: '10:00', fin: '19:00' }] },
      4: { abierto: true, rangos: [{ ini: '10:00', fin: '19:00' }] },
      5: { abierto: true, rangos: [{ ini: '10:00', fin: '19:00' }] },
      6: { abierto: true, rangos: [{ ini: '10:00', fin: '19:00' }] },
    },
    excepciones: [],           // [{fecha:'2026-08-12', cerrado:true, rangos:[], nota:''}]
    reglas: {
      intervalo: 30,           // minutos entre inicios de cita
      anticipacionMin: 60,     // no se puede agendar con menos de X minutos
      diasVista: 21,           // cuántos días hacia adelante puede reservar el cliente
      vigenciaHoras: 12,       // horas para pagar el anticipo antes de liberar el lugar
    },
    anticipo: {
      activo: true,
      tipo: 'fijo',            // 'fijo' | 'porcentaje'
      valor: 50,
      banco: '',
      titular: '',
      tarjeta: '',
      clabe: '',
      nota: 'Manda tu comprobante por WhatsApp para confirmar la cita.',
    },
    citas: [],
    seguridad: { fallos: 0, bloqueoHasta: 0 },
  };
}

/* ---------- lectura / escritura con control de concurrencia ---------- */

export async function read() {
  try {
    const res = await get(KEY, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200) return { data: defaultData(), etag: null };
    const txt = await new Response(res.stream).text();
    // el CDN devuelve un ETag débil (W/"..."); `ifMatch` espera el fuerte
    const etag = String(res.blob.etag || '').replace(/^W\//, '') || null;
    return { data: migrate(JSON.parse(txt)), etag };
  } catch (e) {
    if (e?.constructor?.name === 'BlobNotFoundError' || /not found/i.test(e?.message || '')) {
      return { data: defaultData(), etag: null };
    }
    throw e;
  }
}

async function write(data, etag) {
  const opts = {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  };
  if (etag) opts.ifMatch = etag;
  const r = await put(KEY, JSON.stringify(data), opts);
  return r.etag;
}

/**
 * Lee, aplica mutate(data) y guarda. Si otro proceso escribió en medio,
 * reintenta con los datos frescos. mutate puede lanzar {code, mensaje}.
 */
export async function update(mutate) {
  let ultimo;
  for (let intento = 0; intento < 7; intento++) {
    const { data, etag } = await read();
    const salida = await mutate(data);
    try {
      await write(data, etag);
      return salida;
    } catch (e) {
      if (e?.constructor?.name === 'BlobPreconditionFailedError') {
        ultimo = e;
        await new Promise((r) => setTimeout(r, 120 * intento + Math.random() * 500));
        continue;
      }
      throw e;
    }
  }
  throw ultimo || new Error('No se pudo guardar');
}

function migrate(d) {
  const base = defaultData();
  const out = { ...base, ...d };
  out.negocio = { ...base.negocio, ...(d.negocio || {}) };
  out.reglas = { ...base.reglas, ...(d.reglas || {}) };
  out.anticipo = { ...base.anticipo, ...(d.anticipo || {}) };
  out.horario = { ...base.horario, ...(d.horario || {}) };
  out.seguridad = { ...base.seguridad, ...(d.seguridad || {}) };
  out.citas = Array.isArray(d.citas) ? d.citas : [];
  out.excepciones = Array.isArray(d.excepciones) ? d.excepciones : [];
  out.servicios = Array.isArray(d.servicios) && d.servicios.length ? d.servicios : base.servicios;
  return out;
}

/* ---------- fecha / hora en horario de Huatulco ---------- */

export function hoyISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function minutosAhora() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = p.split(':').map(Number);
  return h * 60 + m;
}

export function diaSemana(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function sumarDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const aMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
export const aHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/* ---------- disponibilidad ---------- */

export function citaVigente(c, data) {
  if (c.estado === 'cancelada' || c.estado === 'noshow') return false;
  if (c.estado === 'pendiente') {
    const limite = c.creada + (data.reglas.vigenciaHoras || 12) * 3600 * 1000;
    if (Date.now() > limite) return false;   // apartado vencido, el lugar se libera
    return true;
  }
  return true; // confirmada / completada
}

export function rangosDelDia(data, iso) {
  const exc = data.excepciones.find((e) => e.fecha === iso);
  if (exc) {
    if (exc.cerrado) return [];
    if (Array.isArray(exc.rangos) && exc.rangos.length) return exc.rangos;
  }
  const h = data.horario[String(diaSemana(iso))] || data.horario[diaSemana(iso)];
  if (!h || !h.abierto) return [];
  return h.rangos || [];
}

export function ocupados(data, iso) {
  return data.citas
    .filter((c) => c.fecha === iso && citaVigente(c, data))
    .map((c) => ({ ini: aMin(c.hora), fin: aMin(c.hora) + (c.duracion || 30) }));
}

export function slotsLibres(data, iso, duracion) {
  const rangos = rangosDelDia(data, iso);
  if (!rangos.length) return [];
  const paso = data.reglas.intervalo || 30;
  const ocup = ocupados(data, iso);
  const esHoy = iso === hoyISO();
  const minimo = minutosAhora() + (data.reglas.anticipacionMin || 0);
  const libres = [];
  for (const r of rangos) {
    const ini = aMin(r.ini), fin = aMin(r.fin);
    for (let t = ini; t + duracion <= fin; t += paso) {
      if (esHoy && t < minimo) continue;
      const choca = ocup.some((o) => t < o.fin && t + duracion > o.ini);
      if (!choca) libres.push(aHM(t));
    }
  }
  return libres;
}

export function montoAnticipo(data, precio) {
  const a = data.anticipo || {};
  if (!a.activo) return 0;
  if (a.tipo === 'porcentaje') return Math.round((precio * (Number(a.valor) || 0)) / 100);
  return Number(a.valor) || 0;
}

/* ---------- utilidades ---------- */

export function folioNuevo(citas) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let f;
  do {
    f = 'DM-' + Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
  } while (citas.some((c) => c.folio === f));
  return f;
}

export function soloDigitos(s) { return String(s || '').replace(/\D/g, ''); }

export function limpiar(s, max = 80) {
  return String(s ?? '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, max);
}

/* ---------- sesión admin ---------- */

function secreto(pin) {
  return crypto.createHash('sha256').update('delmar::' + pin).digest('hex');
}

export function crearToken(pin) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const firma = crypto.createHmac('sha256', secreto(pin)).update(String(exp)).digest('hex').slice(0, 32);
  return `${exp}.${firma}`;
}

export function tokenValido(token, pin) {
  if (!token || !token.includes('.')) return false;
  const [exp, firma] = token.split('.');
  if (!exp || !firma || Number(exp) < Date.now()) return false;
  const esperado = crypto.createHmac('sha256', secreto(pin)).update(String(exp)).digest('hex').slice(0, 32);
  if (firma.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperado));
}

/* ---------- helpers HTTP ---------- */

export function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function leerBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function publico(data) {
  return {
    negocio: data.negocio,
    servicios: data.servicios.filter((s) => s.activo !== false),
    horario: data.horario,
    excepciones: data.excepciones,
    reglas: data.reglas,
    anticipo: {
      activo: data.anticipo.activo,
      tipo: data.anticipo.tipo,
      valor: data.anticipo.valor,
      banco: data.anticipo.banco,
      titular: data.anticipo.titular,
      tarjeta: data.anticipo.tarjeta,
      clabe: data.anticipo.clabe,
      nota: data.anticipo.nota,
    },
  };
}
