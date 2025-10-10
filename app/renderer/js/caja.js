/* =========================================================
   Caja · Registro de Pedido — RockyPrint
   Ítems en dos filas + botón Lienzo por ítem
   Guarda/edita en DB, navega a Lienzo con contexto
   ========================================================= */
(() => {

  // ---------- Guardia de sesión/rol ----------
  (async () => {
    try {
      const me = await window.api.auth.get();
      if (!me) { await window.api.navigate('login.html'); return; }

      const pagina = location.pathname.split('/').pop();
      const rol = (me.rol || '').toLowerCase();
      const allow = {
        'caja.html': ['caja', 'admin'],
        'lienzo.html': ['caja', 'admin'],
        'pedidos.html': ['produccion', 'admin', 'caja']
      };
      const ok = (allow[pagina] || ['admin']).includes(rol);
      if (!ok) {
        alert(`No tienes acceso a ${pagina}. Tu rol: ${rol}.`);
        if (rol === 'caja') await window.api.navigate('caja.html');
        else if (rol === 'produccion') await window.api.navigate('pedidos.html');
        else await window.api.navigate('pedidos.html');
      }
    } catch {
      await window.api.navigate('login.html');
      return;
    }
  })();

  // ---------- Helpers ----------
  const $ = (q, ctx = document) => ctx.querySelector(q);
  const $$ = (q, ctx = document) => Array.from(ctx.querySelectorAll(q));
  const fmtMoney = (v) => (new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })).format(+v || 0);
  const clamp = (v, min, max) => Math.min(Math.max(+v || 0, min), max);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const toNull = s => { const t = (s ?? '').toString().trim(); return t === '' ? null : t; };

  const params = new URLSearchParams(location.search);
  const pedidoIdParam = params.get('pedidoId');

  // ---------- Estado ----------
  const state = {
    folio: "",
    fechaHora: "",
    estado: "Pendiente",
    // Nota: mantenemos "email" en estado por compatibilidad con la UI, pero al guardar se envía "correo"
    cliente: { nombre: "", tel: "", email: "", rfc: "", factura: "no", canal: "Mostrador" },
    pedido: { entregaFecha: "", entregaHora: "", prioridad: "Normal", sucursal: "" },
    items: [],
    totales: { anticipo: 0, metodo: "Efectivo" }
  };

  // ---------- Inicialización ----------
  function genFolio() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `RP-${y}${m}${day}-${rand}`;
  }

  async function init() {
    if (pedidoIdParam) {
      await loadPedidoFromDB(Number(pedidoIdParam));
    } else {
      try {
        const raw = localStorage.getItem('rockyprint:caja:last');
        if (raw) { Object.assign(state, JSON.parse(raw)); }
        else {
          state.folio = genFolio();
          state.fechaHora = new Date().toLocaleString('es-MX');
          state.items = [newItem()];
        }
      } catch { }
    }

    $('#folio').value = state.folio;
    $('#fechaHora').value = state.fechaHora;
    $('#estado').value = state.estado;

    $('#cliNombre').value = state.cliente.nombre;
    $('#cliTel').value = state.cliente.tel;
    $('#cliEmail').value = state.cliente.email;   // UI usa "email"
    $('#cliRFC').value = state.cliente.rfc;
    $('#factura').value = state.cliente.factura;
    $('#canal').value = state.cliente.canal;

    $('#entregaFecha').value = state.pedido.entregaFecha;
    $('#entregaHora').value = state.pedido.entregaHora;
    $('#prioridad').value = state.pedido.prioridad;
    $('#sucursal').value = state.pedido.sucursal;

    $('#anticipo').value = state.totales.anticipo;
    $('#metodo').value = state.totales.metodo;

    renderItems();
    recalc();
    wireEvents();
  }

  async function loadPedidoFromDB(id) {
    const data = await window.api.orders.get(id);
    if (!data) return;

    state.folio = data.pedido.folio;
    state.estado = data.pedido.estado;

    state.cliente = {
      nombre: data.cliente?.nombre || '',
      tel: data.cliente?.telefono || '',
      email: data.cliente?.correo || '', // DB usa 'correo'
      rfc: data.cliente?.rfc || '',
      factura: (data.cliente?.facturar ? 'si' : 'no'),
      canal: data.cliente?.canal || 'Mostrador'
    };

    state.pedido = {
      entregaFecha: data.pedido.fecha_entrega || '',   // antes: entrega_fecha
      entregaHora: data.pedido.hora_entrega || '',   // antes: entrega_hora
      prioridad: data.pedido.prioridad || 'Normal',
      sucursal: data.pedido.sucursal_usuario || ''
    };

    state.items = (data.partidas || []).map(p => ({
      id: crypto.randomUUID(),
      producto: p.producto || '',
      desc: p.descripcion || '',
      ancho: Number(p.ancho_cm || 0),
      alto: Number(p.alto_cm || 0),
      cant: Number(p.cantidad || 1),
      color: p.info_color || '',
      acabados: p.acabados || '',
      pu: Number(p.precio_unitario || 0),
      selected: false
    }));

    state.totales.anticipo = Number(data.pedido.anticipo_monto || 0);
    state.totales.metodo = data.pedido.metodo_pago || 'Efectivo';
  }

  // ---------- Ítem ----------
  function newItem(partial = {}) {
    return Object.assign({
      id: crypto.randomUUID(),
      producto: "",
      desc: "",
      ancho: 0,
      alto: 0,
      cant: 1,
      color: "",
      acabados: "",
      pu: 0,
      selected: false
    }, partial);
  }

  // ---------- Render ----------
  function renderItems() {
    const list = $('#itemsList');
    list.innerHTML = '';
    state.items.forEach((it, idx) => {
      const card = createItemCard(it, idx);
      list.appendChild(card);
    });
  }

  function createItemCard(it, idx) {
    const el = document.createElement('article');
    el.className = 'item';
    el.dataset.id = it.id;
    el.draggable = false;

    el.innerHTML = `
      <div class="row1">
        <div class="drag"><button class="handle" title="Arrastrar">⇅</button></div>
        <div class="prod">
          <label>Producto</label>
          <input class="i-producto" placeholder="Ej. Lona 3x2m / Tarjetas" value="${esc(it.producto)}" />
        </div>
        <div class="desc">
          <label>Descripción</label>
          <input class="i-desc" placeholder="Detalles: papel, gramaje, colores…" value="${esc(it.desc)}" />
        </div>
        <div class="sel">
          <label>Sel</label>
          <input class="i-sel" type="checkbox" ${it.selected ? 'checked' : ''} />
        </div>
      </div>
      <div class="row2">
        <div>
          <label>Ancho (cm)</label>
          <input class="i-ancho" type="number" step="0.01" min="0" value="${it.ancho || 0}" />
        </div>
        <div>
          <label>Alto (cm)</label>
          <input class="i-alto" type="number" step="0.01" min="0" value="${it.alto || 0}" />
        </div>
        <div>
          <label>Cant.</label>
          <input class="i-cant" type="number" step="1" min="1" value="${it.cant || 1}" />
        </div>
        <div>
          <label>Tintas / Color</label>
          <input class="i-color" placeholder="Tintas / CMYK" value="${esc(it.color)}" />
        </div>
        <div>
          <label>Acabados</label>
          <input class="i-acab" placeholder="Laminado, corte, suaje…" value="${esc(it.acabados)}" />
        </div>
        <div>
          <label>PU ($)</label>
          <input class="i-pu" type="number" step="0.01" min="0" value="${it.pu || 0}" />
        </div>
        <div>
          <label>Subtotal</label>
          <div class="money i-subtotal">${fmtMoney(calcItemSubtotal(it))}</div>
        </div>
        <div style="display:flex; align-items:flex-end">
          <button class="btn i-lienzo" title="Abrir lienzo de este ítem">🎨 Lienzo</button>
        </div>
      </div>
    `;

    bindItemCard(el, it, idx);
    attachCardDrag(el);
    return el;
  }

  function bindItemCard(card, it, idx) {
    $('.i-producto', card).addEventListener('input', e => { it.producto = e.target.value; saveLocal(); });
    $('.i-desc', card).addEventListener('input', e => { it.desc = e.target.value; saveLocal(); });
    $('.i-sel', card).addEventListener('change', e => { it.selected = !!e.target.checked; saveLocal(); });

    $('.i-ancho', card).addEventListener('input', e => { it.ancho = +e.target.value || 0; recalc(); });
    $('.i-alto', card).addEventListener('input', e => { it.alto = +e.target.value || 0; recalc(); });
    $('.i-cant', card).addEventListener('input', e => { it.cant = clamp(e.target.value, 1, 1e9); recalc(); });
    $('.i-color', card).addEventListener('input', e => { it.color = e.target.value; saveLocal(); });
    $('.i-acab', card).addEventListener('input', e => { it.acabados = e.target.value; saveLocal(); });
    $('.i-pu', card).addEventListener('input', e => { it.pu = +e.target.value || 0; recalc(); });

    // Botón Lienzo (se queda donde está)
    const btnLienzo = $('.i-lienzo', card);
    btnLienzo.addEventListener('click', () => openLienzoForItem(idx));
  }

  // ---------- Drag & Drop ----------
  let dragId = null;
  function attachCardDrag(card) {
    const handle = $('.handle', card);
    handle.setAttribute('draggable', 'true');

    handle.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('row-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    handle.addEventListener('dragend', () => {
      card.classList.remove('row-dragging');
      dragId = null;
    });

    card.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (card.dataset.id !== dragId) card.classList.add('row-over');
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('dragleave', () => card.classList.remove('row-over'));
    card.addEventListener('drop', () => {
      card.classList.remove('row-over');
      if (!dragId || card.dataset.id === dragId) return;
      moveBefore(dragId, card.dataset.id);
      renderItems();
      recalc();
    });
  }

  function moveBefore(sourceId, targetId) {
    const from = state.items.findIndex(x => x.id === sourceId);
    const to = state.items.findIndex(x => x.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const [item] = state.items.splice(from, 1);
    state.items.splice(to, 0, item);
    saveLocal();
  }

  // ---------- Cálculos ----------
  function calcItemSubtotal(it) {
    return (it.pu || 0) * (it.cant || 0);
  }

  function recalc() {
    const cards = $$('#itemsList .item');
    cards.forEach((card, idx) => {
      const it = state.items[idx];
      const subEl = $('.i-subtotal', card);
      if (subEl) subEl.textContent = fmtMoney(calcItemSubtotal(it));
    });

    const total = state.items.reduce((s, it) => s + calcItemSubtotal(it), 0);
    const anticipo = clamp($('#anticipo').value, 0, total);
    const saldo = total - anticipo;

    $('#anticipo').value = anticipo;
    $('#rTotal').textContent = fmtMoney(total);
    $('#rTotal2').textContent = fmtMoney(total);
    $('#rAnticipo').textContent = fmtMoney(anticipo);
    $('#rSaldo').textContent = fmtMoney(saldo);

    state.totales.anticipo = anticipo;
    saveLocal();
  }

  // ---------- Abrir Lienzo para un ítem ----------
  async function openLienzoForItem(index) {
    const pedidoId = await guardarEnDB();

    let partidaId = null;
    try {
      const data = await window.api.orders.get(pedidoId);
      const part = data?.partidas?.[index];
      if (part) partidaId = String(part.id);
    } catch { }

    await window.api.ui.setContext({
      pedidoId: String(pedidoId),
      partidaId,
      partidaIndex: index
    });
    await window.api.navigate('lienzo.html');
  }

  // ---------- Eventos globales ----------
  function wireEvents() {
    $('#btnAddItem').addEventListener('click', () => {
      state.items.push(newItem());
      renderItems(); recalc();
    });

    $('#btnDelItem').addEventListener('click', () => {
      const any = state.items.some(x => x.selected);
      if (!any) { alert('Selecciona al menos un ítem (switch "Sel").'); return; }
      state.items = state.items.filter(x => !x.selected);
      if (state.items.length === 0) state.items.push(newItem());
      renderItems(); recalc();
    });

    $('#btnDupItem').addEventListener('click', () => {
      const idx = state.items.findIndex(x => x.selected);
      if (idx < 0) { alert('Selecciona un ítem a duplicar.'); return; }
      const base = state.items[idx];
      const copy = newItem({ ...base, id: crypto.randomUUID(), selected: false });
      state.items.splice(idx + 1, 0, copy);
      renderItems(); recalc();
    });

    // Totales
    $('#anticipo').addEventListener('input', recalc);
    $('#metodo').addEventListener('change', e => { state.totales.metodo = e.target.value; saveLocal(); });

    // Datos generales
    $('#estado').addEventListener('change', e => { state.estado = e.target.value; saveLocal(); });

    // Cliente
    $('#cliNombre').addEventListener('input', e => { state.cliente.nombre = e.target.value; saveLocal(); });
    $('#cliTel').addEventListener('input', e => { state.cliente.tel = e.target.value; saveLocal(); });
    $('#cliEmail').addEventListener('input', e => { state.cliente.email = e.target.value; saveLocal(); });
    $('#cliRFC').addEventListener('input', e => { state.cliente.rfc = e.target.value; saveLocal(); });
    $('#factura').addEventListener('change', e => { state.cliente.factura = e.target.value; saveLocal(); });
    $('#canal').addEventListener('change', e => { state.cliente.canal = e.target.value; saveLocal(); });

    // Pedido
    $('#entregaFecha').addEventListener('change', e => { state.pedido.entregaFecha = e.target.value; saveLocal(); });
    $('#entregaHora').addEventListener('change', e => { state.pedido.entregaHora = e.target.value; saveLocal(); });
    $('#prioridad').addEventListener('change', e => { state.pedido.prioridad = e.target.value; saveLocal(); });
    $('#sucursal').addEventListener('input', e => { state.pedido.sucursal = e.target.value; saveLocal(); });

    // Chips rápidas
    $$('.chip.quick').forEach(ch => {
      ch.addEventListener('click', () => {
        const kind = ch.dataset.tpl;
        const presets = {
          'Tarjetas': { producto: 'Tarjetas de presentación', desc: 'Couché 300g, 9x5 cm', cant: 100, pu: 350 },
          'Lona': { producto: 'Lona publicitaria', desc: 'Gran formato', ancho: 300, alto: 200, cant: 1, pu: 250 },
          'Playera': { producto: 'Playera personalizada', desc: 'Serigrafía 1 tinta', cant: 1, pu: 120 },
          'Vinil': { producto: 'Vinil recorte', desc: 'Rotulación', cant: 1, pu: 180 },
          'Sublimación': { producto: 'Taza sublimada', desc: 'Full color', cant: 1, pu: 90 },
        };
        state.items.push(newItem(presets[kind] || {}));
        renderItems(); recalc();
      });
    });

    // Guardar / Exportar / Imprimir / Nuevo
    $('#btnGuardar').addEventListener('click', guardarYToast);
    $('#btnExportar').addEventListener('click', exportJSON);
    $('#btnImprimir').addEventListener('click', printOrder);

    $('#btnNuevo').addEventListener('click', () => {
      if (!confirm('Iniciar un pedido nuevo? Se limpiará el formulario.')) return;
      Object.assign(state, {
        folio: genFolio(),
        fechaHora: new Date().toLocaleString('es-MX'),
        estado: 'Pendiente',
        cliente: { nombre: "", tel: "", email: "", rfc: "", factura: "no", canal: "Mostrador" },
        pedido: { entregaFecha: "", entregaHora: "", prioridad: "Normal", sucursal: "" },
        items: [newItem()],
        totales: { anticipo: 0, metodo: "Efectivo" }
      });
      renderItems(); recalc();
      $('#folio').value = state.folio;
      $('#fechaHora').value = state.fechaHora;
      $('#estado').value = state.estado;
      $('#cliNombre').value = '';
      $('#cliTel').value = '';
      $('#cliEmail').value = '';
      $('#cliRFC').value = '';
      $('#factura').value = 'no';
      $('#canal').value = 'Mostrador';
      $('#entregaFecha').value = '';
      $('#entregaHora').value = '';
      $('#prioridad').value = 'Normal';
      $('#sucursal').value = '';
      $('#anticipo').value = 0;
      $('#metodo').value = 'Efectivo';
      toast('Nuevo', 'Pedido reiniciado.');
      saveLocal();
      history.replaceState(null, '', location.pathname);
    });

    // Atajos
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); guardarYToast(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printOrder(); }
      if (e.key === 'Insert') { e.preventDefault(); $('#btnAddItem').click(); }
      if (e.key === 'Delete') { e.preventDefault(); $('#btnDelItem').click(); }
      if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); $('#btnNuevo').click(); }
    });
  }

  // ---------- Persistencia local ----------
  function saveLocal() { try { localStorage.setItem('rockyprint:caja:last', JSON.stringify(state)); } catch { } }
  function guardarYToast() {
    guardarEnDB()
      .then(() => toast('Guardado', 'Pedido guardado en base de datos.'))
      .catch(err => alert(err?.message || 'Error al guardar.'));
  }

  // ---------- Guardar en DB ----------
  async function guardarEnDB() {
    const ensureFolio = () => {
      let f = ($('#folio').value || state.folio || '').trim();
      if (!f) f = genFolio();
      return f;
    };

    const buildPayload = () => ({
      folio: ensureFolio(),
      estado: toNull($('#estado').value) || 'Pendiente',
      sucursal: toNull($('#sucursal').value),
      prioridad: toNull($('#prioridad').value) || 'Normal',
      entregaFecha: toNull($('#entregaFecha').value),
      entregaHora: toNull($('#entregaHora').value),
      anticipo: Number($('#anticipo').value || 0),
      metodo_pago: toNull($('#metodo').value) || 'Efectivo',
      cliente: {
        nombre: toNull($('#cliNombre').value),
        tel: toNull($('#cliTel').value),
        // DB espera 'correo' (no 'email'), y null si está vacío
        correo: toNull($('#cliEmail').value),
        rfc: toNull($('#cliRFC').value),
        factura: ($('#factura').value === 'si'),
        canal: toNull($('#canal').value)
      },
      items: state.items.map(it => ({
        producto: toNull(it.producto),
        desc: toNull(it.desc),
        ancho: Number(it.ancho || 0),
        alto: Number(it.alto || 0),
        cant: Number(it.cant || 1),
        color: toNull(it.color),
        acabados: toNull(it.acabados),
        pu: Number(it.pu || 0)
      }))
    });

    let payload = buildPayload();
    state.folio = payload.folio;

    let resp = await window.api.orders.create(payload);

    if (resp?.ok && resp?.id) {
      const pedidoId1 = Number(resp.id);
      history.replaceState(null, '', location.pathname + '?pedidoId=' + pedidoId1);
      return pedidoId1;
    }

    // Reintenta si el folio está duplicado
    if (resp && resp.ok === false && (resp.code === '23505' || /folio/i.test(resp.error || ''))) {
      const newFolio = genFolio();
      state.folio = newFolio;
      $('#folio').value = newFolio;

      payload = buildPayload();
      resp = await window.api.orders.create(payload);

      if (resp?.ok && resp?.id) {
        const pedidoId2 = Number(resp.id);
        history.replaceState(null, '', location.pathname + '?pedidoId=' + pedidoId2);
        return pedidoId2;
      }
    }

    // Propaga mensaje del server para ver el detalle (p.ej. tipo de parámetro)
    throw new Error(resp?.error || 'No se pudo guardar');
  }

  // ---------- Exportación / Impresión ----------
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${state.folio || 'pedido'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function printOrder() {
    const div = $('#printContent');

    const rows = state.items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.producto)}</td>
        <td>${esc(it.desc)}</td>
        <td style="text-align:right">${it.ancho || 0}</td>
        <td style="text-align:right">${it.alto || 0}</td>
        <td style="text-align:right">${it.cant || 0}</td>
        <td>${esc(it.color || '')}</td>
        <td>${esc(it.acabados || '')}</td>
        <td style="text-align:right">${fmtMoney(it.pu || 0)}</td>
        <td style="text-align:right">${fmtMoney(calcItemSubtotal(it))}</td>
      </tr>
    `).join('');

    const total = state.items.reduce((s, it) => s + calcItemSubtotal(it), 0);
    const saldo = total - (state.totales.anticipo || 0);

    div.innerHTML = `
      <table style="margin-bottom:8px">
        <tr><td><b>Folio:</b> ${state.folio}</td><td><b>Fecha:</b> ${state.fechaHora}</td></tr>
        <tr><td><b>Cliente:</b> ${esc(state.cliente.nombre)}</td><td><b>Tel:</b> ${esc(state.cliente.tel)}</td></tr>
        <tr><td><b>Email:</b> ${esc(state.cliente.email)}</td><td><b>Factura:</b> ${state.cliente.factura === 'si' ? 'Sí' : 'No'}</td></tr>
        <tr><td><b>Canal:</b> ${esc(state.cliente.canal)}</td><td><b>Estado:</b> ${esc(state.estado)}</td></tr>
        <tr><td><b>Entrega:</b> ${state.pedido.entregaFecha || '-'} ${state.pedido.entregaHora || ''}</td><td><b>Prioridad:</b> ${esc(state.pedido.prioridad)}</td></tr>
      </table>

      <table>
        <thead>
          <tr>
            <th>#</th><th>Producto</th><th>Descripción</th>
            <th>Ancho</th><th>Alto</th><th>Cant</th><th>Tintas/Color</th><th>Acabados</th><th>PU</th><th>Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <table style="margin-top:8px">
        <tr><td><b>Total</b></td><td style="text-align:right">${fmtMoney(total)}</td></tr>
        <tr><td><b>Anticipo</b></td><td style="text-align:right">${fmtMoney(state.totales.anticipo || 0)}</td></tr>
        <tr><td><b>Saldo</b></td><td style="text-align:right">${fmtMoney(saldo)}</td></tr>
        <tr><td><b>Método de pago</b></td><td style="text-align:right">${esc(state.totales.metodo || '-')}</td></tr>
      </table>
    `;
    window.print();
  }

  // ---------- UI: toast ----------
  function toast(title, text) {
    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed; right: 16px; top: 16px; z-index: 9999;
      background: #0f172a; border:1px solid #1f2a44; color:#dbeafe;
      padding:10px 12px; border-radius:10px; box-shadow: 0 8px 20px rgba(0,0,0,.25);
      font: 13px/1.3 system-ui, Segoe UI, Roboto;
    `;
    box.innerHTML = `<strong style="display:block;margin-bottom:4px">${title}</strong><span>${text}</span>`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1600);
  }

  // ---------- Go! ----------
  init();

})();
