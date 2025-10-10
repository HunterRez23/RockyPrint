document.addEventListener('DOMContentLoaded', () => {
  const artboard = document.getElementById('artboard');
  const frameLabel = document.getElementById('frameLabel');
  const tplNameInput = document.getElementById('tplName');
  const widthInput = document.getElementById('widthInput');
  const heightInput = document.getElementById('heightInput');
  const bleed = document.getElementById('bleed');
  const bleedSelect = document.getElementById('bleedSelect');
  const toggleGrid = document.getElementById('toggleGrid');
  const toggleGuides = document.getElementById('toggleGuides');
  const notesList = document.getElementById('notesList');
  const newNoteText = document.getElementById('newNoteText');
  const btnAddNote = document.getElementById('btnAddNote');
  const btnClearNotes = document.getElementById('btnClearNotes');
  const zoomLabel = document.getElementById('zoomLabel');
  const posLabel = document.getElementById('posLabel');
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const zoomReset = document.getElementById('zoomReset');
  const templateRadios = document.getElementById('templateRadios');
  const stage = document.getElementById('stage');
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const featureRow = document.getElementById('featureRow');
  const featureSelect = document.getElementById('featureSelect');
  const templateVisual = document.getElementById('templateVisual');
  const body = document.body;

  /* --- Estado --- */
  let zoom = 1;              // 1 = 100%
  let noteCounter = notesList.querySelectorAll('.note').length || 0;
  const templateState = {};
  let currentTemplate = '';
  const templateFeatures = {
    Camiseta: ['Tiro de hombre', 'Tiro de mujer', 'Desmangada'],
    Sudadera: ['Con gorro', 'Sin gorro', 'Cremallera completa'],
    Tarjeta: ['Acabado brillante', 'Acabado mate', 'Repujada'],
    Lona: ['Perforada', 'Sin perforar', 'Refuerzo perimetral'],
    Taza: ['Interior blanco', 'Interior de color', 'Taza m\u00E1gica'],
    Gorro: ['Tipo snapback', 'Tipo trucker', 'Visera plana']
  };
  const templateSvgMap = {
    Camiseta: 'assets/camiseta.svg',
    Sudadera: 'assets/sudadera.svg',
    Tarjeta: 'assets/tarjeta.svg',
    Lona: 'assets/lona.svg',
    Taza: 'assets/taza.svg',
    Gorro: 'assets/gorra.svg'
  };
  const svgCache = {};

  // Pegarlo al inicio de cada JS (caja.js, pedidos.js, lienzo.js)
(async () => {
  const me = await window.api.auth.get();
  if (!me) { await window.api.navigate('login.html'); return; }

  const pagina = location.pathname.split('/').pop();
  const rol = me.rol;

  const allow = {
    'caja.html':    ['caja','admin'],
    'lienzo.html':  ['caja','admin'],      // ✅ caja y admin
    'pedidos.html': ['produccion','admin','caja']
  };

  const ok = (allow[pagina] || ['admin']).includes(rol);
  if (!ok) {
    alert(`No tienes acceso a ${pagina}. Tu rol: ${rol}.`);
    if (rol === 'caja') await window.api.navigate('caja.html');
    else if (rol === 'produccion') await window.api.navigate('pedidos.html');
    else await window.api.navigate('pedidos.html');
  }
})();


  /* --- Utilidades --- */
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const setSize = (w, h) => {
    artboard.style.setProperty('--w', `${w}px`);
    artboard.style.setProperty('--h', `${h}px`);
    widthInput.value = w;
    heightInput.value = h;
    if (currentTemplate) {
      if (!templateState[currentTemplate]) {
        templateState[currentTemplate] = {};
      }
      templateState[currentTemplate].width = w;
      templateState[currentTemplate].height = h;
    }
  };
  const setZoom = (z) => {
    zoom = clamp(z, 0.5, 2.0);
    artboard.style.transform = `translate(-50%, -50%) scale(${zoom})`;
    zoomLabel.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
  };
  const updatePosLabel = (e) => {
    const rect = artboard.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    posLabel.textContent = `X: ${x}px · Y: ${y}px`;
  };
  const applyTemplateVisualMarkup = (name, markup) => {
    if (!templateVisual) return;
    if (currentTemplate !== name) return;
    if (markup) {
      templateVisual.innerHTML = markup;
      templateVisual.classList.add('is-active');
    } else {
      templateVisual.innerHTML = '';
      templateVisual.classList.remove('is-active');
    }
  };
  const loadTemplateVisual = (name) => {
    if (!templateVisual) return;
    const src = templateSvgMap[name];
    if (!src) {
      applyTemplateVisualMarkup(name, '');
      return;
    }
    const cached = svgCache[src];
    if (cached) {
      applyTemplateVisualMarkup(name, cached);
      return;
    }
    fetch(src)
      .then((response) => (response.ok ? response.text() : ''))
      .then((markup) => {
        if (markup) {
          svgCache[src] = markup;
          applyTemplateVisualMarkup(name, markup);
        } else {
          applyTemplateVisualMarkup(name, '');
        }
      })
      .catch(() => applyTemplateVisualMarkup(name, ''));
  };
  const persistCurrentTemplateState = () => {
    if (!currentTemplate) return;
    if (!templateState[currentTemplate]) {
      templateState[currentTemplate] = {};
    }
    templateState[currentTemplate].width = parseInt(widthInput.value || '0', 10);
    templateState[currentTemplate].height = parseInt(heightInput.value || '0', 10);
    if (featureSelect && featureRow && !featureRow.hidden) {
      templateState[currentTemplate].feature = featureSelect.value;
    }
  };
  const updateFeatureOptions = (templateName, preferredValue = '') => {
    if (!featureRow || !featureSelect) return;
    const options = templateFeatures[templateName] || [];
    featureSelect.innerHTML = '';
    if (!options.length) {
      featureRow.hidden = true;
      featureSelect.disabled = true;
      if (!templateState[templateName]) {
        templateState[templateName] = {};
      }
      templateState[templateName].feature = '';
      return;
    }
    featureRow.hidden = false;
    featureSelect.disabled = false;
    options.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      featureSelect.appendChild(option);
    });
    const selected = options.includes(preferredValue) ? preferredValue : options[0];
    featureSelect.value = selected;
    if (!templateState[templateName]) {
      templateState[templateName] = {};
    }
    templateState[templateName].feature = selected;
  };
  const applyTemplateFromInput = (input) => {
    if (!input) return;
    const name = input.dataset.name || 'Lienzo';
    const defaultWidth = parseInt(input.dataset.width || '600', 10);
    const defaultHeight = parseInt(input.dataset.height || '400', 10);
    if (!templateState[name]) {
      templateState[name] = {
        width: defaultWidth,
        height: defaultHeight,
        feature: ''
      };
    } else {
      templateState[name].width = templateState[name].width || defaultWidth;
      templateState[name].height = templateState[name].height || defaultHeight;
    }
    currentTemplate = name;
    setSize(templateState[name].width, templateState[name].height);
    artboard.dataset.template = name;
    frameLabel.textContent = `Área de impresión — ${name}`;
    tplNameInput.value = name;
    updateFeatureOptions(name, templateState[name].feature);
    loadTemplateVisual(name);
  };

  /* --- Inicial --- */
  setZoom(1);
  /* --- Tema --- */
  const themeStorageKey = 'rockyprint:white-mode';
  const readStoredTheme = () => {
    try {
      return window.localStorage.getItem(themeStorageKey);
    } catch (_) {
      return null;
    }
  };
  const writeStoredTheme = (white) => {
    try {
      window.localStorage.setItem(themeStorageKey, white ? '1' : '0');
    } catch (_) {
      // almacenamiento no disponible (modo privado, etc.)
    }
  };
  const applyTheme = (white) => {
    body.classList.toggle('white-mode', white);
    if (!btnThemeToggle) return;
    const nextLabel = white ? 'Modo oscuro' : 'Modo blanco';
    btnThemeToggle.textContent = nextLabel;
    btnThemeToggle.setAttribute('aria-pressed', white ? 'true' : 'false');
    btnThemeToggle.title = `${nextLabel} (L)`;
  };
  const setTheme = (white, notify = false) => {
    applyTheme(white);
    writeStoredTheme(white);
    if (notify) {
      simpleToast('Tema', white ? 'Modo blanco activado.' : 'Modo oscuro activado.');
    }
  };
  const toggleTheme = (notify = false) => {
    const next = !body.classList.contains('white-mode');
    setTheme(next, notify);
  };

  applyTheme(readStoredTheme() === '1');

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => toggleTheme(true));
  }

  const initialTemplateRadio = templateRadios.querySelector('input[type="radio"]:checked');
  if (initialTemplateRadio) {
    applyTemplateFromInput(initialTemplateRadio);
  }
  if (featureSelect) {
    featureSelect.addEventListener('change', () => {
      if (!currentTemplate) return;
      if (!templateState[currentTemplate]) {
        templateState[currentTemplate] = {};
      }
      templateState[currentTemplate].feature = featureSelect.value;
    });
  }


  /* --- Plantillas (radio) --- */
  templateRadios.addEventListener('change', (e) => {
    const input = e.target.closest('input[type="radio"]');
    if (!input) return;
    persistCurrentTemplateState();
    applyTemplateFromInput(input);
  });

  /* --- Tamaño manual --- */
  widthInput.addEventListener('input', () => {
    const w = clamp(parseInt(widthInput.value || '0', 10), 100, 4000);
    setSize(w, parseInt(getComputedStyle(artboard).getPropertyValue('--h'), 10));
  });
  heightInput.addEventListener('input', () => {
    const h = clamp(parseInt(heightInput.value || '0', 10), 100, 4000);
    setSize(parseInt(getComputedStyle(artboard).getPropertyValue('--w'), 10), h);
  });

  /* --- Sangrado --- */
  bleedSelect.addEventListener('change', () => {
    const inset = parseInt(bleedSelect.value || '20', 10);
    bleed.style.inset = inset ? `${inset}px` : `0px`;
    bleed.style.display = inset === 0 ? 'none' : 'block';
  });

  /* --- Cuadrícula --- */
  toggleGrid.addEventListener('change', () => {
    artboard.classList.toggle('grid', toggleGrid.checked);
  });

  /* --- Guías --- */
  const setGuidesVisibility = (visible) => {
    artboard.querySelectorAll('.guide').forEach(g => {
      g.style.display = visible ? 'block' : 'none';
    });
  };
  toggleGuides.addEventListener('change', () => {
    setGuidesVisibility(toggleGuides.checked);
  });

  /* --- Notas --- */
  const dragNote = (noteEl, startEvent, { offsetX, offsetY, isNew = false, onDrop, onCancel } = {}) => {
    const pointerId = startEvent.pointerId;
    const artRect = artboard.getBoundingClientRect();
    const boardWidth = artboard.clientWidth;
    const boardHeight = artboard.clientHeight;
    const initialRect = noteEl.getBoundingClientRect();
    const derivedOffsetX = offsetX !== undefined ? offsetX : (startEvent.clientX - initialRect.left) / zoom;
    const derivedOffsetY = offsetY !== undefined ? offsetY : (startEvent.clientY - initialRect.top) / zoom;
    const maxLeft = Math.max(boardWidth - noteEl.offsetWidth, 0);
    const maxTop = Math.max(boardHeight - noteEl.offsetHeight, 0);

    const applyPosition = (clientX, clientY) => {
      const x = (clientX - artRect.left) / zoom;
      const y = (clientY - artRect.top) / zoom;
      const left = clamp(x - derivedOffsetX, 0, maxLeft);
      const top = clamp(y - derivedOffsetY, 0, maxTop);
      noteEl.style.left = `${left}px`;
      noteEl.style.top = `${top}px`;
    };

    const handleMove = (evt) => {
      if (evt.pointerId !== pointerId) return;
      applyPosition(evt.clientX, evt.clientY);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleCancel);
      noteEl.classList.remove('dragging');
    };

    const handleEnd = (evt) => {
      if (evt.pointerId !== pointerId) return;
      cleanup();
      const inside = evt.clientX >= artRect.left && evt.clientX <= artRect.right && evt.clientY >= artRect.top && evt.clientY <= artRect.bottom;
      if (!inside && isNew) {
        noteEl.remove();
        if (onCancel) onCancel();
        return;
      }
      noteEl.style.pointerEvents = 'auto';
      if (onDrop) onDrop();
    };

    const handleCancel = (evt) => {
      if (evt.pointerId !== pointerId) return;
      cleanup();
      if (isNew) {
        noteEl.remove();
      } else {
        noteEl.style.pointerEvents = 'auto';
      }
      if (onCancel) onCancel();
    };

    noteEl.classList.add('dragging');
    noteEl.style.pointerEvents = 'none';
    applyPosition(startEvent.clientX, startEvent.clientY);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleCancel);
  };

  const decorateCanvasNote = (noteEl) => {
    if (!noteEl) return;
    noteEl.classList.add('canvas-note');
    if (noteEl.dataset.canvasDecorated === '1') return;
    noteEl.dataset.canvasDecorated = '1';
    noteEl.style.position = 'absolute';
    noteEl.style.touchAction = 'none';
    if (!noteEl.style.width) {
      noteEl.style.width = `${noteEl.offsetWidth}px`;
    }
    if (!noteEl.style.height) {
      noteEl.style.height = `${noteEl.offsetHeight}px`;
    }
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'note-remove';
    removeBtn.setAttribute('aria-label', 'Eliminar nota');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('pointerdown', (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
    });
    removeBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      noteEl.remove();
    });
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'note-resize';
    resizeHandle.innerHTML = '&#x2198;';
    noteEl.appendChild(removeBtn);
    noteEl.appendChild(resizeHandle);
    resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (resizeHandle.setPointerCapture) {
        try {
          resizeHandle.setPointerCapture(event.pointerId);
        } catch (_) {}
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = noteEl.offsetWidth;
      const startHeight = noteEl.offsetHeight;
      const left = parseFloat(noteEl.style.left || '0');
      const top = parseFloat(noteEl.style.top || '0');
      const boardWidth = artboard.clientWidth;
      const boardHeight = artboard.clientHeight;
      const minWidth = 140;
      const minHeight = 90;
      const maxWidth = Math.max(minWidth, boardWidth - left);
      const maxHeight = Math.max(minHeight, boardHeight - top);
      noteEl.classList.add('resizing');
      const handleResizeMove = (moveEvt) => {
        const deltaX = (moveEvt.clientX - startX) / zoom;
        const deltaY = (moveEvt.clientY - startY) / zoom;
        const nextWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
        const nextHeight = clamp(startHeight + deltaY, minHeight, maxHeight);
        noteEl.style.width = `${nextWidth}px`;
        noteEl.style.height = `${nextHeight}px`;
      };
      const finishResize = () => {
        window.removeEventListener('pointermove', handleResizeMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerCancel);
        noteEl.classList.remove('resizing');
        if (resizeHandle.releasePointerCapture) {
          try {
            resizeHandle.releasePointerCapture(event.pointerId);
          } catch (_) {}
        }
      };
      const handlePointerUp = (evt) => {
        if (evt.pointerId !== event.pointerId) return;
        finishResize();
      };
      const handlePointerCancel = (evt) => {
        if (evt.pointerId !== event.pointerId) return;
        finishResize();
      };
      window.addEventListener('pointermove', handleResizeMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
    });
  };

  const enableCanvasNoteDrag = (noteEl) => {
    if (!noteEl || noteEl.dataset.canvasDrag === '1') return;
    decorateCanvasNote(noteEl);
    noteEl.dataset.canvasDrag = '1';
    noteEl.style.cursor = 'grab';
    noteEl.style.touchAction = 'none';
    noteEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragNote(noteEl, event);
    });
  };

  const enableLibraryNoteDrag = (noteEl) => {
    if (!noteEl || noteEl.dataset.libraryDrag === '1') return;
    noteEl.dataset.libraryDrag = '1';
    noteEl.style.cursor = 'grab';
    noteEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const sourceRect = noteEl.getBoundingClientRect();
      const floating = noteEl.cloneNode(true);
      artboard.appendChild(floating);
      decorateCanvasNote(floating);
      floating.style.left = '0px';
      floating.style.top = '0px';
      floating.style.width = `${sourceRect.width / zoom}px`;
      floating.style.height = `${sourceRect.height / zoom}px`;
      floating.style.pointerEvents = 'none';

      dragNote(floating, event, {
        offsetX: (event.clientX - sourceRect.left) / zoom,
        offsetY: (event.clientY - sourceRect.top) / zoom,
        isNew: true,
        onDrop: () => {
          floating.style.pointerEvents = 'auto';
          enableCanvasNoteDrag(floating);
        },
        onCancel: () => {
          floating.remove();
        }
      });
    });
  };

  notesList.querySelectorAll('.note').forEach(enableLibraryNoteDrag);

  const addNote = (text) => {
    noteCounter += 1;
    const article = document.createElement('article');
    article.className = 'note';
    article.innerHTML = `
      <div class="corner">#${noteCounter}</div>
      <div class="tag">Nota</div>
      <p></p>
    `;
    article.querySelector('p').textContent = text;
    notesList.appendChild(article);
    notesList.scrollTop = notesList.scrollHeight;
    enableLibraryNoteDrag(article);
  };

  btnAddNote.addEventListener('click', () => {
    const txt = (newNoteText.value || '').trim();
    if (!txt) return;
    addNote(txt);
    newNoteText.value = '';
  });

  btnClearNotes.addEventListener('click', () => {
    notesList.innerHTML = '';
    noteCounter = 0;
    artboard.querySelectorAll('.canvas-note').forEach(n => n.remove());
  });

  /* --- Zoom --- */
  zoomIn.addEventListener('click', () => setZoom(zoom + 0.1));
  zoomOut.addEventListener('click', () => setZoom(zoom - 0.1));
  zoomReset.addEventListener('click', () => setZoom(1));

  // Ctrl + rueda del mouse para zoom
  stage.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(zoom + delta);
    }
  }, { passive: false });

  // Atajos básicos
  document.addEventListener('keydown', (e) => {
    // Ctrl+S Guardar (prevent default)
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      // Aquí puedes disparar tu flujo de guardado
      simpleToast('Guardado', 'Se guardó el proyecto (demo).');
    }
    // N → nueva nota
    if (!e.ctrlKey && e.key.toLowerCase() === 'n') {
      newNoteText.focus();
    }
    // +/- zoom
    if (e.key === '+' || e.key === '=') setZoom(zoom + 0.1);
    if (e.key === '-') setZoom(zoom - 0.1);
    // L -> alternar tema
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'l') {
      const target = e.target;
      const isField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!isField) toggleTheme(true);
    }
    // G → alternar cuadrícula
    if (!e.ctrlKey && e.key.toLowerCase() === 'g') {
      toggleGrid.checked = !toggleGrid.checked;
      toggleGrid.dispatchEvent(new Event('change'));
    }
    // H → alternar guías
    if (!e.ctrlKey && e.key.toLowerCase() === 'h') {
      toggleGuides.checked = !toggleGuides.checked;
      toggleGuides.dispatchEvent(new Event('change'));
    }
    // 0 → reset zoom
    if (e.key === '0') setZoom(1);
  });

  // Cursor pos sobre artboard
  artboard.addEventListener('mousemove', updatePosLabel);
  artboard.addEventListener('mouseleave', () => posLabel.textContent = 'X: 0px · Y: 0px');

  /* --- Tool selection visual (mock) --- */
  document.querySelectorAll('.tool').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      // Aquí podrías activar el modo herramienta real
      simpleToast('Herramienta', `Seleccionada: ${t.dataset.tool}`);
    });
  });

  /* --- Botones topbar (mock) --- */
  document.getElementById('btnPreview').addEventListener('click', () => {
    simpleToast('Vista previa', 'Entrando a vista previa (demo).');
  });
  document.getElementById('btnShortcuts').addEventListener('click', () => {
    alert(`Atajos rápidos:
- Ctrl+S: Guardar
- + / - : Zoom
- 0     : Zoom 100%
- G     : Alternar cuadrícula
- H     : Alternar guías
- L     : Alternar tema
- N     : Enfocar nueva nota`);
  });

  /* --- Mini toast simple (sin librerías) --- */
  function simpleToast(title, text){
    const box = document.createElement('div');
    const styles = getComputedStyle(body);
    const toastBg = styles.getPropertyValue('--toast-bg').trim() || '#1c2540';
    const toastBorder = styles.getPropertyValue('--toast-border').trim() || '#2f3b5e';
    const toastColor = styles.getPropertyValue('--toast-text').trim() || '#dfe7ff';
    const shadow = styles.getPropertyValue('--shadow').trim() || '0 8px 20px rgba(0,0,0,.35)';
    box.style.cssText = `
      position: fixed; right: 16px; top: 16px; z-index: 9999;
      background: ${toastBg}; border:1px solid ${toastBorder}; color:${toastColor};
      padding:10px 12px; border-radius:10px; box-shadow: ${shadow};
      font: 13px/1.3 Inter, system-ui;
    `;
    box.innerHTML = `<strong style="display:block;margin-bottom:4px">${title}</strong><span>${text}</span>`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }
});