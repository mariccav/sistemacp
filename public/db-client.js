// db-client.js — Helper seguro para chamadas ao banco de dados
// Todas as páginas usam este arquivo em vez de chamar o Supabase diretamente.
// As requisições vão para /api/db que usa a chave de serviço secreta.

(function () {
  const API = '/api/db';

  function getToken() {
    const raw = sessionStorage.getItem('cp_user');
    if (!raw) return null;
    try { return JSON.parse(raw).session_token || null; }
    catch { return null; }
  }

  function headers(extra = {}) {
    const token = getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session-token': token } : {}),
      ...extra
    };
  }

  // ── API pública ──────────────────────────────────────────────────

  window.DB = {

    // Login — não requer token
    async login(username, senha_hash) {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, senha_hash })
      });
      return r.json();
    },

    // SELECT: DB.get('clientes', 'order=nome.asc&limit=100')
    async get(tabela, filtros = '') {
      const r = await fetch(API, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ tabela, filtros })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.erro || r.status); }
      return r.json();
    },

    // INSERT: DB.insert('leads', { razao_social: '...' })
    async insert(tabela, dados) {
      const r = await fetch(API, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ tabela, dados, _op: 'insert' })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.erro || r.status); }
      return r.json();
    },

    // UPDATE: DB.update('leads', 'id=eq.xxx', { etapa: 'contato' })
    async update(tabela, filtros, dados) {
      const r = await fetch(API, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ tabela, filtros, dados })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.erro || r.status); }
      return r.json();
    },

    // DELETE: DB.delete('leads', 'id=eq.xxx')
    async delete(tabela, filtros) {
      const r = await fetch(API, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ tabela, filtros })
      });
      return r.ok;
    }
  };

})();
