/* Caja · Registro de Pedido — Ítems en dos filas + Lienzo + Preview + Autocompletar cliente */
(() => {
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
    } catch { await window.api.navigate('login.html'); return; }
  })();

  const $  = (q, ctx = document) => ctx.querySelector(q);
  const $$ = (q, ctx = document) => Array.from(ctx.querySelectorAll(q));
  const fmtMoney = (v) => (new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })).format(+v || 0);
  const clamp = (v, min, max) => Math.min(Math.max(+v || 0, min), max);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const toNull = s => { const t = (s ?? '').toString().trim(); return t === '' ? null : t; };
  const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ----------- REFERENCIAS DE CLIENTE + DATALIST (SEGURO) -----------
  const lastClientMap = new Map(); // "Nombre | Tel | Correo" -> row
  const cliNombreEl  = document.getElementById('cliNombre');
  const cliTelEl     = document.getElementById('cliTel');
  const cliEmailEl   = document.getElementById('cliEmail');
  const cliRFCEl     = document.getElementById('cliRFC');
  const cliFacturaEl = document.getElementById('factura');
  const cliCanalEl   = document.getElementById('canal');

  // Crea (si no existe) datalist y engancha al input
  const dlClientes = document.getElementById('dlClientes') || (() => {
    const d = document.createElement('datalist');
    d.id = 'dlClientes';
    document.body.appendChild(d);
    return d;
  })();
  if (cliNombreEl && cliNombreEl.getAttribute('list') !== 'dlClientes') {
    cliNombreEl.setAttribute('list', 'dlClientes');
  }

  // Botón "Quitar selección" (si no existe, lo creamos junto al input)
  const cliClearBtn = document.getElementById('cliClearBtn') || (() => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'cliClearBtn';
    b.textContent = 'Quitar selección';
    b.className = 'btn';
    b.style.display = 'none';
    if (cliNombreEl && cliNombreEl.parentElement) {
      cliNombreEl.parentElement.appendChild(b);
    } else {
      document.body.appendChild(b);
    }
    return b;
  })();

  function fillFromCliente(cli) {
    if (cliNombreEl)  cliNombreEl.value  = cli.nombre   || '';
    if (cliTelEl)     cliTelEl.value     = cli.telefono || '';
    if (cliEmailEl)   cliEmailEl.value   = cli.correo   || '';
    if (cliRFCEl)     cliRFCEl.value     = cli.rfc      || '';
    if (cliFacturaEl) cliFacturaEl.value = cli.facturar ? 'si' : 'no';
    if (cliCanalEl)   cliCanalEl.value   = cli.canal    || 'Mostrador';

    state.cliente = {
      nombre: cli.nombre || '',
      tel: cli.telefono || '',
      email: cli.correo || '',
      rfc: cli.rfc || '',
      factura: cli.facturar ? 'si' : 'no',
      canal: cli.canal || 'Mostrador'
    };
    saveLocal();
    try { localStorage.setItem('rp:lastClientId', String(cli.id)); } catch {}
    toast('Cliente cargado', cli.nombre || '');
  }

  async function tryAutoFillByEmailOrPhone() {
    const correo   = (cliEmailEl?.value || '').trim();
    const telefono = (cliTelEl?.value   || '').trim();
    if (!correo && !telefono) return;
    const cli = await window.api.clientes
      .findOne({ correo: correo || null, telefono: telefono || null })
      .catch(() => null);
    if (cli) applyCliente(cli);
  }

  function applyCliente(row) {
    state.clienteId = row.id;
    if (cliNombreEl)  cliNombreEl.value  = row.nombre   || '';
    if (cliTelEl)     cliTelEl.value     = row.telefono || '';
    if (cliEmailEl)   cliEmailEl.value   = row.correo   || '';
    if (cliRFCEl)     cliRFCEl.value     = row.rfc      || '';
    if (cliFacturaEl) cliFacturaEl.value = row.facturar ? 'si' : 'no';
    if (cliCanalEl)   cliCanalEl.value   = row.canal    || 'Mostrador';
    toggleClienteLock(true);
    cliClearBtn.style.display = 'inline-block';
    saveLocal();
  }

  function toggleClienteLock(lock) {
    [cliNombreEl, cliTelEl, cliEmailEl, cliRFCEl].forEach(el => { if (el) el.readOnly = lock; });
    if (cliFacturaEl) cliFacturaEl.disabled = lock;
    if (cliCanalEl)   cliCanalEl.disabled   = lock;
  }

  function clearClienteSelection(clearFields = false) {
    state.clienteId = null;
    toggleClienteLock(false);
    cliClearBtn.style.display = 'none';
    if (clearFields) {
      if (cliNombreEl)  cliNombreEl.value  = '';
      if (cliTelEl)     cliTelEl.value     = '';
      if (cliEmailEl)   cliEmailEl.value   = '';
      if (cliRFCEl)     cliRFCEl.value     = '';
      if (cliFacturaEl) cliFacturaEl.value = 'no';
      if (cliCanalEl)   cliCanalEl.value   = 'Mostrador';
    }
    dlClientes.innerHTML = '';
    lastClientMap.clear();
    saveLocal();
  }

  // Listeners del autocompletado (con null-checks)
  if (cliNombreEl) {
    cliNombreEl.addEventListener('input', debounce(async () => {
      const q = cliNombreEl.value.trim();
      if (q.length < 2) { dlClientes.innerHTML = ''; lastClientMap.clear(); return; }
      const rows = await window.api.clientes.search(q).catch(() => []);
      dlClientes.innerHTML = '';
      lastClientMap.clear();
      rows.forEach(r => {
        const label = `${r.nombre || '-'} | ${r.telefono || '-'} | ${r.correo || '-'}`;
        const opt = document.createElement('option');
        opt.value = label;               // lo que el usuario ve/elige
        dlClientes.appendChild(opt);
        lastClientMap.set(label, r);     // mapeamos label -> fila
      });
    }, 200));

    cliNombreEl.addEventListener('change', () => {
      const key = cliNombreEl.value.trim();
      const row = lastClientMap.get(key);
      if (row) applyCliente(row); // si escogió de la lista exacta
    });
  }

  if (cliEmailEl) cliEmailEl.addEventListener('blur', tryAutoFillByEmailOrPhone);
  if (cliTelEl)   cliTelEl.addEventListener('blur', tryAutoFillByEmailOrPhone);
  if (cliClearBtn) cliClearBtn.addEventListener('click', () => clearClienteSelection(false));

  // ------------------ ESTADO / INICIALIZACIÓN ------------------
  const params = new URLSearchParams(location.search);
  let currentPedidoId = Number(params.get('pedidoId') || 0);

  const state = {
    folio: "",
    fechaHora: "",
    estado: "Pendiente",
    clienteId: null,
    cliente: { nombre: "", tel: "", email: "", rfc: "", factura: "no", canal: "Mostrador" },
    pedido: { entregaFecha: "", entregaHora: "", prioridad: "Normal", sucursal: "" },
    items: [],
    totales: { anticipo: 0, metodo: "Efectivo" }
  };

  function genFolio() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `RP-${y}${m}${day}-${rand}`;
  }

  async function init() {
    // Si no hay ?pedidoId= intenta leerlo del contexto (regreso desde Lienzo)
    if (!currentPedidoId) {
      try {
        const ctx = await window.api.ui.getContext();
        const ctxPid = Number(ctx?.pedidoId || 0);
        if (ctxPid) currentPedidoId = ctxPid;
      } catch {}
    }

    if (currentPedidoId) {
      await loadPedidoFromDB(Number(currentPedidoId));
    } else {
      try {
        const raw = localStorage.getItem('rockyprint:caja:last');
        if (raw) { Object.assign(state, JSON.parse(raw)); }
        else {
          state.folio = genFolio();
          state.fechaHora = new Date().toLocaleString('es-MX');
          state.items = [newItem()];

          // Si hay último cliente usado, lo pre-carga
          const lastId = Number(localStorage.getItem('rp:lastClientId') || 0);
          if (lastId) {
            const cli = await window.api.clientes.get(lastId).catch(() => null);
            if (cli && !state.cliente.nombre && !state.cliente.tel && !state.cliente.email) {
              fillFromCliente(cli);
            }
          }
        }
      } catch {}
    }

    $('#folio').value = state.folio;
    $('#fechaHora').value = state.fechaHora;
    $('#estado').value = state.estado;

    $('#cliNombre').value = state.cliente.nombre;
    $('#cliTel').value = state.cliente.tel;
    $('#cliEmail').value = state.cliente.email;
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

    // Migaja del lienzo (preview recién generado)
    try {
      const rawPrev = localStorage.getItem('rp:preview');
      if (rawPrev) {
        const prev = JSON.parse(rawPrev);
        if (!currentPedidoId && prev?.pedidoId) currentPedidoId = Number(prev.pedidoId);
        if (prev && Number(prev.pedidoId) === Number(currentPedidoId)) {
          const idx = Number(prev.partidaIndex || 0);
          const card = $$('#itemsList .item')[idx];
          if (card) injectPreview(card, prev.dataUrl);
        }
        localStorage.removeItem('rp:preview');
      }
    } catch {}
  }

  async function loadPedidoFromDB(id) {
    const data = await window.api.orders.get(id);
    if (!data) return;

    state.folio  = data.pedido.folio;
    state.estado = data.pedido.estado;

    state.cliente = {
      nombre: data.cliente?.nombre || '',
      tel:    data.cliente?.telefono || '',
      email:  data.cliente?.correo || '',
      rfc:    data.cliente?.rfc || '',
      factura:(data.cliente?.facturar ? 'si' : 'no'),
      canal:  data.cliente?.canal || 'Mostrador'
    };

    state.pedido = {
      entregaFecha: data.pedido.fecha_entrega || '',
      entregaHora:  data.pedido.hora_entrega  || '',
      prioridad:    data.pedido.prioridad     || 'Normal',
      sucursal:     data.pedido.sucursal_usuario || ''
    };

    state.items = (data.partidas || []).map(p => ({
      id: crypto.randomUUID(),  // id efímero UI
      dbId: Number(p.id),       // id real en BD
      producto: p.producto || '',
      desc: p.descripcion || '',
      ancho: Number(p.ancho_cm || 0),
      alto:  Number(p.alto_cm  || 0),
      cant:  Number(p.cantidad || 1),
      color: p.info_color || '',
      acabados: p.acabados || '',
      pu: Number(p.precio_unitario || 0),
      selected: false
    }));

    state.totales.anticipo = Number(data.pedido.anticipo_monto || 0);
    state.totales.metodo   = data.pedido.metodo_pago || 'Efectivo';

    try {
      const previews = await window.api.design.listByPedido(id);
      if (Array.isArray(previews) && previews.length) {
        const mapPrev = new Map(previews.map(p => [Number(p.partida_id), p]));
        (data.partidas || []).forEach((p, idx) => {
          const hit = mapPrev.get(Number(p.id));
          if (!hit) return;
          setTimeout(() => {
            const card = document.querySelectorAll('#itemsList .item')[idx];
            if (card) injectPreview(card, hit.dataUrl);
          }, 0);
        });
      }
    } catch {}
  }

  function injectPreview(card, dataUrl) {
    let spot = card.querySelector('.preview-spot');
    if (!spot) {
      spot = document.createElement('div');
      spot.className = 'preview-spot';
      spot.style.cssText = 'margin-top:8px;display:flex;gap:10px;align-items:center;';
      card.appendChild(spot);
    }
    spot.innerHTML = `<img src="${dataUrl}" alt="Preview" style="max-width:180px;max-height:120px;border-radius:8px;border:1px solid #d6def3;box-shadow:0 6px 16px rgba(0,0,0,.15)"/>`;
  }

  function newItem(partial = {}) {
    return Object.assign({
      id: crypto.randomUUID(), // id UI
      dbId: null,              // id en BD (nulo si aún no existe)
      producto: "", desc: "", ancho: 0, alto: 0, cant: 1,
      color: "", acabados: "", pu: 0, selected: false
    }, partial);
  }

  function renderItems() {
    const list = $('#itemsList'); list.innerHTML = '';
    state.items.forEach((it, idx) => list.appendChild(createItemCard(it, idx)));
  }

  function createItemCard(it, idx) {
    const el = document.createElement('article');
    el.className = 'item'; el.dataset.id = it.id; el.draggable = false;
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
        <div class="sel"><label>Sel</label><input class="i-sel" type="checkbox" ${it.selected ? 'checked' : ''} /></div>
      </div>
      <div class="row2">
        <div><label>Ancho (cm)</label><input class="i-ancho" type="number" step="0.01" min="0" value="${it.ancho || 0}" /></div>
        <div><label>Alto (cm)</label><input class="i-alto" type="number" step="0.01" min="0" value="${it.alto || 0}" /></div>
        <div><label>Cant.</label><input class="i-cant" type="number" step="1" min="1" value="${it.cant || 1}" /></div>
        <div><label>Tintas / Color</label><input class="i-color" placeholder="Tintas / CMYK" value="${esc(it.color)}" /></div>
        <div><label>Acabados</label><input class="i-acab" placeholder="Laminado, corte, suaje…" value="${esc(it.acabados)}" /></div>
        <div><label>PU ($)</label><input class="i-pu" type="number" step="0.01" min="0" value="${it.pu || 0}" /></div>
        <div><label>Subtotal</label><div class="money i-subtotal">${fmtMoney(calcItemSubtotal(it))}</div></div>

        <div style="display:flex;align-items:flex-end;gap:8px">
          <button class="btn i-lienzo" title="Abrir lienzo de este ítem">🎨 Lienzo</button>
          <button class="btn i-preview" title="Ver preview guardado">👁️ Preview</button>
        </div>
      </div>`;
    bindItemCard(el, it, idx); attachCardDrag(el); return el;
  }

  function bindItemCard(card, it, idx) {
    $('.i-producto', card).addEventListener('input', e => { it.producto = e.target.value; saveLocal(); });
    $('.i-desc', card).addEventListener('input', e => { it.desc = e.target.value; saveLocal(); });
    $('.i-sel', card).addEventListener('change', e => { it.selected = !!e.target.checked; saveLocal(); });

    $('.i-ancho', card).addEventListener('input', e => { it.ancho = +e.target.value || 0; recalc(); });
    $('.i-alto', card).addEventListener('input', e => { it.alto  = +e.target.value || 0; recalc(); });
    $('.i-cant', card).addEventListener('input', e => { it.cant  = clamp(e.target.value, 1, 1e9); recalc(); });
    $('.i-color', card).addEventListener('input', e => { it.color = e.target.value; saveLocal(); });
    $('.i-acab', card).addEventListener('input', e => { it.acabados = e.target.value; saveLocal(); });
    $('.i-pu', card).addEventListener('input', e => { it.pu    = +e.target.value || 0; recalc(); });

    $('.i-lienzo',  card).addEventListener('click', () => openLienzoForItem(idx));
    $('.i-preview', card).addEventListener('click', () => showPreviewForItem(idx, card));
  }

  // Drag
  let dragId = null;
  function attachCardDrag(card) {
    const handle = $('.handle', card); handle.setAttribute('draggable', 'true');
    handle.addEventListener('dragstart', (e) => { dragId = card.dataset.id; card.classList.add('row-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    handle.addEventListener('dragend',   () => { card.classList.remove('row-dragging'); dragId = null; });
    card.addEventListener('dragenter', (e) => { e.preventDefault(); if (card.dataset.id !== dragId) card.classList.add('row-over'); });
    card.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    card.addEventListener('dragleave', () => card.classList.remove('row-over'));
    card.addEventListener('drop',      () => { card.classList.remove('row-over'); if (!dragId || card.dataset.id === dragId) return; moveBefore(dragId, card.dataset.id); renderItems(); recalc(); });
  }
  function moveBefore(sourceId, targetId) {
    const from = state.items.findIndex(x => x.id === sourceId);
    const to   = state.items.findIndex(x => x.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const [item] = state.items.splice(from, 1); state.items.splice(to, 0, item); saveLocal();
  }

  function calcItemSubtotal(it) { return (it.pu || 0) * (it.cant || 0); }

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
    $('#rTotal').textContent   = fmtMoney(total);
    $('#rTotal2').textContent  = fmtMoney(total);
    $('#rAnticipo').textContent= fmtMoney(anticipo);
    $('#rSaldo').textContent   = fmtMoney(saldo);

    state.totales.anticipo = anticipo;
    saveLocal();
  }

  async function openLienzoForItem(index) {
    const pedidoId = await guardarEnDB();
    currentPedidoId = Number(pedidoId) || 0;

    let partidaId = state.items[index]?.dbId ? String(state.items[index].dbId) : null;
    try {
      if (!partidaId) {
        const data = await window.api.orders.get(pedidoId);
        const part = data?.partidas?.[index];
        if (part) partidaId = String(part.id);
      }
    } catch {}

    await window.api.ui.setContext({ pedidoId: String(pedidoId), partidaId, partidaIndex: index });
    await window.api.navigate('lienzo.html');
  }

  async function showPreviewForItem(index, card) {
    const rawPrev = localStorage.getItem('rp:preview');
    const currentId = Number(currentPedidoId || 0);
    if (rawPrev) {
      try {
        const prev = JSON.parse(rawPrev);
        if (prev && Number(prev.pedidoId) === currentId && Number(prev.partidaIndex) === index) {
          injectPreview(card, prev.dataUrl);
          return;
        }
      } catch {}
    }

    const maybePartId = state.items[index]?.dbId ? Number(state.items[index].dbId) : null;
    const pid = Number(currentPedidoId || 0);
    if (!pid) { alert('Primero guarda el pedido.'); return; }

    let partId = maybePartId;
    if (!partId) {
      const data = await window.api.orders.get(pid);
      partId = data?.partidas?.[index]?.id;
    }
    if (!partId) { alert('No se encontró la partida.'); return; }

    const list = await window.api.design.listByPedido(pid);
    const hit = (list || []).find(x => Number(x.partida_id) === Number(partId));
    if (hit) injectPreview(card, hit.dataUrl);
    else alert('Aún no hay preview para este ítem. Abre el lienzo, guarda y vuelve a intentar.');
  }

  function wireEvents() {
    $('#btnAddItem').addEventListener('click', () => { state.items.push(newItem()); renderItems(); recalc(); });
    $('#btnDupItem').addEventListener('click', () => {
      const idx = state.items.findIndex(x => x.selected);
      if (idx < 0) { alert('Selecciona un ítem a duplicar.'); return; }
      const base = state.items[idx];
      const copy = newItem({ ...base, id: crypto.randomUUID(), dbId: null, selected: false });
      state.items.splice(idx + 1, 0, copy);
      renderItems(); recalc();
    });
    $('#btnDelItem').addEventListener('click', () => {
      const any = state.items.some(x => x.selected);
      if (!any) { alert('Selecciona al menos un ítem (switch "Sel").'); return; }
      state.items = state.items.filter(x => !x.selected);
      if (state.items.length === 0) state.items.push(newItem());
      renderItems(); recalc();
    });

    $('#anticipo').addEventListener('input', recalc);
    $('#metodo').addEventListener('change', e => { state.totales.metodo = e.target.value; saveLocal(); });
    $('#estado').addEventListener('change', e => { state.estado = e.target.value; saveLocal(); });

    $('#cliNombre').addEventListener('input', e => { state.cliente.nombre = e.target.value; saveLocal(); });
    $('#cliTel').addEventListener('input',    e => { state.cliente.tel    = e.target.value; saveLocal(); });
    $('#cliEmail').addEventListener('input',  e => { state.cliente.email  = e.target.value; saveLocal(); });
    $('#cliRFC').addEventListener('input',    e => { state.cliente.rfc    = e.target.value; saveLocal(); });
    $('#factura').addEventListener('change',  e => { state.cliente.factura = e.target.value; saveLocal(); });
    $('#canal').addEventListener('change',    e => { state.cliente.canal   = e.target.value; saveLocal(); });

    $('#entregaFecha').addEventListener('change', e => { state.pedido.entregaFecha = e.target.value; saveLocal(); });
    $('#entregaHora').addEventListener('change',  e => { state.pedido.entregaHora  = e.target.value; saveLocal(); });
    $('#prioridad').addEventListener('change',    e => { state.pedido.prioridad    = e.target.value; saveLocal(); });
    $('#sucursal').addEventListener('input',      e => { state.pedido.sucursal     = e.target.value; saveLocal(); });

    $$('.chip.quick').forEach(ch => {
      ch.addEventListener('click', () => {
        const kind = ch.dataset.tpl;
        const presets = {
          'Tarjetas':    { producto: 'Tarjetas de presentación', desc: 'Couché 300g, 9x5 cm', cant: 100, pu: 350 },
          'Lona':        { producto: 'Lona publicitaria', desc: 'Gran formato', ancho: 300, alto: 200, cant: 1, pu: 250 },
          'Playera':     { producto: 'Playera personalizada', desc: 'Serigrafía 1 tinta', cant: 1, pu: 120 },
          'Vinil':       { producto: 'Vinil recorte', desc: 'Rotulación', cant: 1, pu: 180 },
          'Sublimación': { producto: 'Taza sublimada', desc: 'Full color', cant: 1, pu: 90 },
        };
        state.items.push(newItem(presets[kind] || {}));
        renderItems(); recalc();
      });
    });

    $('#btnGuardar').addEventListener('click', guardarYToast);
    $('#btnImprimir').addEventListener('click', printOrder);
    $('#btnNuevo').addEventListener('click', resetForm);

    const fin = $('#btnFinalizar');
    if (fin) {
      fin.addEventListener('click', async () => {
        try {
          state.estado = 'Finalizado';
          $('#estado').value = 'Finalizado';
          const pid = await guardarEnDB();
          currentPedidoId = Number(pid) || 0;
          toast('Finalizado', 'Pedido guardado y formulario reiniciado.');
          resetForm();
          try { await window.api.ui.clearContext(); } catch {}
        } catch (err) {
          alert(err?.message || 'No se pudo finalizar el pedido.');
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); guardarYToast(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printOrder(); }
      if (e.key === 'Insert')  { e.preventDefault(); $('#btnAddItem').click(); }
      if (e.key === 'Delete')  { e.preventDefault(); $('#btnDelItem').click(); }
      if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); resetForm(); }
    });
  }

  function resetForm() {
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
    currentPedidoId = 0;
    renderItems(); recalc();
    $('#folio').value = state.folio; $('#fechaHora').value = state.fechaHora; $('#estado').value = state.estado;
    $('#cliNombre').value = ''; $('#cliTel').value = ''; $('#cliEmail').value = ''; $('#cliRFC').value = '';
    $('#factura').value = 'no'; $('#canal').value = 'Mostrador'; $('#entregaFecha').value = ''; $('#entregaHora').value = '';
    $('#prioridad').value = 'Normal'; $('#sucursal').value = ''; $('#anticipo').value = 0; $('#metodo').value = 'Efectivo';

    // Re-carga último cliente si existe
    try {
      const lastId = Number(localStorage.getItem('rp:lastClientId') || 0);
      if (lastId) window.api.clientes.get(lastId).then(cli => { if (cli) fillFromCliente(cli); });
    } catch {}

    toast('Nuevo', 'Pedido reiniciado.');
    saveLocal();
    history.replaceState(null, '', location.pathname); // quita ?pedidoId
    try { localStorage.removeItem('rp:preview'); } catch {}
  }

  function saveLocal() { try { localStorage.setItem('rockyprint:caja:last', JSON.stringify(state)); } catch {} }
  function guardarYToast() {
    guardarEnDB().then(() => toast('Guardado', 'Pedido guardado en base de datos.'))
                 .catch(err => alert(err?.message || 'Error al guardar.'));
  }

  // create o update según exista currentPedidoId
  async function guardarEnDB() {
    const ensureFolio = () => { let f = ($('#folio').value || state.folio || '').trim(); if (!f) f = genFolio(); return f; };

    const buildPayload = () => ({
      id: currentPedidoId || null,
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
        correo: toNull($('#cliEmail').value),
        rfc: toNull($('#cliRFC').value),
        factura: ($('#factura').value === 'si'),
        canal: toNull($('#canal').value)
      },
      items: state.items.map(it => ({
        id:  (it.dbId ?? null),
        cid: it.id,
        producto: toNull(it.producto),
        desc: toNull(it.desc),
        ancho: Number(it.ancho || 0),
        alto:  Number(it.alto  || 0),
        cant:  Number(it.cant  || 1),
        color: toNull(it.color),
        acabados: toNull(it.acabados),
        pu: Number(it.pu || 0)
      }))
    });

    let payload = buildPayload();
    state.folio = payload.folio;

    if (!currentPedidoId) {
      let resp = await window.api.orders.create(payload);
      if (resp?.ok && resp?.id) {
        const pedidoId1 = Number(resp.id);
        currentPedidoId = pedidoId1;
        history.replaceState(null, '', location.pathname + '?pedidoId=' + pedidoId1);
        return pedidoId1;
      }
      if (resp && resp.ok === false && (resp.code === '23505' || /folio/i.test(resp.error || ''))) {
        const newFolio = genFolio(); state.folio = newFolio; $('#folio').value = newFolio;
        payload = buildPayload(); resp = await window.api.orders.create(payload);
        if (resp?.ok && resp?.id) {
          const pedidoId2 = Number(resp.id);
          currentPedidoId = pedidoId2;
          history.replaceState(null, '', location.pathname + '?pedidoId=' + pedidoId2);
          return pedidoId2;
        }
      }
      throw new Error(resp?.error || 'No se pudo guardar');
    }

    const resp2 = await window.api.orders.save(payload);
    if (resp2?.ok && resp2?.id) {
      currentPedidoId = Number(resp2.id);
      if (Array.isArray(resp2.partMap)) {
        for (const m of resp2.partMap) {
          const item = state.items.find(x => x.id === m.cid);
          if (item) item.dbId = Number(m.id);
        }
      }
      history.replaceState(null, '', location.pathname + '?pedidoId=' + currentPedidoId);
      return currentPedidoId;
    }
    throw new Error(resp2?.error || 'No se pudo guardar');
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
        <td style="text-align:right">${fmtMoney((it.pu || 0) * (it.cant || 0))}</td>
      </tr>`).join('');

    const total = state.items.reduce((s, it) => s + (it.pu || 0) * (it.cant || 0), 0);
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
          <tr><th>#</th><th>Producto</th><th>Descripción</th><th>Ancho</th><th>Alto</th><th>Cant</th><th>Tintas/Color</th><th>Acabados</th><th>PU</th><th>Subtotal</th></tr>
        </thead><tbody>${rows}</tbody>
      </table>
      <table style="margin-top:8px">
        <tr><td><b>Total</b></td><td style="text-align:right">${fmtMoney(total)}</td></tr>
        <tr><td><b>Anticipo</b></td><td style="text-align:right">${fmtMoney(state.totales.anticipo || 0)}</td></tr>
        <tr><td><b>Saldo</b></td><td style="text-align:right">${fmtMoney(saldo)}</td></tr>
        <tr><td><b>Método de pago</b></td><td style="text-align:right">${esc(state.totales.metodo || '-')}</td></tr>
      </table>`;
    window.print();
  }

  function toast(title, text) {
    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed; right: 16px; top: 16px; z-index: 9999;
      background: #0f172a; border:1px solid #1f2a44; color:#dbeafe;
      padding:10px 12px; border-radius:10px; box-shadow: 0 8px 20px rgba(0,0,0,.25);
      font: 13px/1.3 system-ui, Segoe UI, Roboto;`;
    box.innerHTML = `<strong style="display:block;margin-bottom:4px">${title}</strong><span>${text}</span>`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1600);
  }

  // Navegar a Pedidos
  const btnPedidos = document.getElementById('btnPedidos');
  if (btnPedidos) {
    btnPedidos.addEventListener('click', async () => {
      await window.api.navigate('pedidos.html');
    });
  }

  // Logout
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try { await window.api.auth.logout(); } catch {}
      try { await window.api.ui.clearContext(); } catch {}
      try { localStorage.removeItem('rockyprint:caja:last'); } catch {}
      try { localStorage.removeItem('rp:preview'); } catch {}
      await window.api.navigate('login.html');
    });
  }

  init();
})();
