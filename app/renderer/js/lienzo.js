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
    templateUrl: null,
    templateNatural: { w: 0, h: 0 },
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

  /* ========= LOGOS (drag + resize estilo Canva) ========= */
  // Devuelve un contenedor .logo-item con el <img> dentro y 4 handlers.
  function makeDraggableResizable(imgEl) {
    const MIN = 24;

    // Contenedor (no afecta estilos globales; todo inline)
    const wrap = document.createElement('div');
    wrap.className = 'logo-item';
    wrap.style.position = 'absolute';
    wrap.style.left = '10px';
    wrap.style.top = '10px';
    wrap.style.zIndex = '30';
    wrap.style.userSelect = 'none';
    wrap.style.cursor = 'move';
    wrap.style.boxSizing = 'border-box';
    wrap.style.border = '1px dashed rgba(154,172,224,.0)';

    // Imagen
    imgEl.classList.add('logo-layer'); // compatibilidad con código existente
    imgEl.style.display = 'block';
    imgEl.style.width = '100%';
    imgEl.style.height = 'auto';
    imgEl.style.pointerEvents = 'none'; // el drag se maneja en el wrapper
    wrap.appendChild(imgEl);

    // Tamaño inicial: 30% del ancho del lienzo manteniendo proporción
    const fitInitialSize = () => {
      const W = artboard.clientWidth;
      const target = Math.max(MIN, Math.round(W * 0.3));
      const im = new Image();
      im.onload = () => {
        const ratio = (im.naturalHeight || im.height || 1) / (im.naturalWidth || im.width || 1);
        const w = Math.min(target, artboard.clientWidth - 20);
        const h = Math.max(MIN, Math.round(w * ratio));
        wrap.style.width = `${w}px`;
        wrap.style.height = `${h}px`;
      };
      im.src = imgEl.src;
    };

    // ===== Drag del contenedor =====
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onDownDrag = (e) => {
      if (e.target.dataset.handle) return; // si tocó un handler, no arrastrar
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = wrap.getBoundingClientRect();
      const pr = artboard.getBoundingClientRect();
      ox = (r.left - pr.left) / state.zoom;
      oy = (r.top  - pr.top ) / state.zoom;
      e.preventDefault();
    };
    const onMoveDrag = (e) => {
      if (!dragging) return;
      const dx = (e.clientX - sx) / state.zoom;
      const dy = (e.clientY - sy) / state.zoom;
      const maxX = artboard.clientWidth  - wrap.clientWidth;
      const maxY = artboard.clientHeight - wrap.clientHeight;
      const nx = Math.max(0, Math.min(maxX, ox + dx));
      const ny = Math.max(0, Math.min(maxY, oy + dy));
      wrap.style.left = `${nx}px`;
      wrap.style.top  = `${ny}px`;
    };
    const onUpDrag = () => { dragging = false; };

    wrap.addEventListener('mousedown', onDownDrag);
    window.addEventListener('mousemove', onMoveDrag);
    window.addEventListener('mouseup', onUpDrag);

    // ===== Handles de resize (4 esquinas)
    const createHandle = (pos, cursor) => {
      const h = document.createElement('div');
      h.dataset.handle = pos;
      Object.assign(h.style, {
        position: 'absolute',
        width: '12px', height: '12px',
        borderRadius: '4px',
        background: 'rgba(255,255,255,.9)',
        border: '1px solid #9fb3ff',
        boxShadow: '0 1px 4px rgba(0,0,0,.15)',
        cursor,
        zIndex: '1'
      });
      if (pos.includes('n')) h.style.top = '-6px';
      if (pos.includes('s')) h.style.bottom = '-6px';
      if (pos.includes('w')) h.style.left = '-6px';
      if (pos.includes('e')) h.style.right = '-6px';
      wrap.appendChild(h);
      return h;
    };

    const hNW = createHandle('nw', 'nwse-resize');
    const hNE = createHandle('ne', 'nesw-resize');
    const hSW = createHandle('sw', 'nesw-resize');
    const hSE = createHandle('se', 'nwse-resize');

    let resizing = false, start = null, keepRatio = true;
    const onDownResize = (e) => {
      resizing = true;
      start = {
        x: e.clientX, y: e.clientY,
        w: wrap.clientWidth, h: wrap.clientHeight,
        l: parseFloat(wrap.style.left || '0'),
        t: parseFloat(wrap.style.top  || '0'),
        handle: e.target.dataset.handle
      };
      wrap.style.border = '1px dashed rgba(154,172,224,.9)'; // borde visible durante resize
      e.stopPropagation(); e.preventDefault();
    };
    const onMoveResize = (e) => {
      if (!resizing) return;
      keepRatio = !e.shiftKey; // mantener proporción por default; Shift = libre

      const dx = (e.clientX - start.x) / state.zoom;
      const dy = (e.clientY - start.y) / state.zoom;

      let w = start.w, h = start.h, l = start.l, t = start.t;
      const ratio = start.h / start.w || 1;

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const MaxW = artboard.clientWidth;
      const MaxH = artboard.clientHeight;

      switch (start.handle) {
        case 'se': {
          w = clamp(start.w + dx, MIN, MaxW);
          h = keepRatio ? Math.max(MIN, Math.round(w * ratio)) : clamp(start.h + dy, MIN, MaxH);
          break;
        }
        case 'sw': {
          w = clamp(start.w - dx, MIN, MaxW);
          h = keepRatio ? Math.max(MIN, Math.round(w * ratio)) : clamp(start.h + dy, MIN, MaxH);
          l = start.l + (start.w - w);
          break;
        }
        case 'ne': {
          w = clamp(start.w + dx, MIN, MaxW);
          h = keepRatio ? Math.max(MIN, Math.round(w * ratio)) : clamp(start.h - dy, MIN, MaxH);
          t = start.t + (start.h - h);
          break;
        }
        case 'nw': {
          w = clamp(start.w - dx, MIN, MaxW);
          h = keepRatio ? Math.max(MIN, Math.round(w * ratio)) : clamp(start.h - dy, MIN, MaxH);
          l = start.l + (start.w - w);
          t = start.t + (start.h - h);
          break;
        }
      }

      // Limitar al lienzo
      l = clamp(l, 0, artboard.clientWidth  - w);
      t = clamp(t, 0, artboard.clientHeight - h);

      wrap.style.left = `${l}px`;
      wrap.style.top  = `${t}px`;
      wrap.style.width  = `${w}px`;
      wrap.style.height = `${h}px`;
    };
    const onUpResize = () => {
      if (!resizing) return;
      resizing = false;
      wrap.style.border = '1px dashed rgba(154,172,224,.0)'; // ocultar borde
    };

    [hNW, hNE, hSW, hSE].forEach(h => h.addEventListener('mousedown', onDownResize));
    window.addEventListener('mousemove', onMoveResize);
    window.addEventListener('mouseup', onUpResize);

    // Hover (borde sutil)
    wrap.addEventListener('mouseenter', () => { wrap.style.border = '1px dashed rgba(154,172,224,.5)'; });
    wrap.addEventListener('mouseleave', () => { if (!resizing) wrap.style.border = '1px dashed rgba(154,172,224,.0)'; });

    if (imgEl.complete) fitInitialSize(); else imgEl.addEventListener('load', fitInitialSize, { once: true });

    return wrap;
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
          const node = makeDraggableResizable(img); // ← usar el contenedor con handlers
          artboard.appendChild(node);
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

    // 2) Template de fondo (contain y centrado)
    const tplUrl = getTemplateUrl();
    if (tplUrl) {
      await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const tw = im.naturalWidth || im.width || 1;
          const th = im.naturalHeight || im.height || 1;
          const s = Math.min(w / tw, h / th);
          const dw = Math.round(tw * s);
          const dh = Math.round(th * s);
          const dx = Math.round((w - dw) / 2);
          const dy = Math.round((h - dh) / 2);
          ctx.drawImage(im, dx, dy, dw, dh);
          resolve();
        };
        im.crossOrigin = 'anonymous';
        im.src = tplUrl;
      });
    }

    // 3) LOGOS / capas — soporta contenedores .logo-item y legacy <img.logo-layer>
    // 3a) Contenedores nuevos
    const wrappers = $$('.logo-item', artboard);
    for (const wrap of wrappers) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const img = wrap.querySelector('img');
        if (!img) return resolve();
        const im = new Image();
        im.onload = () => {
          const rect = wrap.getBoundingClientRect();
          const pr = artboard.getBoundingClientRect();
          const x = rect.left - pr.left;
          const y = rect.top  - pr.top;
          const w2 = wrap.clientWidth;
          const h2 = wrap.clientHeight || Math.round(w2 * (im.naturalHeight || 1) / (im.naturalWidth || 1));
          ctx.drawImage(im, x, y, w2, h2);
          resolve();
        };
        im.crossOrigin = 'anonymous';
        im.src = img.src;
      });
    }

    // 3b) Compatibilidad con capas antiguas (img.logo-layer sin wrapper)
    const legacyLayers = $$('.logo-layer', artboard).filter(n => !n.closest('.logo-item'));
    for (const node of legacyLayers) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const rect = node.getBoundingClientRect();
          const pr = artboard.getBoundingClientRect();
          const x = rect.left - pr.left;
          const y = rect.top  - pr.top;
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
      // 1) actualizar ancho/alto (cm) y, si aplica, producto
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
    // Plantillas (radios)
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
    const m = bg.match(/url\((?:'|")?(.*?)(?:'|")?\)/i);
    return m ? m[1] : null;
  }

  function getTemplateUrl() {
    return state.templateUrl || extractBgUrl(templateVisual) || null;
  }

  setZoom(1);
  init();
})();
