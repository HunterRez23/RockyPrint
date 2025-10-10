// app/main/ipc-handlers.js
import { ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import { query } from './db.js';

// ---------------------------
// Util: rutas para navegar
// ---------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = (html) => path.join(__dirname, '../renderer', html);

// ---------------------------
// Store de sesión y contexto UI
// ---------------------------
const store = new Store({ name: 'session' }); // guarda { user } y opcionalmente 'ui:ctx'

// ===========================
// AUTH
// ===========================
ipcMain.handle('auth:login', async (_evt, { usuario, clave }) => {
  try {
    const res = await query('SELECT * FROM verificar_login($1,$2)', [usuario, clave]);
    const row = res.rows?.[0];
    if (!row) return { ok: false, error: 'Usuario o contraseña incorrectos' };

    const user = {
      id: row.id, usuario: row.usuario, nombre: row.nombre,
      email: row.email, rol: row.rol
    };
    store.set('user', user);
    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: 'Error de autenticación' };
  }
});

ipcMain.handle('auth:get', async () => store.get('user') || null);
ipcMain.handle('auth:logout', async () => { store.delete('user'); store.delete('ui:ctx'); return true; });

// ===========================================
// UI: navegar entre HTMLs + contexto opcional
// - window.api.navigate('lienzo.html')
// - window.api.navigate({ html:'lienzo.html', ctx:{...} })
// ===========================================
ipcMain.handle('ui:navigate', async (_evt, htmlOrObj, ctxArg) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: 'No hay ventana activa' };

  const payload = (typeof htmlOrObj === 'string')
    ? { html: htmlOrObj, ctx: ctxArg }
    : (htmlOrObj || {});

  const requested = path.basename(String(payload.html || '').trim()) || 'caja.html';
  const allowedFiles = new Set(['login.html', 'caja.html', 'lienzo.html', 'pedidos.html']);
  if (!allowedFiles.has(requested)) return { ok: false, error: 'Archivo no permitido' };

  if (requested !== 'login.html') {
    const user = store.get('user');
    if (!user || !user.rol) return { ok: false, error: 'Sesión requerida' };
    const rol = String(user.rol).toLowerCase();

    const allowedByRole = {
      caja: new Set(['caja.html', 'lienzo.html', 'pedidos.html']),
      produccion: new Set(['pedidos.html']),
      admin: new Set(['caja.html', 'lienzo.html', 'pedidos.html'])
    };
    const defaultByRole = { caja: 'caja.html', produccion: 'pedidos.html', admin: 'pedidos.html' };

    const allowed = allowedByRole[rol] || new Set();
    const target = allowed.has(requested) ? requested : (defaultByRole[rol] || 'caja.html');

    if (payload.ctx) store.set('ui:ctx', payload.ctx);
    try { await win.loadFile(rendererPath(target)); return { ok: true }; }
    catch (err) { console.error('navigate error', err); return { ok: false, error: String(err) }; }
  } else {
    store.delete('ui:ctx');
    try { await win.loadFile(rendererPath('login.html')); return { ok: true }; }
    catch (err) { console.error('navigate error', err); return { ok: false, error: String(err) }; }
  }
});

// Contexto UI directo
ipcMain.handle('ui:setContext', (_e, ctx) => { store.set('ui:ctx', ctx || {}); return { ok: true }; });
ipcMain.handle('ui:getContext', () => store.get('ui:ctx') || null);
ipcMain.handle('ui:clearContext', () => { store.delete('ui:ctx'); return { ok: true }; });

// ===================================================
//  Pedidos / Clientes  (tablas en español)
//  - clientes(nombre, telefono, correo, rfc, facturar, canal, ...)
//  - pedidos( ... fecha_entrega, hora_entrega, total, anticipo, ... )
//  - partidas( ... )
// ===================================================

// Helpers
function calcularTotal(partidas = []) {
  return partidas.reduce((acc, it) => {
    const pu = Number(it.precio_unitario ?? it.unit_price ?? it.pu ?? 0);
    const qty = Number(it.cantidad ?? it.quantity ?? it.cant ?? 0);
    return acc + (pu * qty);
  }, 0);
}

// ---- Upsert de cliente (FIX: castear params para evitar "could not determine data type") ----
async function asegurarCliente({ nombre, telefono, correo, rfc, factura, canal }) {
  // Busca por correo si viene; si no, por nombre. Se castea $1/$2 a text.
  const sqlFind = `
    SELECT id
    FROM clientes
    WHERE ($1::text IS NOT NULL AND correo = $1::text)
       OR ($1::text IS NULL  AND nombre = $2::text)
    LIMIT 1
  `;
  const f = await query(sqlFind, [correo || null, nombre || null]);

  if (f.rows[0]) {
    await query(
      `UPDATE clientes
         SET telefono = $2::text,
             rfc      = $3::text,
             facturar = $4::boolean,
             canal    = $5::text,
             correo   = COALESCE($6::text, correo)
       WHERE id = $1`,
      [f.rows[0].id, telefono || null, rfc || null, !!factura, canal || null, correo || null]
    );
    return f.rows[0].id;
  }

  const ins = await query(
    `INSERT INTO clientes (nombre, telefono, correo, rfc, facturar, canal)
     VALUES ($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::text)
     RETURNING id`,
    [nombre || null, telefono || null, correo || null, rfc || null, !!factura, canal || null]
  );
  return ins.rows[0].id;
}


// Normaliza payload (front puede mandar español/inglés)
function normalizarPedidoPayload(payload) {
  const c = payload.cliente || payload.client || {};
  const cliente = {
    nombre: c.nombre || c.name || '',
    telefono: c.tel || c.phone || null,
    // 👇 IMPORTANTE: usar 'correo' para tu tabla
    correo: c.correo || c.email || null,
    rfc: c.rfc || null,
    factura: (c.factura === 'si' || c.factura === true || c.invoice_flag === true),
    canal: c.canal || c.channel || null
  };

  const items = (payload.items || []).map((it) => ({
    producto: it.producto || it.product || '',
    descripcion: it.desc || it.descr || it.descripcion || '',
    ancho_cm: Number(it.ancho ?? it.width_cm ?? 0),
    alto_cm: Number(it.alto ?? it.height_cm ?? 0),
    cantidad: Number(it.cant ?? it.quantity ?? 1),
    info_color: it.color || it.color_info || '',
    acabados: it.acabados || it.finishes || '',
    precio_unitario: Number(it.pu ?? it.unit_price ?? 0),
  }));

  return {
    folio: payload.folio,
    estado: payload.estado || payload.state || 'Pendiente',
    sucursal_usuario: payload.sucursal || payload.branch_user || null,
    prioridad: payload.prioridad || payload.priority || 'Normal',

    // 👇 Tu tabla usa fecha_entrega y hora_entrega
    fecha_entrega: payload.entregaFecha || payload.delivery_date || null,
    hora_entrega: payload.entregaHora || payload.delivery_time || null,

    // totales (tu tabla usa total y anticipo)
    anticipo: Number(payload.anticipo ?? payload.deposit_amount ?? 0),
    metodo_pago: payload.metodo_pago || payload.payment_method || 'Efectivo',

    cliente, items
  };
}

// ---------------------------
// Crear pedido (usa nombres reales de tu tabla)
// ---------------------------
ipcMain.handle('orders:create', async (_evt, payloadRaw) => {
  try {
    const p = normalizarPedidoPayload(payloadRaw);

    // Cliente
    const clienteId = await asegurarCliente(p.cliente);

    // Total calculado server-side (campo 'total' en tu tabla)
    const total = calcularTotal(p.items);

    // INSERT con columnas reales
    const ins = await query(
      `INSERT INTO pedidos
        (folio, cliente_id, estado, sucursal_usuario, prioridad,
         fecha_entrega, hora_entrega, total, anticipo, metodo_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        p.folio, clienteId, p.estado, p.sucursal_usuario, p.prioridad,
        p.fecha_entrega || null, p.hora_entrega || null,
        total, p.anticipo || 0, p.metodo_pago || 'Efectivo'
      ]
    );
    const pedidoId = ins.rows[0].id;

    // Partidas
    if (p.items.length) {
      const values = [];
      const params = [];
      p.items.forEach((it, i) => {
        const idx = i * 10;
        values.push(
          `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5},
             $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10})`
        );
        params.push(
          pedidoId,
          it.producto,
          it.descripcion || null,
          it.ancho_cm || 0,
          it.alto_cm || 0,
          it.cantidad || 1,
          it.info_color || null,
          it.acabados || null,
          it.precio_unitario || 0,
          (it.precio_unitario || 0) * (it.cantidad || 0)
        );
      });

      await query(
        `INSERT INTO partidas
          (pedido_id, producto, descripcion, ancho_cm, alto_cm,
           cantidad, info_color, acabados, precio_unitario, subtotal)
         VALUES ${values.join(',')}`,
        params
      );
    }

    return { ok: true, id: pedidoId, total };
  } catch (e) {
    if (e.code === '23505') return { ok: false, code: '23505', error: 'Folio ya existe' };
    return { ok: false, code: e.code || null, error: e.detail || e.message || 'No se pudo crear el pedido' };
  }
});

// ---------------------------
// Listar pedidos (usa fecha_entrega y total)
// ---------------------------
ipcMain.handle('orders:list', async (_evt, filtros = {}) => {
  const q = filtros.q ?? filtros.query ?? null;
  const estado = filtros.estado ?? filtros.state ?? null;
  const desde = filtros.desde ?? filtros.from ?? null;
  const hasta = filtros.hasta ?? filtros.to ?? null;

  const clauses = [];
  const params = [];
  let p = 1;

  if (q) { clauses.push(`(p.folio ILIKE $${p} OR c.nombre ILIKE $${p})`); params.push(`%${q}%`); p++; }
  if (estado) { clauses.push(`p.estado = $${p}`); params.push(estado); p++; }
  if (desde) { clauses.push(`p.fecha_entrega >= $${p}`); params.push(desde); p++; }
  if (hasta) { clauses.push(`p.fecha_entrega <= $${p}`); params.push(hasta); p++; }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT
      p.id, p.folio, c.nombre AS cliente, p.estado,
      p.fecha_entrega, p.actualizado_en, p.total
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    ${where}
    ORDER BY p.actualizado_en DESC
    LIMIT 500
  `;
  const { rows } = await query(sql, params);
  return rows;
});

// ---------------------------
// Obtener pedido completo
// ---------------------------
ipcMain.handle('orders:get', async (_evt, id) => {
  const po = await query(`SELECT * FROM pedidos WHERE id=$1`, [id]);
  const pedido = po.rows?.[0];
  if (!pedido) return null;

  const it = await query(`SELECT * FROM partidas WHERE pedido_id=$1 ORDER BY id`, [id]);
  const cliente = pedido.cliente_id
    ? (await query(`SELECT * FROM clientes WHERE id=$1`, [pedido.cliente_id])).rows?.[0] || null
    : null;

  return { pedido, partidas: it.rows, cliente };
});
