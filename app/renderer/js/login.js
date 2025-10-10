// app/renderer/js/login.js
(() => {
  const $ = (q) => document.querySelector(q);

  const form   = $('#loginForm');
  if (!form) return;

  const userEl = $('#usuario');
  const passEl = $('#clave');
  const areaEl = $('#area');
  const errEl  = $('#err');
  const submitBtn = form.querySelector('button[type="submit"]');

  let busy = false;

  // Mapear área a valores válidos
  const normArea = (v) => {
    const x = String(v || '').trim().toLowerCase();
    if (x === 'caja' || x === 'produccion' || x === 'admin') return x;
    return 'caja';
  };

  // Arranque: si ya hay sesión guardada, navega
  (async () => {
    try {
      const current = await window.api.auth.me();
      const rol = current?.rol ? String(current.rol).toLowerCase() : '';
      if (rol === 'caja' || rol === 'produccion' || rol === 'admin') {
        goToArea(rol);
        return;
      }
      // sesión inválida → logout silencioso
      if (current) await window.api.auth.logout();
    } catch { /* ignore */ }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearError();

    const usuario = (userEl.value || '').trim();
    const clave   = passEl.value || '';
    const area    = normArea(areaEl.value);

    if (!usuario || !clave) {
      showError('Escribe usuario y contraseña.');
      return;
    }

    try {
      setBusy(true);
      const resp = await window.api.auth.login({ usuario, clave });
      if (!resp || !resp.ok || !resp.user) {
        showError('Usuario o contraseña incorrectos.');
        passEl.value = '';
        passEl.focus();
        return;
      }

      const rol = normArea(resp.user.rol);

      // Si eligió área distinta a su rol y NO es admin, bloquea
      if (area !== rol && rol !== 'admin') {
        showError(`Tu rol es "${resp.user.rol}". No puedes entrar al área "${areaEl.value}".`);
        passEl.value = '';
        passEl.focus();
        return;
      }

      // Admin puede ir a lo que eligió en el combo
      goToArea(rol === 'admin' ? area : rol);
    } catch (err) {
      console.error('[login] error:', err);
      showError('No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  });

  function goToArea(rol) {
    let target = 'caja.html';
    if (rol === 'produccion') target = 'pedidos.html';
    if (rol === 'admin')      target = 'pedidos.html';
    window.api.navigate(target);
  }

  function showError(msg){ if (errEl) errEl.textContent = msg; }
  function clearError(){ if (errEl) errEl.textContent = ''; }
  function setBusy(flag){
    busy = !!flag;
    if (submitBtn) submitBtn.disabled = busy;
  }
})();
