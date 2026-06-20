// auth.js — Verificação de sessão compartilhada
// Incluir no <head> de todas as páginas protegidas
(function () {
  const PAGES_PUBLICAS = ['/login.html'];
  const path = window.location.pathname;
  if (PAGES_PUBLICAS.some(p => path.endsWith(p))) return;

  const raw = sessionStorage.getItem('cp_user');
  if (!raw) { window.location.href = '/login.html'; throw new Error('not-auth'); }

  try {
    const user = JSON.parse(raw);
    // Sessão de 12 horas
    if (!user.logged_at || Date.now() - user.logged_at > 12 * 3600 * 1000) {
      sessionStorage.removeItem('cp_user');
      window.location.href = '/login.html';
      throw new Error('session-expired');
    }
    window.CP_USER = user;
  } catch (e) {
    if (e.message === 'not-auth' || e.message === 'session-expired') throw e;
    sessionStorage.removeItem('cp_user');
    window.location.href = '/login.html';
  }
})();
