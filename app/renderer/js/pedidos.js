(async () => {
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  // === Auth & permisos mínimos ===
  try {
    const me = await window.api.auth.get();
    if (!me) { await window.api.navigate('login.html'); return; }

    const rol = String(me.rol || '').trim().toLowerCase();
    const allowed = new Set(['produccion', 'caja', 'admin']);
    if (!allowed.has(rol)) {
      alert(`No tienes acceso a pedidos. Tu rol: ${rol}.`);
      await window.api.navigate('login.html');
      return;
    }

    window.__canEditCaja = (rol === 'caja' || rol === 'admin');
    window.__canDelete = ['caja', 'admin', 'produccion'].includes(rol);
  } catch {
    await window.api.navigate('login.html');
    return;
  }

  // === Filtros UI
  const qEl = $('#q');
  const estEl = $('#estado');
  const desdeEl = $('#desde');
  const hastaEl = $('#hasta');

  // === KPIs
  const kTotal = $('#kpiTotal');
  const kProg  = $('#kpiProg');
  const kLate  = $('#kpiLate');
  const kDone30= $('#kpiDone30');

  // === Modal detalle
  const modal = $('#orderModal');
  const mClose = $('#mClose');
  const mBody = $('#mBody');
  const mFolio = $('#mFolio');

  // === Lightbox
  const lb = {
    root: document.getElementById('previewLightbox'),
    img: document.getElementById('lbImg'),
    close: document.getElementById('lbClose'),
    openLienzo: document.getElementById('lbOpenLienzo'),
    backdrop: document.querySelector('#previewLightbox .lb-backdrop')
  };
  let lbCtx = null;

  function openLightbox(ctx) {
    lbCtx = ctx;
    lb.img.src = ctx.src || '';
    lb.root.classList.remove('hidden');
    lb.root.setAttribute('aria-hidden', 'false');
  }
  function closeLightbox() {
    lb.root.classList.add('hidden');
    lb.root.setAttribute('aria-hidden', 'true');
    lb.img.src = '';
    lbCtx = null;
  }
  lb.close?.addEventListener('click', closeLightbox);
  lb.backdrop?.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lb.root.classList.contains('hidden')) closeLightbox();
  });
  lb.openLienzo?.addEventListener('click', async () => {
    if (!lbCtx) return;
    await window.api.navigate('lienzo.html', {
      pedidoId: String(lbCtx.pedidoId || ''),
      partidaId: String(lbCtx.partidaId || ''),
      partidaIndex: Number(lbCtx.partidaIndex || 0),
      fullscreen: true
    });
    closeLightbox();
  });

  // === Estado
  let pedidos = [];

  // === Helpers
  const isPinned = (p) => p?.pinned === true;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-MX') : '-';
  const fmtDT   = (d) => d ? new Date(d).toLocaleString('es-MX') : '-';
  const fmtMoney= (v) => (new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })).format(+v || 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const isLate = (d, estado) => {
    if (!d) return false;
    const T = new Date(); T.setHours(0, 0, 0, 0);
    const D = new Date(d); D.setHours(0, 0, 0, 0);
    const closed = new Set(['Listo', 'Entregado', 'Cancelado']);
    return D < T && !closed.has(String(estado || ''));
  };

  // === Cargar lista
  async function loadData() {
    const filters = {
      q: qEl.value.trim() || null,
      estado: estEl.value || null,
      desde: desdeEl.value || null,
      hasta: hastaEl.value || null
    };
    try { pedidos = await window.api.orders.list(filters); } catch { pedidos = []; }
    render();
  }

  function renderKPIs() {
    const total = pedidos.length;
    const prog = pedidos.filter(x => ['En progreso', 'En producción'].includes(String(x.estado))).length;
    const late = pedidos.filter(x => isLate(x.fecha_entrega, x.estado)).length;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const done30 = pedidos.filter(x => String(x.estado) === 'Listo' && x.actualizado_en && new Date(x.actualizado_en) >= cutoff).length;

    kTotal.textContent = total;
    kProg.textContent = prog;
    kLate.textContent = late;
    kDone30.textContent = done30;
  }

  // ====== Drag & Drop (reordenar por grupo) ======
  let dragId = null;

  function attachCardDnD(card) {
    const handle = card.querySelector('.handle');
    if (!handle) return;

    handle.setAttribute('draggable', 'true');
    handle.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    handle.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      dragId = null;
    });

    card.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!dragId || card.dataset.id === dragId) return;
      const dragging = pedidos.find(x => String(x.id) === String(dragId));
      const target   = pedidos.find(x => String(x.id) === String(card.dataset.id));
      if (!dragging || !target) return;
      if (isPinned(dragging) !== isPinned(target)) return; // no permitir mezclar grupos
      card.classList.add('drag-over');
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', () => {
      card.classList.remove('drag-over');
      if (!dragId || card.dataset.id === dragId) return;

      const dragging = pedidos.find(x => String(x.id) === String(dragId));
      const target   = pedidos.find(x => String(x.id) === String(card.dataset.id));
      if (!dragging || !target) return;
      if (isPinned(dragging) !== isPinned(target)) return; // no mezclar

      moveBefore(dragId, card.dataset.id);
      render();             // repinta con nuevo orden
      persistOrderDebounced(); // guarda en DB
    });
  }

  function moveBefore(sourceId, targetId) {
    const from = pedidos.findIndex(x => String(x.id) === String(sourceId));
    const to   = pedidos.findIndex(x => String(x.id) === String(targetId));
    if (from === -1 || to === -1 || from === to) return;
    const [item] = pedidos.splice(from, 1);
    pedidos.splice(to, 0, item);
  }

  // Persistencia del orden por grupo (debounce)
  let persistT = null;
  function persistOrderDebounced() {
    clearTimeout(persistT);
    persistT = setTimeout(persistOrder, 400);
  }

  async function persistOrder() {
    try {
      const pinnedIds = pedidos.filter(isPinned).map(p => Number(p.id));
      const normalIds = pedidos.filter(p => !isPinned(p)).map(p => Number(p.id));

      if (pinnedIds.length) await window.api.orders.setPinnedOrder(pinnedIds);
      if (normalIds.length) await window.api.orders.setOrder(normalIds);
    } catch (e) {
      console.error('No se pudo guardar el orden:', e);
    }
  }

  // ====== Render tarjetas ======
  function render() {
    const grid = $('#grid');
    grid.innerHTML = '';

    pedidos.forEach(p => {
      const card = document.createElement('article');
      card.className = 'card' + (isPinned(p) ? ' pinned' : '');
      card.dataset.id = p.id;

      const entrega = fmtDate(p.fecha_entrega);
      const actualizado = fmtDT(p.actualizado_en);
      const totalFmt = fmtMoney(p.total);

      const pinBtn   = isPinned(p) ? '📌' : '📍';
      const pinTitle = isPinned(p) ? 'Quitar fijado' : 'Fijar arriba';
      const pinPill  = isPinned(p) ? `<span class="pill s-pin">📌 Fijado</span>` : '';

      card.innerHTML = `
        <div class="card-head">
          <div class="handle" title="Mover">⋮⋮</div>
          <div class="pills">
            <span class="pill"># ${p.folio}</span>
            <span class="pill">${p.estado}</span>
            <span class="pill">Cliente: <b>${esc(p.cliente || '-')}</b></span>
            ${pinPill}
          </div>
        </div>

        <div>
          <div class="meta">
            Entrega: <b${isLate(p.fecha_entrega, p.estado) ? ' class="late"' : ''}>${entrega}</b> ·
            Actualizado: <b>${actualizado}</b> ·
            Total: <b>${totalFmt}</b>
          </div>
        </div>

        <div class="tools">
          <button class="iconbtn" data-pin title="${pinTitle}">${pinBtn}</button>
          <button class="iconbtn" data-ver title="Ver / abrir">👁️</button>
          ${window.__canEditCaja ? '<button class="iconbtn" data-editar title="Editar en Caja">✏️</button>' : ''}
          ${window.__canDelete ? '<button class="iconbtn danger" data-borrar title="Eliminar pedido">🗑️</button>' : ''}
        </div>
      `;

      // Pin / Unpin
      card.querySelector('[data-pin]')?.addEventListener('click', async () => {
        const pin = !isPinned(p);
        const res = await window.api.orders.togglePin({ id: p.id, pin }).catch(() => ({ ok: false }));
        if (!res?.ok) { alert(res?.error || 'No se pudo cambiar el pin'); return; }
        await loadData();
      });

      // Ver / Editar / Borrar
      card.querySelector('[data-ver]')?.addEventListener('click', async () => openOrderModal(p.id));
      card.querySelector('[data-editar]')?.addEventListener('click', async () => {
        await window.api.navigate({ html: 'caja.html', ctx: { pedidoId: String(p.id) } });
      });
      card.querySelector('[data-borrar]')?.addEventListener('click', async () => {
        await deleteOrderWithPassword(p.id, p.folio);
      });

      attachCardDnD(card);
      grid.appendChild(card);
    });

    renderKPIs();
  }

  // ========== MODAL DETALLE ==========
  async function openOrderModal(pedidoId) {
    try {
      const data = await window.api.orders.get(pedidoId);
      if (!data) { alert('No se pudo cargar el pedido.'); return; }

      const previews = await window.api.design.listByPedido(pedidoId).catch(() => []);
      const mapPrev = new Map(previews.map(p => [Number(p.partida_id), p]));

      mFolio.textContent = `#${data.pedido.folio}`;
      const headerHtml = `
        <div class="m-grid">
          <div class="m-card">
            <h4>Pedido</h4>
            <div class="m-row"><span>Estado</span><b>${esc(data.pedido.estado)}</b></div>
            <div class="m-row"><span>Entrega</span><b>${esc(data.pedido.fecha_entrega || '-')} ${esc(data.pedido.hora_entrega || '')}</b></div>
            <div class="m-row"><span>Prioridad</span><b>${esc(data.pedido.prioridad || 'Normal')}</b></div>
            <div class="m-row"><span>Última actualización</span><b>${fmtDT(data.pedido.actualizado_en)}</b></div>
            <div class="m-row"><span>Fijado</span><b>${data.pedido.pinned ? 'Sí' : 'No'}</b></div>
          </div>
          <div class="m-card">
            <h4>Cliente</h4>
            <div class="m-row"><span>Nombre</span><b>${esc(data.cliente?.nombre || '-')}</b></div>
            <div class="m-row"><span>Teléfono</span><b>${esc(data.cliente?.telefono || '-')}</b></div>
            <div class="m-row"><span>Email</span><b>${esc(data.cliente?.correo || '-')}</b></div>
            <div class="m-row"><span>Factura</span><b>${data.cliente?.facturar ? 'Sí' : 'No'}</b></div>
            <div class="m-row"><span>Canal</span><b>${esc(data.cliente?.canal || '-')}</b></div>
          </div>
        </div>
      `;

      const itemsRows = (data.partidas || []).map((it, idx) => {
        const prev = mapPrev.get(Number(it.id));
        const prevImg = prev ? `<img class="preview-thumb" src="${prev.dataUrl}" alt="Preview ${idx + 1}">` : '<span class="pill">Sin preview</span>';

        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${esc(it.producto || '')}</td>
            <td>${esc(it.descripcion || '')}</td>
            <td style="text-align:right">${Number(it.ancho_cm || 0)}</td>
            <td style="text-align:right">${Number(it.alto_cm || 0)}</td>
            <td style="text-align:right">${Number(it.cantidad || 0)}</td>
            <td>${esc(it.info_color || '')}</td>
            <td>${esc(it.acabados || '')}</td>
            <td style="text-align:right">${fmtMoney(it.precio_unitario || 0)}</td>
            <td style="text-align:right">${fmtMoney(it.subtotal || 0)}</td>
            <td>
              ${prevImg}
              <div class="row-actions">
                <button class="btn" data-open-lienzo data-index="${idx}" data-partida="${it.id}">Ver tamaño completo</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      const total = (data.partidas || []).reduce((s, it) => s + Number(it.subtotal || 0), 0);

      const tableHtml = `
        <div class="m-card" style="margin-top:10px">
          <h4>Ítems</h4>
          <table class="m-table">
            <thead>
              <tr>
                <th>#</th><th>Producto</th><th>Descripción</th>
                <th>Ancho</th><th>Alto</th><th>Cant</th>
                <th>Tintas/Color</th><th>Acabados</th><th>PU</th><th>Subtotal</th><th>Preview</th>
              </tr>
            </thead>
            <tbody>${itemsRows || '<tr><td colspan="11">Sin partidas.</td></tr>'}</tbody>
          </table>
          <div class="m-row" style="margin-top:8px">
            <span><b>Total</b></span><b>${fmtMoney(total)}</b>
          </div>
        </div>
      `;

      mBody.innerHTML = headerHtml + tableHtml;

      // Miniatura → lightbox
      $$('#mBody img.preview-thumb').forEach(img => {
        const tr = img.closest('tr');
        const btn = tr?.querySelector('[data-open-lienzo]');
        const idx = Number(btn?.dataset.index || 0);
        const partId = Number(btn?.dataset.partida || 0);
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => {
          openLightbox({ src: img.src, pedidoId: data.pedido.id, partidaId: partId, partidaIndex: idx });
        });
      });

      // Botón “Ver tamaño completo” → lightbox
      $$('#mBody [data-open-lienzo]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.index || 0);
          const partId = Number(btn.dataset.partida || 0);
          const img = btn.closest('tr')?.querySelector('img.preview-thumb');
          const src = img?.src || '';
          if (!src) { alert('No hay preview generado para este ítem.'); return; }
          openLightbox({ src, pedidoId: data.pedido.id, partidaId: partId, partidaIndex: idx });
        });
      });

      openModal();
    } catch (e) {
      console.error(e);
      alert('No se pudo abrir el detalle.');
    }
  }

  function openModal() {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    mBody.innerHTML = '';
  }
  mClose.addEventListener('click', closeModal);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lbCtx) closeModal(); });

  // === Eventos filtros
  $('#filtrarBtn').addEventListener('click', loadData);
  [qEl, estEl, desdeEl, hastaEl].forEach(el => {
    el.addEventListener(el === qEl ? 'input' : 'change', () => {
      clearTimeout(el._t); el._t = setTimeout(loadData, 200);
    });
  });

  // === Export CSV
  $('#exportCsvBtn')?.addEventListener('click', () => exportCSV(pedidos));
  function exportCSV(data) {
    if (!data.length) { alert('No hay datos para exportar.'); return; }
    const headers = ['id', 'folio', 'cliente', 'estado', 'fecha_entrega', 'actualizado_en', 'total', 'pinned'];
    const rows = data.map(p => ([
      p.id,
      safe(p.folio),
      safe(p.cliente),
      safe(p.estado),
      p.fecha_entrega ? new Date(p.fecha_entrega).toISOString().split('T')[0] : '',
      p.actualizado_en ? new Date(p.actualizado_en).toISOString() : '',
      Number(p.total || 0),
      p.pinned === true ? 1 : 0
    ]));
    const csv = [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pedidos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  const safe = v => (v == null ? '' : String(v));
  const csvEscape = v => {
    const s = String(v ?? '');
    return (/[,\"\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // ===== Confirmación por contraseña (borrado)
  function askPassword(message = 'Escribe tu contraseña para continuar') {
    const root = document.getElementById('pwdModal');
    const msgEl = document.getElementById('pwdMsg');
    const inEl = document.getElementById('pwdInput');
    const okBtn = document.getElementById('pwdOk');
    const cancel = document.getElementById('pwdCancel');
    const closeX = document.getElementById('pwdClose');
    const errEl = document.getElementById('pwdError');

    return new Promise(resolve => {
      const cleanup = (val = null) => {
        root.classList.add('hidden');
        root.setAttribute('aria-hidden', 'true');
        okBtn.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        closeX.removeEventListener('click', onCancel);
        root.querySelector('.modal-backdrop')?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        errEl.textContent = '';
        inEl.value = '';
        resolve(val);
      };
      const onOk = () => {
        const v = inEl.value.trim();
        if (!v) { errEl.textContent = 'La contraseña no puede ir vacía.'; inEl.focus(); return; }
        cleanup(v);
      };
      const onCancel = () => cleanup(null);
      const onKey = (e) => { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); };

      msgEl.textContent = message;
      root.classList.remove('hidden');
      root.setAttribute('aria-hidden', 'false');

      okBtn.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      closeX.addEventListener('click', onCancel);
      root.querySelector('.modal-backdrop')?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);

      const focusInput = () => { inEl.focus({ preventScroll: true }); inEl.select(); };
      requestAnimationFrame(() => requestAnimationFrame(focusInput));
    });
  }

  async function deleteOrderWithPassword(pedidoId, folio) {
    if (window.__canDelete !== true) {
      alert('No tienes permisos para borrar.');
      return;
    }

    const pwd = await askPassword(`Para eliminar el pedido #${folio}, escribe tu contraseña.`);
    if (pwd == null) return;

    const check = await window.api.auth.confirmPassword(pwd).catch(() => ({ ok: false }));
    if (!check?.ok) { alert(check?.error || 'Contraseña incorrecta.'); return; }

    const res = await window.api.orders.delete(pedidoId).catch(() => ({ ok: false }));
    if (res?.ok) {
      alert('Pedido eliminado.');
      try { closeLightbox(); } catch {}
      try { closeModal(); } catch {}
      await loadData();
    } else {
      alert(res?.error || 'No se pudo eliminar el pedido.');
    }
  }

  // === Logout
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    try {
      await window.api.auth.logout();
      localStorage.removeItem('rockyprint:caja:last');
      await window.api.navigate('login.html');
    } catch {
      alert('No se pudo cerrar sesión.');
    }
  });

  // Inicial
  await loadData();
})();
