// app/renderer/js/pedidos.js
(async () => {
  const $  = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  // === Auth & permisos mínimos ===
  try {
    const me = await window.api.auth.get();
    if (!me) { await window.api.navigate('login.html'); return; }
    const rol = (me.rol || '').toLowerCase();
    const allowed = new Set(['produccion', 'caja', 'admin']);
    if (!allowed.has(rol)) {
      alert(`No tienes acceso a pedidos. Tu rol: ${rol}.`);
      await window.api.navigate('login.html');
      return;
    }
    window.__canEdit = (rol === 'caja' || rol === 'admin');
  } catch {
    await window.api.navigate('login.html');
    return;
  }

  // Filtros UI
  const qEl     = $('#q');
  const estEl   = $('#estado');
  const desdeEl = $('#desde');
  const hastaEl = $('#hasta');

  // KPIs
  const kTotal  = $('#kpiTotal');
  const kProg   = $('#kpiProg');
  const kLate   = $('#kpiLate');
  const kDone30 = $('#kpiDone30');

  // Modal refs
  const modal   = $('#orderModal');
  const mClose  = $('#mClose');
  const mBody   = $('#mBody');
  const mFolio  = $('#mFolio');

  // Lightbox refs + estado
  const lb = {
    root: document.getElementById('previewLightbox'),
    img: document.getElementById('lbImg'),
    close: document.getElementById('lbClose'),
    openLienzo: document.getElementById('lbOpenLienzo'),
    backdrop: document.querySelector('#previewLightbox .lb-backdrop')
  };
  let lbCtx = null;

  function openLightbox(ctx){
    lbCtx = ctx;                    // { src, pedidoId, partidaId, partidaIndex }
    lb.img.src = ctx.src || '';
    lb.root.classList.remove('hidden');
    lb.root.setAttribute('aria-hidden','false');
  }
  function closeLightbox(){
    lb.root.classList.add('hidden');
    lb.root.setAttribute('aria-hidden','true');
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
      pedidoId:     String(lbCtx.pedidoId || ''),
      partidaId:    String(lbCtx.partidaId || ''),
      partidaIndex: Number(lbCtx.partidaIndex || 0),
      fullscreen:   true
    });
    closeLightbox();
  });

  // Estado en memoria
  let pedidos = [];

  // Utils
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-MX') : '-';
  const fmtDT   = (d) => d ? new Date(d).toLocaleString('es-MX') : '-';
  const isLate  = (d) => {
    if (!d) return false;
    const T=new Date(); T.setHours(0,0,0,0);
    const D=new Date(d); D.setHours(0,0,0,0);
    return D < T;
  };
  const fmtMoney = (v) => (new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'})).format(+v || 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // Cargar lista
  async function loadData(){
    const filters = {
      q: qEl.value.trim() || null,
      estado: estEl.value || null,
      desde: desdeEl.value || null,
      hasta: hastaEl.value || null
    };
    try { pedidos = await window.api.orders.list(filters); } catch { pedidos = []; }
    render();
  }

  function renderKPIs(){
    const total = pedidos.length;
    const prog  = pedidos.filter(x => x.estado === "En progreso").length;
    const late  = pedidos.filter(x => isLate(x.fecha_entrega) && x.estado !== "Listo").length;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const done30 = pedidos.filter(x => x.estado === "Listo" && x.actualizado_en && new Date(x.actualizado_en) >= cutoff).length;

    kTotal.textContent  = total;
    kProg.textContent   = prog;
    kLate.textContent   = late;
    kDone30.textContent = done30;
  }

  function render(){
    const grid = $('#grid');
    grid.innerHTML = '';
    pedidos.forEach(p => {
      const card = document.createElement('article');
      card.className='card';
      card.dataset.id = p.id;

      const entrega = fmtDate(p.fecha_entrega);
      const actualizado = fmtDT(p.actualizado_en);
      const totalFmt = fmtMoney(p.total);

      card.innerHTML = `
        <div class="card-head">
          <div class="handle" title="Mover">⋮⋮</div>
          <div class="pills">
            <span class="pill"># ${p.folio}</span>
            <span class="pill">${p.estado}</span>
            <span class="pill">Cliente: <b>${esc(p.cliente || '-')}</b></span>
          </div>
        </div>

        <div>
          <div class="meta">
            Entrega: <b${isLate(p.fecha_entrega)?' class="late"':''}>${entrega}</b> ·
            Actualizado: <b>${actualizado}</b> ·
            Total: <b>${totalFmt}</b>
          </div>
        </div>

        <div class="tools">
          <button class="iconbtn" data-ver title="Ver / abrir">👁️</button>
          ${window.__canEdit ? '<button class="iconbtn" data-editar title="Editar en Caja">✏️</button>' : ''}
        </div>
      `;

      // 👁️ → abre modal de detalle
      card.querySelector('[data-ver]')?.addEventListener('click', async () => openOrderModal(p.id));
      // ✏️ → ir a Caja
      card.querySelector('[data-editar]')?.addEventListener('click', async () => {
        await window.api.navigate({ html: 'caja.html', ctx: { pedidoId: String(p.id) } });
      });

      grid.appendChild(card);
    });
    renderKPIs();
  }

  // ========== MODAL ==========
  async function openOrderModal(pedidoId){
    try {
      const data = await window.api.orders.get(pedidoId);
      if (!data) { alert('No se pudo cargar el pedido.'); return; }

      const previews = await window.api.design.listByPedido(pedidoId).catch(()=>[]);
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
        const prevImg = prev ? `<img class="preview-thumb" src="${prev.dataUrl}" alt="Preview ${idx+1}">` : '<span class="pill">Sin preview</span>';

        return `
          <tr>
            <td>${idx+1}</td>
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

      // Click miniatura → lightbox
      $$('#mBody img.preview-thumb').forEach(img => {
        const tr = img.closest('tr');
        const btn = tr?.querySelector('[data-open-lienzo]');
        const idx = Number(btn?.dataset.index || 0);
        const partId = Number(btn?.dataset.partida || 0);

        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => {
          openLightbox({
            src: img.src,
            pedidoId: data.pedido.id,
            partidaId: partId,
            partidaIndex: idx
          });
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
          openLightbox({
            src,
            pedidoId: data.pedido.id,
            partidaId: partId,
            partidaIndex: idx
          });
        });
      });

      openModal();
    } catch (e) {
      console.error(e);
      alert('No se pudo abrir el detalle.');
    }
  }

  function openModal(){
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
  }
  function closeModal(){
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    mBody.innerHTML = '';
  }
  mClose.addEventListener('click', closeModal);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lbCtx) closeModal(); });

  // Eventos filtros
  $('#filtrarBtn').addEventListener('click', loadData);
  [qEl, estEl, desdeEl, hastaEl].forEach(el => {
    el.addEventListener(el === qEl ? 'input' : 'change', () => {
      clearTimeout(el._t); el._t = setTimeout(loadData, 200);
    });
  });

  // Export CSV
  $('#exportCsvBtn')?.addEventListener('click', () => exportCSV(pedidos));

  function exportCSV(data) {
    if (!data.length) { alert('No hay datos para exportar.'); return; }
    const headers = ['id','folio','cliente','estado','fecha_entrega','actualizado_en','total'];
    const rows = data.map(p => ([
      p.id,
      safe(p.folio),
      safe(p.cliente),
      safe(p.estado),
      p.fecha_entrega ? new Date(p.fecha_entrega).toISOString().split('T')[0] : '',
      p.actualizado_en ? new Date(p.actualizado_en).toISOString() : '',
      Number(p.total || 0)
    ]));
    const csv = [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`pedidos_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  const safe = v => (v==null?'':String(v));
  const csvEscape = v => {
    const s = String(v ?? '');
    return (/[,\"\n]/.test(s)) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  // Logout
document.getElementById('btnLogout')?.addEventListener('click', async () => {
  try {
    await window.api.auth.logout();               // limpia sesión y ui:ctx en main
    localStorage.removeItem('rockyprint:caja:last');
    await window.api.navigate('login.html');      // vuelve al login
  } catch (e) {
    alert('No se pudo cerrar sesión.');
  }
});


  // Inicial
  await loadData();
})();
