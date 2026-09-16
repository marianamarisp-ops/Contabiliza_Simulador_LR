/* Gate de acesso: e-mail + chave liberada via Cakto / admin */
(function () {
  'use strict';

  var TOKEN_KEY = 'contabiliza_session';

  function $(id) { return document.getElementById(id); }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token || ''); } catch (e) {}
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = 'Bearer ' + options.token;
    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function showApp(user) {
    var gate = $('authGate');
    var app = $('appRoot');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    var chip = $('authUserChip');
    if (chip) {
      chip.hidden = false;
      chip.textContent = (user && user.email) ? user.email : 'Acesso liberado';
    }
  }

  function showGate(msg) {
    var gate = $('authGate');
    var app = $('appRoot');
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    var chip = $('authUserChip');
    if (chip) chip.hidden = true;
    if (msg) {
      var err = $('authError');
      if (err) {
        err.hidden = false;
        err.textContent = msg;
      }
    }
  }

  function logout() {
    clearToken();
    showGate('');
    var err = $('authError');
    if (err) err.hidden = true;
  }

  function boot() {
    var logoutBtn = $('authLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    var form = $('authForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = ($('authEmail') || {}).value || '';
        var accessKey = ($('authKey') || {}).value || '';
        var btn = $('authSubmit');
        var err = $('authError');
        if (err) { err.hidden = true; err.textContent = ''; }
        if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
        api('/api/auth/login', {
          method: 'POST',
          body: { email: email, accessKey: accessKey }
        }).then(function (r) {
          if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
          if (!r.data || !r.data.ok) {
            showGate((r.data && r.data.error) || 'Não foi possível entrar.');
            return;
          }
          setToken(r.data.token);
          showApp(r.data.user);
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
          showGate('Falha de conexão com o servidor. Confirme se o app está no ar.');
        });
      });
    }

    var token = getToken();
    if (!token) {
      showGate('');
      return;
    }

    api('/api/auth/me', { token: token }).then(function (r) {
      if (r.data && r.data.ok) showApp(r.data.user);
      else {
        clearToken();
        showGate('');
      }
    }).catch(function () {
      // Se a API não responder, mantém o gate (não libera o produto offline)
      clearToken();
      showGate('Servidor indisponível. Tente novamente em instantes.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
