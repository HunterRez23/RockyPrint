import { ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import crypto from 'node:crypto';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = (html) => path.join(__dirname, '../renderer', html);

const store = new Store({ name: 'session' });

/* ========= Helpers ========= */
function ensureDataUrl(row) {
  if (row?.dataUrl && /^data:/.test(row.dataUrl)) return row.dataUrl;
  if (row?.tipo_mime && row?.b64) return `data:${row.tipo_mime};base64,${row.b64}`;
  if (row?.tipo_mime && row?.datos && Buffer.isBuffer(row.datos)) {
    return `data:${row.tipo_mime};base64,${row.datos.toString('base64')}`;
  }
  if (row?.mime && row?.data && !/^data:/.test(row.data)) return `data:${row.mime};base64,${row.data}`;
  if (row?.mime_tipo && row?.data_base64) return `data:${row.mime_tipo};base64,${row.data_base64}`;
  return row?.data_base64 || row?.dataUrl || row?.data || '';
}

function sha256Base64(dataUrlOrBase64) {
  const base64 = String(dataUrlOrBase64 || '').replace(/^data:[^,]+,/, '');
  return crypto.createHash('sha256').update(base64, 'base64').digest('hex');
}

/* ===================== AUTH ===================== */
ipcMain.handle('auth:login', async (_evt, { usuario, clave }) => {
  try {
    const res = await query('SELECT * FROM verificar_login($1,$2)', [usuario, clave]);
    const row = res.rows?.[0];
    if (!row) return { ok: false, error: 'Usuario o contraseña incorrectos' };
    const user = { id: row.id, usuario: row.usuario, nombre: row.nombre, email: row.email, rol: row.rol };
    store.set('user', user);
    return { ok: true, user };
  } catch {
    return { ok: false, error: 'Error de autenticación' };
  }
});
ipcMain.handle('auth:get', async () => store.get('user') || null);
ipcMain.handle('auth:logout', async () => { store.delete('user'); store.delete('ui:ctx'); return true; });

/** Confirmación de contraseña del usuario en sesión */
ipcMain.handle('auth:confirmPassword', async (_evt, password) => {
  try {
    const user = store.get('user');
    if (!user?.usuario) return { ok: false, error: 'Sesión requerida' };
    const res = await query('SELECT 1 FROM verificar_login($1,$2)', [user.usuario, password || '']);
    if (!res.rows?.[0]) return { ok: false, error: 'Contraseña incorrecta' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo verificar la contraseña' };
  }
});

/* ===================== UI / NAV ===================== */
ipcMain.handle('ui:navigate', async (_evt, htmlOrObj, ctxArg) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return { ok: false, error: 'No hay ventana activa' };

  const payload = (typeof htmlOrObj === 'string') ? { html: htmlOrObj, ctx: ctxArg } : (htmlOrObj || {});
  const requested = path.basename(String(payload.html || '').trim()) || 'caja.html';

  const allowedFiles = new Set(['login.html', 'caja.html', 'lienzo.html', 'pedidos.html']);
  if (!allowedFiles.has(requested)) return { ok: false, error: 'Archivo no permitido' };

  const forceWindowFocus = async (targetIsLogin = false) => {
    try {
      win.setFocusable(true);
      if (process.platform === 'win32') {
        win.setAlwaysOnTop(true, 'screen-saver');
      }
      win.show();
      win.focus();
      win.webContents.focus();
      if (targetIsLogin) {
        setTimeout(() => {
          try {
            win.webContents.executeJavaScript(`
              (function(){
                const el = document.getElementById('usuario') || document.querySelector('input[autofocus]') || document.querySelector('input');
                if (el) { el.focus(); el.select && el.select(); }
              })();
            `, true);
          } catch {}
        }, 0);
      }
    } catch {}
    setTimeout(() => { try { if (process.platform === 'win32') win.setAlwaysOnTop(false); } catch {} }, 150);
  };

  if (requested !== 'login.html') {
    const user = store.get('user');
    if (!user || !user.rol) return { ok: false, error: 'Sesión requerida' };
    const rol = String(user.rol).toLowerCase();

    const allowedByRole = {
      caja: new Set(['caja.html', 'lienzo.html', 'pedidos.html']),
      produccion: new Set(['pedidos.html']),
      admin: new Set(['caja.html', 'lienzo.html', 'pedidos.html'])
    };
    const defByRole = { caja: 'caja.html', produccion: 'pedidos.html', admin: 'pedidos.html' };

    const target = (allowedByRole[rol]?.has(requested)) ? requested : (defByRole[rol] || 'caja.html');

    if (payload.ctx) store.set('ui:ctx', payload.ctx);

    try {
      await win.loadFile(rendererPath(target));
      await forceWindowFocus(false);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  } else {
    store.delete('ui:ctx');
    try {
      await win.loadFile(rendererPath('login.html'));
      await forceWindowFocus(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
});

/* ===================== UI CONTEXT (set/get/clear) ===================== */
ipcMain.handle('ui:setContext', async (_evt, ctx) => {
  try {
    store.set('ui:ctx', ctx || {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('ui:getContext', async () => {
  try {
    return store.get('ui:ctx') || null;
  } catch {
    return null;
  }
});

ipcMain.handle('ui:clearContext', async () => {
  try {
    store.delete('ui:ctx');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});


/* ===================== HELPERS ORDERS ===================== */
function calcularTotal(partidas = []) {
  return partidas.reduce((acc, it) => {
    const pu = Number(it.precio_unitario ?? it.pu ?? 0);
    const qty = Number(it.cantidad ?? it.cant ?? 0);
    return acc + (pu * qty);
  }, 0);
}

async function asegurarCliente({ nombre, telefono, correo, rfc, factura, canal }) {
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

function normalizarPedidoPayload(payload) {
  const c = payload.cliente || payload.client || {};
  const cliente = {
    nombre: c.nombre || c.name || '',
    telefono: c.tel || c.phone || null,
    correo: c.correo || c.email || null,
    rfc: c.rfc || null,
    factura: (c.factura === 'si' || c.factura === true || c.invoice_flag === true),
    canal: c.canal || c.channel || null
  };

  const items = (payload.items || []).map((it) => ({
    id: (it.id ?? it.partida_id ?? it.partidaId ?? it.dbId ?? null) ? Number(it.id ?? it.partida_id ?? it.partidaId ?? it.dbId) : null,
    cid: it.cid || it.cidClient || null,
    producto: it.producto || it.product || '',
    descripcion: it.desc || it.descripcion || '',
    ancho_cm: Number(it.ancho ?? it.ancho_cm ?? 0),
    alto_cm: Number(it.alto ?? it.alto_cm ?? 0),
    cantidad: Number(it.cant ?? it.cantidad ?? 1),
    info_color: it.color || it.info_color || '',
    acabados: it.acabados || '',
    precio_unitario: Number(it.pu ?? it.precio_unitario ?? 0),
  }));

  return {
    id: Number(payload.id || payload.pedidoId || 0) || null,
    folio: payload.folio,
    estado: payload.estado || 'Pendiente',
    sucursal_usuario: payload.sucursal || null,
    prioridad: payload.prioridad || 'Normal',
    fecha_entrega: payload.entregaFecha || null,
    hora_entrega: payload.entregaHora || null,
    anticipo: Number(payload.anticipo ?? 0),
    metodo_pago: payload.metodo_pago || 'Efectivo',
    cliente, items
  };
}

/* ===================== ORDERS ===================== */
ipcMain.handle('orders:create', async (_evt, payloadRaw) => {
  try {
    const p = normalizarPedidoPayload(payloadRaw);
    const clienteId = await asegurarCliente(p.cliente);
    const total = calcularTotal(p.items);

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

    if (p.items.length) {
      const values = [];
      const params = [];
      p.items.forEach((it, i) => {
        const idx = i * 10;
        values.push(
          `($${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},
            $${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10})`
        );
        params.push(
          pedidoId, it.producto, it.descripcion || null,
          it.ancho_cm || 0, it.alto_cm || 0, it.cantidad || 1,
          it.info_color || null, it.acabados || null,
          it.precio_unitario || 0, (it.precio_unitario || 0) * (it.cantidad || 0)
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

/** Guardar/actualizar pedido + partidas (conserva IDs) */
ipcMain.handle('orders:save', async (_evt, payloadRaw) => {
  const p = normalizarPedidoPayload(payloadRaw);
  const pedidoId = Number(p.id || 0);

  const clienteId = await asegurarCliente(p.cliente);
  const total = calcularTotal(p.items);

  if (!pedidoId) {
    const ins = await query(
      `INSERT INTO pedidos
        (folio, cliente_id, estado, sucursal_usuario, prioridad,
         fecha_entrega, hora_entrega, total, anticipo, metodo_pago, creado_en, actualizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
       RETURNING id`,
      [
        p.folio, clienteId, p.estado, p.sucursal_usuario, p.prioridad,
        p.fecha_entrega || null, p.hora_entrega || null,
        total, p.anticipo || 0, p.metodo_pago || 'Efectivo'
      ]
    );
    const newId = ins.rows[0].id;

    if (p.items.length) {
      const values = [];
      const params = [];
      p.items.forEach((it, i) => {
        const idx = i * 10;
        values.push(
          `($${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},
            $${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10})`
        );
        params.push(
          newId, it.producto, it.descripcion || null,
          it.ancho_cm || 0, it.alto_cm || 0, it.cantidad || 1,
          it.info_color || null, it.acabados || null,
          it.precio_unitario || 0, (it.precio_unitario || 0) * (it.cantidad || 0)
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

    return { ok: true, id: newId, partMap: [] };
  }

  await query('BEGIN');
  try {
    await query(
      `UPDATE pedidos
         SET folio=$2, cliente_id=$3, estado=$4, sucursal_usuario=$5, prioridad=$6,
             fecha_entrega=$7, hora_entrega=$8, total=$9, anticipo=$10, metodo_pago=$11,
             actualizado_en=NOW()
       WHERE id=$1`,
      [
        pedidoId, p.folio, clienteId, p.estado, p.sucursal_usuario, p.prioridad,
        p.fecha_entrega || null, p.hora_entrega || null,
        total, p.anticipo || 0, p.metodo_pago || 'Efectivo'
      ]
    );

    const existing = await query(`SELECT id FROM partidas WHERE pedido_id=$1`, [pedidoId]);
    const existingIds = new Set(existing.rows.map(r => Number(r.id)));

    const keptIds = new Set();
    const partMap = [];

    for (const it of (p.items || [])) {
      const sid = Number(it.id || 0);
      const subtotal = (Number(it.precio_unitario || 0) * Number(it.cantidad || 0)) || 0;

      if (sid && existingIds.has(sid)) {
        await query(
          `UPDATE partidas SET
             producto=$2, descripcion=$3, ancho_cm=$4, alto_cm=$5,
             cantidad=$6, info_color=$7, acabados=$8, precio_unitario=$9, subtotal=$10
           WHERE id=$1`,
          [sid, it.producto, it.descripcion || null, it.ancho_cm || 0, it.alto_cm || 0,
           it.cantidad || 1, it.info_color || null, it.acabados || null, it.precio_unitario || 0, subtotal]
        );
        keptIds.add(sid);
        if (it.cid) partMap.push({ cid: it.cid, id: sid });
      } else {
        const insP = await query(
          `INSERT INTO partidas
            (pedido_id, producto, descripcion, ancho_cm, alto_cm,
             cantidad, info_color, acabados, precio_unitario, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [pedidoId, it.producto, it.descripcion || null, it.ancho_cm || 0, it.alto_cm || 0,
           it.cantidad || 1, it.info_color || null, it.acabados || null, it.precio_unitario || 0, subtotal]
        );
        const newPartId = insP.rows[0].id;
        keptIds.add(newPartId);
        if (it.cid) partMap.push({ cid: it.cid, id: newPartId });
      }
    }

    const toDelete = [...existingIds].filter(id => !keptIds.has(id));
    if (toDelete.length) {
      await query(`DELETE FROM partidas WHERE pedido_id=$1 AND id = ANY($2)`, [pedidoId, toDelete]);
    }

    await query(`UPDATE pedidos SET actualizado_en=NOW() WHERE id=$1`, [pedidoId]);

    await query('COMMIT');
    return { ok: true, id: pedidoId, partMap };
  } catch (err) {
    await query('ROLLBACK');
    return { ok: false, error: String(err?.detail || err?.message || err) };
  }
});

ipcMain.handle('orders:list', async (_evt, filtros = {}) => {
  const q = filtros.q ?? null;
  const estado = filtros.estado ?? null;
  const desde = filtros.desde ?? null;
  const hasta = filtros.hasta ?? null;

  const clauses = [];
  const params = [];
  let p = 1;

  if (q) { clauses.push(`(p.folio ILIKE $${p} OR c.nombre ILIKE $${p})`); params.push(`%${q}%`); p++; }
  if (estado) { clauses.push(`p.estado = $${p}`); params.push(estado); p++; }
  if (desde) { clauses.push(`p.fecha_entrega >= $${p}`); params.push(desde); p++; }
  if (hasta) { clauses.push(`p.fecha_entrega <= $${p}`); params.push(hasta); p++; }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT p.id, p.folio, c.nombre AS cliente, p.estado,
           p.fecha_entrega, p.actualizado_en, p.total, p.orden_prio, p.pinned
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    ${where}
    ORDER BY p.pinned DESC, p.orden_prio DESC NULLS LAST, p.actualizado_en DESC
    LIMIT 500
  `;
  const { rows } = await query(sql, params);
  return rows;
});


/** NUEVO: guardar orden/prioridad visual de una lista de pedidos */
ipcMain.handle('orders:setOrder', async (_evt, idsRaw) => {
  try {
    const ids = (Array.isArray(idsRaw) ? idsRaw : []).map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return { ok: false, error: 'Lista vacía' };

    // Asignar pesos altos al primero, decreciendo.
    // Usamos base = epoch segundos para reducir colisiones entre llamadas.
    const base = Math.floor(Date.now() / 1000) + ids.length;
    const ords = ids.map((_, i) => base - i); // mayor = más prioridad

    await query(`
      WITH data AS (
        SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS ord
      )
      UPDATE pedidos p
         SET orden_prio = d.ord
        FROM data d
       WHERE p.id = d.id
    `, [ids, ords]);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.detail || e.message || 'No se pudo guardar el orden' };
  }
});

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

ipcMain.handle('orders:updatePartida', async (_evt, { partidaId, data }) => {
  const fields = [];
  const params = [];
  let p = 1;

  const allow = {
    producto: 'text',
    descripcion: 'text',
    ancho_cm: 'numeric',
    alto_cm: 'numeric',
    cantidad: 'int',
    info_color: 'text',
    acabados: 'text',
    precio_unitario: 'numeric',
    subtotal: 'numeric',
  };

  for (const k of Object.keys(data || {})) {
    if (!(k in allow)) continue;
    fields.push(`${k} = $${p++}`);
    params.push(data[k]);
  }
  if (!fields.length) return { ok: false, error: 'Sin cambios' };

  params.push(partidaId);
  const sql = `UPDATE partidas SET ${fields.join(', ')} WHERE id = $${p} RETURNING pedido_id`;
  const res = await query(sql, params);
  const pedidoId = res.rows?.[0]?.pedido_id || null;
  return { ok: true, pedidoId };
});

ipcMain.handle('orders:recalcTotals', async (_evt, pedidoId) => {
  const it = await query(`SELECT subtotal FROM partidas WHERE pedido_id=$1`, [pedidoId]);
  const total = it.rows.reduce((s, r) => s + Number(r.subtotal || 0), 0);
  await query(`UPDATE pedidos SET total=$2, actualizado_en=NOW() WHERE id=$1`, [pedidoId, total]);
  return { ok: true, total };
});

ipcMain.handle('orders:delete', async (_evt, pedidoIdRaw) => {
  const pedidoId = Number(pedidoIdRaw || 0);
  if (!pedidoId) return { ok: false, error: 'ID inválido' };
  await query('BEGIN');
  try {
    await query(`DELETE FROM disenos WHERE pedido_id=$1`, [pedidoId]);
    await query(`DELETE FROM partidas WHERE pedido_id=$1`, [pedidoId]);
    await query(`DELETE FROM pedidos WHERE id=$1`, [pedidoId]);
    await query('COMMIT');
    return { ok: true };
  } catch (e) {
    await query('ROLLBACK');
    return { ok: false, error: e.detail || e.message || 'No se pudo eliminar el pedido' };
  }
});

/* ===================== MEDIA ===================== */
ipcMain.handle('media:list', async (_evt, filter = {}) => {
  const tag = filter.tag || null;

  let sql = `
    SELECT id,
           nombre_archivo,
           tipo_mime,
           ancho_px, alto_px,
           encode(datos, 'base64') AS b64,
           huella_sha256, origen,
           creado_en
    FROM medios
  `;
  const params = [];
  if (tag) { sql += ` WHERE origen = $1`; params.push(tag); }
  sql += ` ORDER BY creado_en DESC LIMIT 500`;

  const { rows } = await query(sql, params);
  return rows.map(r => ({
    id: r.id,
    filename: r.nombre_archivo,
    mime: r.tipo_mime,
    width: r.ancho_px,
    height: r.alto_px,
    dataUrl: `data:${r.tipo_mime};base64,${r.b64}`,
    sha256: r.huella_sha256,
    origin: r.origen,
    tags: [],
    created_at: r.creado_en
  }));
});

ipcMain.handle('media:upload', async (_evt, payload) => {
  const filename = payload.filename || 'archivo';
  const mime     = payload.mime || 'image/png';
  const w        = Number(payload.width || 0);
  const h        = Number(payload.height || 0);
  const tags     = Array.isArray(payload.tags) ? payload.tags : [];
  const dataUrlOrBase64 = String(payload.base64 || '');
  const origin   = payload.origin || (tags.includes('logo') ? 'logo' : (tags.includes('preview') ? 'preview' : 'uploader'));

  if (!dataUrlOrBase64) return { ok: false, error: 'Imagen vacía' };

  const sha = sha256Base64(dataUrlOrBase64);
  const base64 = dataUrlOrBase64.replace(/^data:[^,]+,/, '');

  const bytes = Math.max(0,
    Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  );

  const sql = `
    INSERT INTO medios
      (nombre_archivo, tipo_mime, ancho_px, alto_px,
       datos, huella_sha256, origen, bytes, creado_en)
    VALUES ($1,$2,$3,$4, decode($5,'base64'), $6,$7,$8, NOW())
    ON CONFLICT (huella_sha256) DO UPDATE
      SET nombre_archivo = EXCLUDED.nombre_archivo,
          tipo_mime      = EXCLUDED.tipo_mime,
          ancho_px       = EXCLUDED.ancho_px,
          alto_px        = EXCLUDED.alto_px,
          origen         = EXCLUDED.origen,
          bytes          = EXCLUDED.bytes
    RETURNING id, nombre_archivo, tipo_mime, ancho_px, alto_px,
              huella_sha256, origen, creado_en,
              encode(datos,'base64') AS b64
  `;
  const { rows } = await query(sql, [filename, mime, w, h, base64, sha, origin, bytes]);
  const row = rows[0];

  return {
    ok: true,
    id: row.id,
    filename: row.nombre_archivo,
    mime: row.tipo_mime,
    width: row.ancho_px,
    height: row.alto_px,
    dataUrl: `data:${row.tipo_mime};base64,${row.b64}`,
    sha256: row.huella_sha256,
    origin: row.origen,
    tags: [],
    created_at: row.creado_en
  };
});

/* ===================== DISEÑO / PREVIEW ===================== */
ipcMain.handle('design:savePreview', async (_evt, payload) => {
  const pedidoId = Number(payload?.pedidoId || 0);
  const partidaId = Number(payload?.partidaId || 0);
  const medioId = Number(payload?.medioId || 0);
  const nombrePlantilla = String(payload?.nombrePlantilla || null);
  const lienzoAnchoPx = payload?.lienzoAnchoPx != null ? Number(payload.lienzoAnchoPx) : null;
  const lienzoAltoPx = payload?.lienzoAltoPx != null ? Number(payload.lienzoAltoPx) : null;
  const modoColor = String(payload?.modoColor || null);
  const sangradoPx = payload?.sangradoPx != null ? Number(payload.sangradoPx) : null;

  if (!pedidoId || !partidaId || !medioId) return { ok: false, error: 'payload incompleto' };

  const sql = `
    INSERT INTO disenos
      (pedido_id, partida_id, titulo, nombre_plantilla,
       lienzo_ancho_px, lienzo_alto_px, modo_color, sangrado_px,
       preview_medio_id, estado, creado_en, actualizado_en)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,'borrador', now(), now())
    ON CONFLICT (pedido_id, partida_id)
    DO UPDATE SET
      titulo            = EXCLUDED.titulo,
      nombre_plantilla  = EXCLUDED.nombre_plantilla,
      lienzo_ancho_px   = EXCLUDED.lienzo_ancho_px,
      lienzo_alto_px    = EXCLUDED.lienzo_alto_px,
      modo_color        = EXCLUDED.modo_color,
      sangrado_px       = EXCLUDED.sangrado_px,
      preview_medio_id  = EXCLUDED.preview_medio_id,
      actualizado_en    = now()
    RETURNING id
  `;
  const titulo = `Diseño partida #${partidaId}`;
  const { rows } = await query(sql, [
    pedidoId, partidaId, titulo, nombrePlantilla || null,
    lienzoAnchoPx, lienzoAltoPx, modoColor || null, sangradoPx, medioId
  ]);
  return { ok: true, id: rows[0].id };
});

ipcMain.handle('design:listByPedido', async (_evt, pedidoId) => {
  const sql = `
    SELECT d.partida_id,
           d.preview_medio_id AS medio_id,
           m.nombre_archivo,
           'data:' || m.tipo_mime || ';base64,' || encode(m.datos,'base64') AS dataurl
    FROM disenos d
    JOIN medios m ON m.id = d.preview_medio_id
    WHERE d.pedido_id = $1
    ORDER BY d.actualizado_en DESC
  `;
  const { rows } = await query(sql, [Number(pedidoId)]);
  return rows.map(r => ({
    partida_id: Number(r.partida_id),
    medio_id: Number(r.medio_id),
    nombre_archivo: r.nombre_archivo,
    dataUrl: r.dataurl
  }));
});

/* ===================== CLIENTES ===================== */
ipcMain.handle('clientes:search', async (_evt, qRaw) => {
  const q = String(qRaw || '').trim();
  if (!q) return [];
  const like = `%${q}%`;
  const sql = `
    SELECT id, nombre, telefono, correo, rfc, facturar, canal
    FROM clientes
    WHERE nombre ILIKE $1 OR correo ILIKE $1 OR telefono ILIKE $1 OR rfc ILIKE $1
    ORDER BY nombre ASC
    LIMIT 12
  `;
  const { rows } = await query(sql, [like]);
  return rows.map(r => ({
    id: r.id,
    nombre: r.nombre,
    telefono: r.telefono,
    correo: r.correo,
    rfc: r.rfc,
    facturar: !!r.facturar,
    canal: r.canal
  }));
});

ipcMain.handle('clientes:findOne', async (_evt, { correo=null, telefono=null } = {}) => {
  if (!correo && !telefono) return null;
  const sql = `
    SELECT id, nombre, telefono, correo, rfc, facturar, canal
    FROM clientes
    WHERE ($1::text IS NOT NULL AND correo = $1::text)
       OR ($2::text IS NOT NULL AND telefono = $2::text)
    ORDER BY id DESC
    LIMIT 1
  `;
  const { rows } = await query(sql, [correo, telefono]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, nombre: r.nombre, telefono: r.telefono, correo: r.correo,
    rfc: r.rfc, facturar: !!r.facturar, canal: r.canal
  };
});

ipcMain.handle('clientes:get', async (_evt, idRaw) => {
  const id = Number(idRaw || 0);
  if (!id) return null;
  const { rows } = await query(`SELECT id, nombre, telefono, correo, rfc, facturar, canal FROM clientes WHERE id=$1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, nombre: r.nombre, telefono: r.telefono, correo: r.correo,
    rfc: r.rfc, facturar: !!r.facturar, canal: r.canal
  };
});

// ========== Pin (Fijar pedidos arriba) ==========
const PIN_TOP = 2000000000; // valor alto pero dentro de INT32

/** Fijar o quitar pin (global) */
ipcMain.handle('orders:togglePin', async (_evt, { id, pin }) => {
  try {
    const pid = Number(id || 0);
    if (!pid) return { ok: false, error: 'ID inválido' };

    // Al fijar, ponemos orden_prio con epoch para que el último pin suba dentro del grupo fijado
    const epoch = Math.floor(Date.now() / 1000);

    await query(
      `UPDATE pedidos
         SET pinned = $2,
             orden_prio = CASE WHEN $2 THEN GREATEST(COALESCE(orden_prio,0), $3) ELSE GREATEST($3, COALESCE(orden_prio,0)) END,
             actualizado_en = NOW()
       WHERE id = $1`,
      [pid, !!pin, epoch]
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.detail || e.message || 'No se pudo cambiar el pin' };
  }
});


/** Guardar el orden de los pedidos fijados (arriba) */
ipcMain.handle('orders:setPinnedOrder', async (_evt, idsRaw) => {
  try {
    const ids = (Array.isArray(idsRaw) ? idsRaw : [])
      .map(n => Number(n))
      .filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return { ok: false, error: 'Lista vacía' };

    // Base descendente (mayor = más arriba)
    const base = Math.floor(Date.now() / 1000) + ids.length;
    const ords = ids.map((_, i) => base - i);

    await query(`
      WITH data AS (
        SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS ord
      )
      UPDATE pedidos p
         SET orden_prio = d.ord, actualizado_en = NOW()
        FROM data d
       WHERE p.id = d.id AND p.pinned = TRUE
    `, [ids, ords]);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.detail || e.message || 'No se pudo guardar el orden de fijados' };
  }
});

