// app/renderer/js/auth-guard.js
window.authGuard = (function () {
  async function requireLogin(rolesAceptados = []) {
    const me = await window.api.auth.me();
    if (!me) {
      await window.api.navigate('login.html');
      return null;
    }
    if (rolesAceptados.length) {
      const ok = rolesAceptados.map(r => r.toLowerCase()).includes((me.rol || '').toLowerCase());
      // Admin pasa a todo
      if (!ok && (me.rol || '').toLowerCase() !== 'admin') {
        await window.api.navigate('login.html');
        return null;
      }
    }
    return me;
  }

  async function logoutAndGoLogin() {
    try { await window.api.auth.logout(); } catch { /* noop */ }
    await window.api.navigate('login.html');
  }

  return { requireLogin, logoutAndGoLogin };
})();
