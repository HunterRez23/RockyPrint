// Pedidos conectados a DB
(async () => {
  const $  = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  // Filtros UI
  const qEl     = $('#q');
  const estEl   = $('#estado');
  const desdeEl = $('#desde');
  const hastaEl = $('#hasta');

  // KPIs
  const kTotal = $('#kpiTotal');
  const kProg  = $('#kpiProg');
  const kLate  = $('#kpiLate');
  const kDone30= $('#kpiDone30');

  // Estado en memoria
  let pedidos = [];

  // Utilidades
  const fmtDate = (d)=> {
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString(); } catch { return d; }
  };
  const isLate  = (d)=> {
    if (!d) return false;
    const T=new Date(); T.setHours(0,0,0,0);
    const D=new Date(d); D.setHours(0,0,0,0);
    return D<T;
  };
  const clsEstado = (s)=> s==="Pendiente"?"s-pend" : s==="En progreso"?"s-prog" : s==="Listo"?"s-listo":"s-hold";

  // Carga desde DB
  async function loadData(){
    const filters = {
      q: qEl.value.trim() || null,
      estado: estEl.value || null,
      desde: desdeEl.value || null,
      hasta: hastaEl.value || null
    };
    pedidos = await window.api.orders.list(filters);
    render();
  }

  // KPIs
  function renderKPIs(){
    const total = pedidos.length;
    const prog  = pedidos.filter(x=>x.estado==="En progreso").length;
    const late  = pedidos.filter(x=>isLate(x.entrega_fecha) && x.estado!=="Listo").length;
    const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-30);
    const done30=pedidos.filter(x=>{
      if (x.estado!=="Listo") return false;
      const d=new Date(x.actualizado_en);
      return d>=cutoff;
    }).length;

    kTotal.textContent = total;
    kProg.textContent  = prog;
    kLate.textContent  = late;
    kDone30.textContent= done30;
  }

  // Render tarjetas
  function render(){
    const grid = $('#grid');
    grid.innerHTML = '';
    pedidos.forEach(p=>{
      const card = document.createElement('article');
      card.className='card';
      card.dataset.id = p.id;

      card.innerHTML = `
        <div class="card-head">
          <div class="handle" title="Mover">⋮⋮</div>
          <div class="pills">
            <span class="pill"># ${p.folio}</span>
            <span class="pill ${clsEstado(p.estado)}">${p.estado}</span>
            <span class="pill">Cliente: <b>${p.cliente || '-'}</b></span>
          </div>
        </div>

        <div>
          <div class="meta">
            Entrega: <b${isLate(p.entrega_fecha)?' class="late"':''}>${fmtDate(p.entrega_fecha)}</b> ·
            Actualizado: <b>${p.actualizado_en ? new Date(p.actualizado_en).toLocaleString() : '-'}</b> ·
            Total: <b>${Number(p.total_monto||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'})}</b>
          </div>
        </div>

        <div class="tools">
          <button class="iconbtn" data-ver>👁️</button>
          <button class="iconbtn" data-editar>✏️</button>
        </div>
      `;

      card.querySelector('[data-ver]').addEventListener('click', async ()=>{
        // Ver = abrir caja pre-cargada en modo "ver/editar"
        await window.api.navigate('caja.html', { pedidoId: String(p.id) });
      });
      card.querySelector('[data-editar]').addEventListener('click', async ()=>{
        await window.api.navigate('caja.html', { pedidoId: String(p.id) });
      });

      grid.appendChild(card);
    });

    renderKPIs();
  }

  // Eventos filtros
  $('#filtrarBtn').addEventListener('click', loadData);
  [qEl, estEl, desdeEl, hastaEl].forEach(el=>{
    el.addEventListener(el===qEl?'input':'change', ()=>{
      // Para no saturar DB, simple debounce manual
      clearTimeout(el._t);
      el._t = setTimeout(loadData, 200);
    });
  });

  // Inicial
  await loadData();
})();
