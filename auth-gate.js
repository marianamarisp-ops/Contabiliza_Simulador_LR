/* Gate de acesso: e-mail + chave liberada via Cakto / admin */
(function () {
  'use strict';

  var TOKEN_KEY = 'contabiliza_session';
  var CREDS_KEY = 'contabiliza_saved_creds';

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

  function getSavedCreds() {
    try {
      var raw = localStorage.getItem(CREDS_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.email || !data.accessKey) return null;
      return {
        email: String(data.email).trim().toLowerCase(),
        accessKey: String(data.accessKey).trim()
      };
    } catch (e) {
      return null;
    }
  }

  function setSavedCreds(email, accessKey) {
    try {
      localStorage.setItem(CREDS_KEY, JSON.stringify({
        email: String(email || '').trim().toLowerCase(),
        accessKey: String(accessKey || '').trim()
      }));
    } catch (e) {}
  }

  function clearSavedCreds() {
    try { localStorage.removeItem(CREDS_KEY); } catch (e) {}
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

  function setLoginMode(on) {
    var gate = $('authGate');
    var back = $('authBackProduct');
    if (gate) gate.classList.toggle('is-login', !!on);
    if (back) back.hidden = !on;
    if (on) {
      showContact(false);
      syncLoginForm();
      var email = $('authEmail');
      if (email) email.focus();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    }
  }

  function syncLoginForm() {
    var creds = getSavedCreds();
    var title = $('authTitle');
    var lead = $('authLead');
    var label = $('authKeyLabel');
    var hint = $('authKeyHint');
    var switchBtn = $('authSwitchAccount');
    var emailInput = $('authEmail');
    var keyInput = $('authKey');
    var buy = document.querySelector('#authLoginCard .auth-buy');

    if (creds) {
      if (title) title.textContent = 'Entrar no simulador';
      if (lead) {
        lead.innerHTML = 'Acesso já liberado neste aparelho. Use o <b>e-mail</b> e a <b>senha</b> salvos — sem precisar digitar a chave de novo.';
      }
      if (label) label.textContent = 'Senha';
      if (hint) {
        hint.textContent = 'É a mesma chave de acesso enviada após o pagamento, guardada neste navegador.';
      }
      if (emailInput && !emailInput.value) emailInput.value = creds.email;
      if (keyInput) {
        keyInput.value = creds.accessKey;
        keyInput.placeholder = '••••••••••••••••';
        keyInput.required = true;
      }
      if (switchBtn) switchBtn.hidden = false;
      if (buy) buy.hidden = true;
    } else {
      if (title) title.textContent = 'Acesso ao simulador';
      if (lead) {
        lead.innerHTML = 'Já comprou? Entre com o <b>mesmo e-mail da compra na Cakto</b> e a <b>chave de acesso</b> enviada após o pagamento. Na próxima vez, neste aparelho, e-mail e senha bastam.';
      }
      if (label) label.textContent = 'Chave de acesso';
      if (hint) {
        hint.textContent = 'Use a chave recebida por e-mail. Depois da primeira entrada, ela vira sua senha neste aparelho.';
      }
      if (keyInput) {
        keyInput.placeholder = 'CONT-XXXX-XXXX-XXXX';
        keyInput.required = true;
      }
      if (switchBtn) switchBtn.hidden = true;
      if (buy) buy.hidden = false;
    }
  }

  function showApp(user) {
    var gate = $('authGate');
    var app = $('appRoot');
    if (gate) {
      gate.hidden = true;
      gate.classList.remove('is-login');
    }
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
    showContact(false);
    syncLoginForm();
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
    setLoginMode(true);
    var err = $('authError');
    if (err) err.hidden = true;
  }

  function showContact(open) {
    var loginCard = $('authLoginCard');
    var contactCard = $('authContactCard');
    if (loginCard) loginCard.hidden = !!open;
    if (contactCard) contactCard.hidden = !open;
    var err = $('contactError');
    var ok = $('contactOk');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (ok) { ok.hidden = true; ok.textContent = ''; }
    if (open) {
      var loginEmail = ($('authEmail') || {}).value || '';
      var contactEmail = $('contactEmail');
      if (contactEmail && !contactEmail.value && loginEmail) contactEmail.value = loginEmail;
      var nameField = $('contactName');
      if (nameField) nameField.focus();
    }
  }

  function boot() {
    var logoutBtn = $('authLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    var goLogin = $('authGoLogin');
    if (goLogin) {
      goLogin.addEventListener('click', function () {
        setLoginMode(true);
      });
    }

    var backProduct = $('authBackProduct');
    if (backProduct) {
      backProduct.addEventListener('click', function () {
        setLoginMode(false);
        var err = $('authError');
        if (err) { err.hidden = true; err.textContent = ''; }
      });
    }

    var switchAccount = $('authSwitchAccount');
    if (switchAccount) {
      switchAccount.addEventListener('click', function () {
        clearSavedCreds();
        var emailInput = $('authEmail');
        var keyInput = $('authKey');
        if (emailInput) emailInput.value = '';
        if (keyInput) keyInput.value = '';
        syncLoginForm();
        if (emailInput) emailInput.focus();
      });
    }

    var contactOpen = $('authContactOpen');
    var contactBack = $('contactBack');
    if (contactOpen) contactOpen.addEventListener('click', function () { showContact(true); });
    if (contactBack) contactBack.addEventListener('click', function () { showContact(false); });

    var contactForm = $('contactForm');
    if (contactForm) {
      contactForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = $('contactSubmit');
        var err = $('contactError');
        var ok = $('contactOk');
        if (err) { err.hidden = true; err.textContent = ''; }
        if (ok) { ok.hidden = true; ok.textContent = ''; }
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
        api('/api/contact', {
          method: 'POST',
          body: {
            name: ($('contactName') || {}).value || '',
            email: ($('contactEmail') || {}).value || '',
            subject: ($('contactSubject') || {}).value || '',
            message: ($('contactMessage') || {}).value || '',
            website: ($('contactWebsite') || {}).value || ''
          }
        }).then(function (r) {
          if (btn) { btn.disabled = false; btn.textContent = 'Enviar mensagem'; }
          if (!r.data || !r.data.ok) {
            if (err) {
              err.hidden = false;
              err.textContent = (r.data && r.data.error) || 'Não foi possível enviar a mensagem.';
            }
            return;
          }
          if (ok) {
            ok.hidden = false;
            ok.textContent = 'Mensagem enviada. Em breve o suporte Contabiliza responde no e-mail informado.';
          }
          contactForm.reset();
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Enviar mensagem'; }
          if (err) {
            err.hidden = false;
            err.textContent = 'Falha de conexão com o servidor. Tente novamente em instantes.';
          }
        });
      });
    }

    var keyInput = $('authKey');
    var keyToggle = $('authKeyToggle');
    if (keyInput && keyToggle) {
      keyToggle.addEventListener('click', function () {
        var showing = keyInput.type === 'text';
        keyInput.type = showing ? 'password' : 'text';
        keyToggle.textContent = showing ? 'Mostrar' : 'Ocultar';
        keyToggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
        keyToggle.setAttribute('aria-label', showing ? 'Mostrar chave de acesso' : 'Ocultar chave de acesso');
        keyInput.focus();
      });
    }

    var form = $('authForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = ($('authEmail') || {}).value || '';
        var accessKey = ($('authKey') || {}).value || '';
        var saved = getSavedCreds();
        if ((!accessKey || !String(accessKey).trim()) && saved && saved.accessKey) {
          accessKey = saved.accessKey;
        }
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
            setLoginMode(true);
            return;
          }
          setToken(r.data.token);
          setSavedCreds(email, accessKey);
          showApp(r.data.user);
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
          showGate('Falha de conexão com o servidor. Confirme se o app está no ar.');
          setLoginMode(true);
        });
      });
    }

    syncLoginForm();

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
