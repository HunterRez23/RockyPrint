// app/renderer/js/lienzo.js
(() => {
  const $ = (q, c = document) => c.querySelector(q);
  const $$ = (q, c = document) => Array.from(c.querySelectorAll(q));

  const state = {
    pedidoId: null,
    partidaId: null,
    partidaIndex: 0,
    escalaPxPorCm: 37.7952755906,
    zoom: 1,
    themeWhite: JSON.parse(localStorage.getItem('rp:lienzo:white') || 'false'),
    templateUrl: null,                 // ← NUEVO
    templateNatural: { w: 0, h: 0 },   // ← NUEVO
  };

  // refs
  const artboard = $('#artboard');
  const tplName = $('#tplName');
  const widthInput = $('#widthInput');
  const heightInput = $('#heightInput');
  const bleedSel = $('#bleedSelect');
  const colorMode = $('#colorMode');
  const templateVisual = $('#templateVisual');

  const cmToPx = (cm) => Math.max(1, Math.round(cm * state.escalaPxPorCm));
  const pxToCm = (px) => +(px / state.escalaPxPorCm).toFixed(2);

  function setArtboardSize(pxW, pxH) {
    artboard.style.width = `${pxW}px`;
    artboard.style.height = `${pxH}px`;
    $('#frameLabel').textContent = `Área de impresión — ${tplName.value || 'Plantilla'}`;
  }

  function assetUrl(rel) {
    try { return new URL(rel, window.location.href).toString(); }
    catch { return rel; }
  }

  function setTemplateVisual(name) {
    const map = {
      'Camiseta': 'camiseta.svg',
      'Sudadera': 'sudadera.svg',
      'Tarjeta': 'tarjeta.svg',
      'Lona': 'lona.svg',
      'Taza': 'taza.svg',
      'Gorro': 'gorra.svg',
    };
    const file = map[name] || 'tarjeta.svg';
    const url = assetUrl('assets/' + file);

    templateVisual.style.backgroundImage = `url('${url}')`;
    templateVisual.style.backgroundSize = 'contain';
    templateVisual.style.backgroundRepeat = 'no-repeat';
    templateVisual.style.backgroundPosition = 'center';
    templateVisual.classList.add('is-active');

    // Guardamos para que composePreviewCanvas lo use
    state.templateUrl = url;
    preloadTemplateImage(url);
  }

  function preloadTemplateImage(url) {
    const img = new Image();
    img.onload = () => {
      state.templateNatural = {
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0
      };
    };
    img.src = url;
  }


  function setZoom(z) {
    state.zoom = Math.min(4, Math.max(0.2, z));
    $('#stage').style.transform = `scale(${state.zoom})`;
    $('#zoomLabel').textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;
  }

  function applyTheme() {
    document.body.classList.toggle('white-mode', state.themeWhite);
    $('#btnThemeToggle').textContent = state.themeWhite ? 'Modo oscuro' : 'Modo blanco';
    $('#btnThemeToggle').setAttribute('aria-pressed', String(state.themeWhite));
    localStorage.setItem('rp:lienzo:white', JSON.stringify(state.themeWhite));
  }

  async function init() {
    bindUI();
    applyTheme();

    const ctx = await window.api.ui.getContext();
    state.pedidoId = Number(ctx?.pedidoId || 0) || null;
    state.partidaId = ctx?.partidaId ? Number(ctx.partidaId) : null;
    state.partidaIndex = Number(ctx?.partidaIndex || 0) || 0;

    if (!state.pedidoId) { alert('Sin contexto de pedido.'); return; }

    const data = await window.api.orders.get(state.pedidoId);
    if (!data) { alert('No se pudo cargar el pedido.'); return; }

    $('.chips .chip:nth-child(1)').innerHTML = `Pedido: <strong>#${data.pedido.folio}</strong>`;
    $('.chips .chip:nth-child(2)').innerHTML = `Cliente: <strong>${data.cliente?.nombre || '-'}</strong>`;
    $('.chips .chip:nth-child(3)').innerHTML = `Estado: <strong>${data.pedido.estado}</strong>`;

    const part = (state.partidaId)
      ? data.partidas.find(p => Number(p.id) === state.partidaId)
      : data.partidas[state.partidaIndex];

    if (!part) { alert('No se encontró la partida.'); return; }

    const pxW = cmToPx(Number(part.ancho_cm || 10));
    const pxH = cmToPx(Number(part.alto_cm || 10));
    setArtboardSize(pxW, pxH);

    const guessTpl = (part.producto || '').toLowerCase().includes('camiseta') ? 'Camiseta'
      : (part.producto || '').toLowerCase().includes('sudadera') ? 'Sudadera'
        : (part.producto || '').toLowerCase().includes('taza') ? 'Taza'
          : (part.producto || '').toLowerCase().includes('gorro') ? 'Gorro'
            : (part.producto || '').toLowerCase().includes('lona') ? 'Lona'
              : 'Tarjeta';
    tplName.value = guessTpl;
    setTemplateVisual(guessTpl);

    widthInput.value = pxW;
    heightInput.value = pxH;
    colorMode.value = 'CMYK';
    bleedSel.value = '20';
  }

  /* ========= capas de LOGO (drag + resize) ========= */
  function makeDraggableResizable(imgEl) {
    imgEl.classList.add('logo-layer');
    imgEl.style.position = 'absolute';
    imgEl.style.left = '10px';
    imgEl.style.top = '10px';
    imgEl.style.maxWidth = '100%';
    imgEl.style.maxHeight = '100%';
    imgEl.style.cursor = 'move';
    imgEl.style.userSelect = 'none';

    // drag
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    imgEl.addEventListener('mousedown', (e) => {
      if (e.target.dataset.handle === 'resize') return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = imgEl.getBoundingClientRect();
      const pr = artboard.getBoundingClientRect();
      ox = (r.left - pr.left) / state.zoom;  // corregir por zoom
      oy = (r.top - pr.top) / state.zoom;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - sx) / state.zoom;
      const dy = (e.clientY - sy) / state.zoom;
      imgEl.style.left = Math.max(0, Math.min(artboard.clientWidth - imgEl.clientWidth, ox + dx)) + 'px';
      imgEl.style.top = Math.max(0, Math.min(artboard.clientHeight - imgEl.clientHeight, oy + dy)) + 'px';
    });
    window.addEventListener('mouseup', () => dragging = false);

    // handle de resize
    const h = document.createElement('div');
    h.dataset.handle = 'resize';
    h.style.position = 'absolute';
    h.style.right = '-6px';
    h.style.bottom = '-6px';
    h.style.width = '12px';
    h.style.height = '12px';
    h.style.background = 'rgba(255,255,255,.9)';
    h.style.border = '1px solid #9fb3ff';
    h.style.borderRadius = '4px';
    h.style.cursor = 'se-resize';
    imgEl.appendChild(h);

    let resizing = false, sw = 0, sh = 0, rsx = 0, rsy = 0;
    h.addEventListener('mousedown', (e) => {
      resizing = true; rsx = e.clientX; rsy = e.clientY; sw = imgEl.clientWidth; sh = imgEl.clientHeight;
      e.stopPropagation(); e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = (e.clientX - rsx) / state.zoom;
      const dy = (e.clientY - rsy) / state.zoom;
      const nw = Math.max(24, sw + dx);
      const nh = Math.max(24, sh + dy);
      imgEl.style.width = nw + 'px';
      imgEl.style.height = 'auto';
      if (imgEl.clientHeight > artboard.clientHeight) {
        imgEl.style.height = nh + 'px';
        imgEl.style.width = 'auto';
      }
    });
    window.addEventListener('mouseup', () => resizing = false);
  }

  async function openLogosModal() {
    const backdrop = $('#logosModal');
    const grid = $('#logosGrid');
    backdrop.style.display = 'flex';
    grid.innerHTML = 'Cargando…';

    try {
      const logos = await window.api.media.list({ tag: 'logo' });
      grid.innerHTML = '';
      if (!logos.length) {
        grid.innerHTML = '<div class="muted">No hay logos guardados.</div>';
        return;
      }
      logos.forEach(l => {
        const card = document.createElement('div');
        card.className = 'thumb-card';
        card.innerHTML = `
          <img src="${l.dataUrl}" alt="${l.filename}">
          <div class="meta">${l.filename}</div>
        `;
        card.addEventListener('click', () => {
          const img = document.createElement('img');
          img.src = l.dataUrl; // data URL
          img.alt = l.filename;
          makeDraggableResizable(img);
          artboard.appendChild(img);
          closeLogosModal();
        });
        grid.appendChild(card);
      });
    } catch {
      grid.innerHTML = '<div class="muted">No se pudieron cargar los logos.</div>';
    }
  }
  function closeLogosModal() { $('#logosModal').style.display = 'none'; }

  async function uploadLogoFromFileInput() {
    const inp = $('#logoFile');
    const f = inp.files?.[0];
    if (!f) return;
    const b64 = await fileToBase64(f);
    const img = await getImageSize(b64);
    const payload = {
      filename: f.name,
      mime: f.type || 'image/png',
      width: img.width,
      height: img.height,
      tags: ['logo'],
      base64: b64
    };
    const res = await window.api.media.upload(payload);
    if (res?.ok) await openLogosModal();
    else alert('No se pudo subir el logo.');
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function getImageSize(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.src = dataUrl;
    });
  }

  /* ========= Guardar Preview ========= */
  async function composePreviewCanvas() {
    const w = artboard.clientWidth;
    const h = artboard.clientHeight;

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;

    // 1) Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // 2) DIBUJAR TEMPLATE (de fondo) – usando "contain" y centrado
    const tplUrl = getTemplateUrl();
    if (tplUrl) {
      await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const tw = im.naturalWidth || im.width || 1;
          const th = im.naturalHeight || im.height || 1;
          const s = Math.min(w / tw, h / th);   // contain
          const dw = Math.round(tw * s);
          const dh = Math.round(th * s);
          const dx = Math.round((w - dw) / 2);
          const dy = Math.round((h - dh) / 2);
          ctx.drawImage(im, dx, dy, dw, dh);
          resolve();
        };
        // Para file:///SVG/PNG en Electron no hace falta CORS, pero no estorba:
        im.crossOrigin = 'anonymous';
        im.src = tplUrl;
      });
    }

    // 3) LOGOS / capas de arte en su posición actual
    const layers = $$('.logo-layer', artboard);
    for (const node of layers) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const rect = node.getBoundingClientRect();
          const pr = artboard.getBoundingClientRect();
          const x = rect.left - pr.left;
          const y = rect.top - pr.top;
          const iw = node.clientWidth;
          const ih = node.clientHeight;
          ctx.drawImage(im, x, y, iw, ih);
          resolve();
        };
        im.crossOrigin = 'anonymous';
        im.src = node.src;
      });
    }

    // 4) PNG final
    return canvas.toDataURL('image/png');
  }


  async function saveDesign() {
    try {
      // 1) actualizar ancho/alto (cm) y, si aplica, el producto con la plantilla
      const cmW = pxToCm(Number(widthInput.value || 0));
      const cmH = pxToCm(Number(heightInput.value || 0));

      const data = await window.api.orders.get(state.pedidoId);
      const part = (state.partidaId)
        ? data.partidas.find(p => Number(p.id) === state.partidaId)
        : data.partidas[state.partidaIndex];
      if (!part) { alert('No se encontró la partida a guardar.'); return; }

      const cantidad = Number(part.cantidad || 1);
      const pu = Number(part.precio_unitario || 0);
      const subtotal = +(cantidad * pu).toFixed(2);

      const updateData = {
        ancho_cm: cmW,
        alto_cm: cmH,
        subtotal
      };

      // ← Aquí escribimos la plantilla en el campo "producto"
      // Solo si estaba vacío (para no sobreescribir manuales)
      const chosenTpl = (tplName.value || '').trim();
      if (chosenTpl && (!part.producto || String(part.producto).trim() === '')) {
        updateData.producto = chosenTpl;
      }

      const upd = await window.api.orders.updatePartida(Number(part.id), updateData);
      if (!upd?.ok) { alert('No se pudo actualizar la partida.'); return; }
      await window.api.orders.recalcTotals(state.pedidoId);

      // 2) generar PNG del arte
      const dataUrl = await composePreviewCanvas();

      // 3) subir a medios como preview
      const up = await window.api.media.upload({
        filename: `preview-${state.pedidoId}-${part.id}.png`,
        mime: 'image/png',
        width: Number(widthInput.value || 0),
        height: Number(heightInput.value || 0),
        tags: ['preview'],
        base64: dataUrl,
        origin: 'preview'
      });
      if (!up?.ok || !up.id) { alert('No se pudo subir el preview.'); return; }

      // 4) enlazar en disenos
      await window.api.design.savePreview({
        pedidoId: state.pedidoId,
        partidaId: Number(part.id),
        medioId: Number(up.id),
        nombrePlantilla: tplName.value,
        lienzoAnchoPx: Number(widthInput.value || 0),
        lienzoAltoPx: Number(heightInput.value || 0),
        modoColor: colorMode.value,
        sangradoPx: Number(bleedSel.value || 0)
      });

      // 5) migaja para Caja (muestra preview al regresar)
      localStorage.setItem('rp:preview', JSON.stringify({
        pedidoId: state.pedidoId,
        partidaIndex: state.partidaIndex,
        dataUrl
      }));

      toast('Guardado', 'Preview generado y enlazado.');
      // Regresar a caja con el contexto del pedido
      await window.api.navigate('caja.html', { pedidoId: String(state.pedidoId) });
    } catch (err) {
      console.error('[lienzo] saveDesign error', err);
      alert('No se pudo guardar el diseño.');
    }
  }

  /* ========= UI ========= */
  function showShortcuts() {
    alert(`Atajos:
- Ctrl+S: Guardar preview
- L: Alternar modo claro/oscuro
- H: Ayuda
- +/-: Zoom, 100%: reset`);
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

  function bindUI() {
    // Plantillas (selección por radios)
    $('#templateRadios')?.addEventListener('change', (e) => {
      const r = e.target.closest('input[type=radio][name=tpl]');
      if (!r) return;
      const w = Number(r.dataset.width || 600);
      const h = Number(r.dataset.height || 400);
      tplName.value = String(r.dataset.name || 'Plantilla');
      setTemplateVisual(tplName.value);
      setArtboardSize(w, h);
      widthInput.value = w;
      heightInput.value = h;
    });

    widthInput.addEventListener('input', () => setArtboardSize(Number(widthInput.value || 1), Number(heightInput.value || 1)));
    // (fix) alto debe usar (width,height) en ese orden
    heightInput.addEventListener('input', () => setArtboardSize(Number(widthInput.value || 1), Number(heightInput.value || 1)));

    $('#toggleGrid').addEventListener('change', (e) => artboard.classList.toggle('grid', !!e.target.checked));
    $('#toggleGuides').addEventListener('change', (e) => {
      $$('.guide').forEach(g => g.style.display = e.target.checked ? '' : 'none');
    });

    $('#zoomIn').addEventListener('click', () => setZoom(state.zoom + 0.1));
    $('#zoomOut').addEventListener('click', () => setZoom(state.zoom - 0.1));
    $('#zoomReset').addEventListener('click', () => setZoom(1));

    $('#btnThemeToggle').addEventListener('click', () => { state.themeWhite = !state.themeWhite; applyTheme(); });

    $('#btnShortcuts').addEventListener('click', showShortcuts);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveDesign(); }
      if (e.key.toLowerCase() === 'l') { e.preventDefault(); state.themeWhite = !state.themeWhite; applyTheme(); }
      if (e.key.toLowerCase() === 'h') { e.preventDefault(); showShortcuts(); }
    });

    $('#btnSave').addEventListener('click', saveDesign);

    // Modal logos
    $('#btnLogos').addEventListener('click', openLogosModal);
    $('#btnCloseLogos').addEventListener('click', closeLogosModal);
    $('#btnUploadLogo').addEventListener('click', uploadLogoFromFileInput);
  }
  function extractBgUrl(el) {
    const bg = getComputedStyle(el).backgroundImage || '';
    // formatos posibles: url("file:///..."), url(file:///...), none
    const m = bg.match(/url\((?:'|")?(.*?)(?:'|")?\)/i);
    return m ? m[1] : null;
  }

  function getTemplateUrl() {
    // preferimos la guardada; si no, leemos del CSS por si algo la borró
    return state.templateUrl || extractBgUrl(templateVisual) || null;
  }

  setZoom(1);
  init();
})();
