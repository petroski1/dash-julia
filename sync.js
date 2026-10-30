'use strict';

/* ------------------------------------------------------------------ *
 * Sincronização com o Supabase (login, leitura, gravação e tempo real).
 * Sem configuração, o app continua funcionando só com o navegador.
 * ------------------------------------------------------------------ */

const CLOUD_CONFIG_KEY = 'financas-supabase';

const cloud = {
  db: null,
  user: null,
  active: false, // logado, com acesso e dados carregados
  channel: null,

  config() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || '{}'); } catch (e) { /* ignora */ }
    const base = window.FIN_CONFIG || {};
    return {
      url: (saved.url || base.supabaseUrl || '').trim(),
      key: (saved.key || base.supabaseKey || '').trim(),
    };
  },

  saveConfig(url, key) {
    try { localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify({ url: url.trim(), key: key.trim() })); } catch (e) { /* ignora */ }
  },

  configured() {
    const c = this.config();
    return !!(c.url && c.key && window.supabase);
  },

  status(text, kind = '') {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text;
    el.className = 'sync-pill ' + kind;
  },

  async start() {
    if (!this.configured()) { this.status(''); return; }
    const { url, key } = this.config();
    this.db = window.supabase.createClient(url, key);
    this.status('Conectando…');
    const { data } = await this.db.auth.getSession();
    this.db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && !this.active) this.afterLogin(session.user);
      if (event === 'SIGNED_OUT') location.reload();
    });
    if (data.session) await this.afterLogin(data.session.user);
    else showAuth();
  },

  async afterLogin(user) {
    this.user = user;
    hideAuth();
    const { data: ok, error } = await this.db.rpc('fin_join');
    if (error) return this.fail('Não consegui falar com o Supabase', error);
    if (!ok) {
      showAuth(`O e-mail ${user.email} ainda não tem acesso. Peça para quem já usa adicionar você em Configurações → Quem tem acesso.`);
      this.status('Sem acesso', 'err');
      return;
    }
    const wasLocal = state.tx.length ? JSON.parse(JSON.stringify(state)) : null;
    await this.loadAll();
    this.active = true;
    this.subscribe();
    render();
    this.status('☁ Sincronizado', 'ok');

    // Primeira vez na nuvem com dados só neste navegador: oferece enviar.
    if (wasLocal && !state.tx.length &&
      confirm(`Encontrei ${wasLocal.tx.length} lançamentos salvos só neste navegador. Enviar para a nuvem?`)) {
      state = Object.assign(DEFAULT_STATE(), wasLocal);
      await this.replaceAll();
      render();
    }
  },

  async loadAll() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from('fin_transactions').select('*')
        .order('date').range(from, from + 999);
      if (error) return this.fail('Erro ao carregar lançamentos', error);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const { data: set, error } = await this.db.from('fin_settings').select('*').eq('id', 1).maybeSingle();
    if (error) return this.fail('Erro ao carregar configurações', error);

    const fresh = DEFAULT_STATE();
    if (set) {
      if (set.people?.length) fresh.people = set.people;
      if (Array.isArray(set.cards)) fresh.cards = set.cards;
      if (set.categories?.saida) fresh.categories = set.categories;
    }
    fresh.tx = rows.map(fromRow);
    state = fresh;
    if (!set) await this.saveSettings();
  },

  subscribe() {
    if (this.channel) this.db.removeChannel(this.channel);
    this.channel = this.db.channel('financas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_transactions' }, p => {
        if (p.eventType === 'DELETE') {
          state.tx = state.tx.filter(t => t.id !== p.old.id);
        } else {
          const incoming = fromRow(p.new);
          const cur = state.tx.find(t => t.id === incoming.id);
          if (cur) { for (const k of Object.keys(cur)) delete cur[k]; Object.assign(cur, incoming); } else state.tx.push(incoming);
        }
        render();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_settings' }, p => {
        if (!p.new) return;
        state.people = p.new.people;
        state.cards = p.new.cards;
        state.categories = p.new.categories;
        render();
      })
      .subscribe(s => {
        if (s === 'SUBSCRIBED') this.status('☁ Sincronizado', 'ok');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') this.status('Sem conexão em tempo real', 'warn');
      });

    // Ao voltar para a aba, busca tudo de novo (cobre o celular que ficou dormindo).
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && this.active) { await this.loadAll(); render(); }
    });
  },

  async run(label, fn) {
    if (!this.active) return true;
    this.status('Salvando…');
    const { error } = await fn();
    if (error) { this.fail(label, error); return false; }
    this.status('☁ Sincronizado', 'ok');
    return true;
  },

  putTx(t) {
    return this.run('Não consegui salvar o lançamento', () =>
      this.db.from('fin_transactions').upsert(toRow(t)));
  },

  delTx(id) {
    return this.run('Não consegui excluir o lançamento', () =>
      this.db.from('fin_transactions').delete().eq('id', id));
  },

  saveSettings() {
    return this.run('Não consegui salvar as configurações', () =>
      this.db.from('fin_settings').upsert({
        id: 1, people: state.people, cards: state.cards, categories: state.categories,
        updated_at: new Date().toISOString(),
      }));
  },

  // Substitui tudo na nuvem pelo que está em `state` (importar, exemplo, apagar tudo).
  async replaceAll() {
    if (!this.active) return true;
    const ok = await this.run('Não consegui apagar os dados antigos', () =>
      this.db.from('fin_transactions').delete().neq('id', ''));
    if (!ok) return false;
    const rows = state.tx.map(toRow);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      if (!await this.run('Não consegui enviar os lançamentos', () =>
        this.db.from('fin_transactions').upsert(chunk))) return false;
    }
    return this.saveSettings();
  },

  async members() {
    const { data, error } = await this.db.from('fin_members').select('email').order('added_at');
    if (error) { this.fail('Erro ao listar quem tem acesso', error); return []; }
    return data.map(r => r.email);
  },

  addMember(email) {
    return this.run('Não consegui dar acesso', () =>
      this.db.from('fin_members').insert({ email: email.trim().toLowerCase() }));
  },

  removeMember(email) {
    return this.run('Não consegui remover o acesso', () =>
      this.db.from('fin_members').delete().eq('email', email));
  },

  signOut() { return this.db.auth.signOut(); },

  fail(msg, error) {
    console.error(msg, error);
    this.status('⚠ Erro ao sincronizar', 'err');
    alert(`${msg}: ${error.message || error}`);
    return false;
  },
};

function toRow(t) {
  return {
    id: t.id,
    type: t.type,
    description: t.desc,
    amount: t.amount,
    date: t.date,
    category: t.category,
    person: t.person,
    method: t.method || null,
    card_id: t.cardId || null,
    installments: t.installments || 1,
    recurring: !!t.recurring,
    end_month: t.endMonth || null,
    updated_at: new Date().toISOString(),
  };
}

function fromRow(r) {
  const t = {
    id: r.id,
    type: r.type,
    desc: r.description,
    amount: Number(r.amount),
    date: r.date,
    category: r.category,
    person: r.person,
    method: r.method,
    cardId: r.card_id,
    installments: r.installments || 1,
    recurring: !!r.recurring,
  };
  if (r.end_month) t.endMonth = r.end_month;
  return t;
}

/* ------------------------------------------------------------------ *
 * Tela de login
 * ------------------------------------------------------------------ */

function showAuth(message = '') {
  const el = document.getElementById('authScreen');
  el.hidden = false;
  document.getElementById('authMsg').textContent = message;
  cloud.status('Entre para sincronizar', 'warn');
}
function hideAuth() { document.getElementById('authScreen').hidden = true; }

document.getElementById('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const mode = e.submitter?.value || 'login';
  const email = form.email.value.trim();
  const password = form.password.value;
  const msg = document.getElementById('authMsg');
  msg.textContent = mode === 'login' ? 'Entrando…' : 'Criando conta…';
  if (mode === 'login') {
    const { error } = await cloud.db.auth.signInWithPassword({ email, password });
    if (error) msg.textContent = error.message === 'Invalid login credentials'
      ? 'E-mail ou senha incorretos.' : `Erro: ${error.message}`;
  } else {
    const { data, error } = await cloud.db.auth.signUp({
      email, password, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) msg.textContent = `Erro: ${error.message}`;
    else if (!data.session) msg.textContent = 'Conta criada! Confirme pelo link que chegou no seu e-mail e depois entre aqui.';
  }
});

document.getElementById('authLocal').onclick = () => { hideAuth(); cloud.status('Só neste navegador', 'warn'); };

cloud.start();
