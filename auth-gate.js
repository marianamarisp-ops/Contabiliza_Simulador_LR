/* Gate de acesso: 1º login com chave de ativação → cadastro de senha; depois e-mail + senha */
(function () {
  'use strict';

  var TOKEN_KEY = 'contabiliza_session';
  var CREDS_KEY = 'contabiliza_saved_creds';
  var setupToken = '';
  var pendingResetToken = '';

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
      if (!data || !data.email) return null;
      return {
        email: String(data.email).trim().toLowerCase(),
        hasPassword: Boolean(data.hasPassword)
      };
    } catch (e) {
      return null;
    }
  }

  function setSavedCreds(email, hasPassword) {
    try {
      localStorage.setItem(CREDS_KEY, JSON.stringify({
        email: String(email || '').trim().toLowerCase(),
        hasPassword: Boolean(hasPassword)
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

  function bindToggle(inputId, toggleId, showLabel, hideLabel) {
    var input = $(inputId);
    var toggle = $(toggleId);
    if (!input || !toggle) return;
    toggle.addEventListener('click', function () {
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? 'Mostrar' : 'Ocultar';
      toggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
      toggle.setAttribute('aria-label', showing ? showLabel : hideLabel);
      input.focus();
    });
  }

  function hideAllAuthCards() {
    ['authLoginCard', 'authPasswordCard', 'authForgotCard', 'authResetCard', 'authContactCard'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
  }

  function showAuthPanel(panel) {
    hideAllAuthCards();
    var el = $(panel);
    if (el) el.hidden = false;
  }

  function setLoginMode(on, panel) {
    var gate = $('authGate');
    var back = $('authBackProduct');
    var access = document.querySelector('.product-access');
    if (gate) gate.classList.toggle('is-login', !!on);
    if (access) access.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      showAuthPanel(panel || 'authLoginCard');
      var showBack = !panel || panel === 'authLoginCard';
      if (back) back.hidden = !showBack;
      if (!panel || panel === 'authLoginCard') {
        syncLoginForm();
        var email = $('authEmail');
        if (email) email.focus();
      }
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    } else if (back) {
      back.hidden = true;
    }
  }

  function syncLoginForm() {
    var creds = getSavedCreds();
    var title = $('authTitle');
    var lead = $('authLead');
    var label = $('authKeyLabel');
    var hint = $('authKeyHint');
    var switchBtn = $('authSwitchAccount');
    var forgotBtn = $('authForgotOpen');
    var emailInput = $('authEmail');
    var keyInput = $('authKey');
    var buy = document.querySelector('#authLoginCard .auth-buy');
    var returning = Boolean(creds && creds.hasPassword);

    if (returning) {
      if (title) title.textContent = 'Entrar no simulador';
      if (lead) {
        lead.innerHTML = 'Acesso já liberado neste aparelho. Entre com o <b>e-mail</b> e a <b>senha</b> que você cadastrou.';
      }
      if (label) label.textContent = 'Senha';
      if (hint) {
        hint.textContent = 'É a senha criada no primeiro acesso. Se esqueceu, use “Esqueci minha senha”.';
      }
      if (emailInput && !emailInput.value) emailInput.value = creds.email;
      if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = 'Sua senha';
        keyInput.required = true;
        keyInput.setAttribute('autocomplete', 'current-password');
        keyInput.name = 'password';
      }
      if (switchBtn) switchBtn.hidden = false;
      if (forgotBtn) forgotBtn.hidden = false;
      if (buy) buy.hidden = true;
    } else {
      if (title) title.textContent = 'Acesso ao simulador';
      if (lead) {
        lead.innerHTML = 'Já comprou? Entre com o <b>mesmo e-mail da compra na Cakto</b> e a <b>chave de ativação</b> enviada após o pagamento. No primeiro acesso você cadastra sua senha.';
      }
      if (label) label.textContent = 'Chave de ativação';
      if (hint) {
        hint.textContent = 'Use a chave recebida por e-mail. Depois do primeiro login, ela é substituída pela senha que você cadastrar.';
      }
      if (creds && emailInput && !emailInput.value) emailInput.value = creds.email;
      if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = 'CONT-XXXX-XXXX-XXXX';
        keyInput.required = true;
        keyInput.setAttribute('autocomplete', 'one-time-code');
        keyInput.name = 'accessKey';
      }
      if (switchBtn) switchBtn.hidden = true;
      if (forgotBtn) forgotBtn.hidden = false;
      if (buy) buy.hidden = false;
    }
  }

  function showPasswordSetup(email) {
    setLoginMode(true, 'authPasswordCard');
    var err = $('passwordError');
    if (err) { err.hidden = true; err.textContent = ''; }
    var form = $('passwordForm');
    if (form) form.reset();
    var pwd = $('authNewPassword');
    if (pwd) pwd.focus();
    if (email) setSavedCreds(email, false);
  }

  function showForgot() {
    setLoginMode(true, 'authForgotCard');
    var err = $('forgotError');
    var ok = $('forgotOk');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (ok) { ok.hidden = true; ok.textContent = ''; }
    var loginEmail = ($('authEmail') || {}).value || '';
    var forgotEmail = $('forgotEmail');
    if (forgotEmail) {
      if (!forgotEmail.value && loginEmail) forgotEmail.value = loginEmail;
      forgotEmail.focus();
    }
  }

  function showReset(token) {
    pendingResetToken = token || pendingResetToken;
    setLoginMode(true, 'authResetCard');
    var err = $('resetError');
    if (err) { err.hidden = true; err.textContent = ''; }
    var form = $('resetForm');
    if (form) form.reset();
    var pwd = $('resetPassword');
    if (pwd) pwd.focus();
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
    showAuthPanel('authLoginCard');
    syncLoginForm();
    if (msg) {
      setLoginMode(true);
      var err = $('authError');
      if (err) {
        err.hidden = false;
        err.textContent = msg;
      }
    } else {
      setLoginMode(false);
    }
  }

  function logout() {
    clearToken();
    setupToken = '';
    showGate('');
    setLoginMode(true);
    var err = $('authError');
    if (err) { err.hidden = true; err.textContent = ''; }
  }

  function showContact(open) {
    if (open) {
      setLoginMode(true, 'authContactCard');
      var err = $('contactError');
      var ok = $('contactOk');
      if (err) { err.hidden = true; err.textContent = ''; }
      if (ok) { ok.hidden = true; ok.textContent = ''; }
      var loginEmail = ($('authEmail') || {}).value || '';
      var contactEmail = $('contactEmail');
      if (contactEmail && !contactEmail.value && loginEmail) contactEmail.value = loginEmail;
      var nameField = $('contactName');
      if (nameField) nameField.focus();
      return;
    }
    setLoginMode(true, 'authLoginCard');
  }

  function clearResetQuery() {
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has('resetToken')) return;
      url.searchParams.delete('resetToken');
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  function readResetTokenFromUrl() {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get('resetToken') || '';
    } catch (e) {
      return '';
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

    var forgotOpen = $('authForgotOpen');
    if (forgotOpen) forgotOpen.addEventListener('click', showForgot);

    var forgotBack = $('forgotBack');
    if (forgotBack) {
      forgotBack.addEventListener('click', function () {
        setLoginMode(true, 'authLoginCard');
      });
    }

    var resetBack = $('resetBack');
    if (resetBack) {
      resetBack.addEventListener('click', function () {
        pendingResetToken = '';
        clearResetQuery();
        setLoginMode(true, 'authLoginCard');
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

    bindToggle('authKey', 'authKeyToggle', 'Mostrar chave ou senha', 'Ocultar chave ou senha');
    bindToggle('authNewPassword', 'authNewPasswordToggle', 'Mostrar senha', 'Ocultar senha');
    bindToggle('resetPassword', 'resetPasswordToggle', 'Mostrar senha', 'Ocultar senha');

    var form = $('authForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = ($('authEmail') || {}).value || '';
        var credential = ($('authKey') || {}).value || '';
        var btn = $('authSubmit');
        var err = $('authError');
        if (err) { err.hidden = true; err.textContent = ''; }
        if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
        api('/api/auth/login', {
          method: 'POST',
          body: { email: email, password: credential, accessKey: credential }
        }).then(function (r) {
          if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
          if (!r.data || !r.data.ok) {
            showGate((r.data && r.data.error) || 'Não foi possível entrar.');
            setLoginMode(true);
            return;
          }
          if (r.data.needsPasswordSetup) {
            setupToken = r.data.setupToken || '';
            showPasswordSetup(email);
            return;
          }
          setToken(r.data.token);
          setSavedCreds(email, true);
          showApp(r.data.user);
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
          showGate('Falha de conexão com o servidor. Confirme se o app está no ar.');
          setLoginMode(true);
        });
      });
    }

    var passwordForm = $('passwordForm');
    if (passwordForm) {
      passwordForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var password = ($('authNewPassword') || {}).value || '';
        var confirm = ($('authConfirmPassword') || {}).value || '';
        var btn = $('passwordSubmit');
        var err = $('passwordError');
        if (err) { err.hidden = true; err.textContent = ''; }
        if (password !== confirm) {
          if (err) {
            err.hidden = false;
            err.textContent = 'A confirmação da senha não confere.';
          }
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
        api('/api/auth/set-password', {
          method: 'POST',
          body: {
            setupToken: setupToken,
            password: password,
            confirmPassword: confirm
          }
        }).then(function (r) {
          if (btn) { btn.disabled = false; btn.textContent = 'Salvar senha e entrar'; }
          if (!r.data || !r.data.ok) {
            if (err) {
              err.hidden = false;
              err.textContent = (r.data && r.data.error) || 'Não foi possível salvar a senha.';
            }
            return;
          }
          setupToken = '';
          setToken(r.data.token);
          setSavedCreds((r.data.user && r.data.user.email) || '', true);
          showApp(r.data.user);
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Salvar senha e entrar'; }
          if (err) {
            err.hidden = false;
            err.textContent = 'Falha de conexão com o servidor. Tente novamente.';
          }
        });
      });
    }

    var forgotForm = $('forgotForm');
    if (forgotForm) {
      forgotForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = $('forgotSubmit');
        var err = $('forgotError');
        var ok = $('forgotOk');
        if (err) { err.hidden = true; err.textContent = ''; }
        if (ok) { ok.hidden = true; ok.textContent = ''; }
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
        api('/api/auth/forgot-password', {
          method: 'POST',
          body: { email: ($('forgotEmail') || {}).value || '' }
        }).then(function (r) {
          if (btn) { btn.disabled = false; btn.textContent = 'Enviar link'; }
          if (!r.data || !r.data.ok) {
            if (err) {
              err.hidden = false;
              err.textContent = (r.data && r.data.error) || 'Não foi possível enviar o e-mail.';
            }
            return;
          }
          if (ok) {
            ok.hidden = false;
            ok.textContent = r.data.message || 'Se este e-mail tiver acesso, você receberá orientações em instantes.';
          }
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Enviar link'; }
          if (err) {
            err.hidden = false;
            err.textContent = 'Falha de conexão com o servidor. Tente novamente.';
          }
        });
      });
    }

    var resetForm = $('resetForm');
    if (resetForm) {
      resetForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var password = ($('resetPassword') || {}).value || '';
        var confirm = ($('resetConfirmPassword') || {}).value || '';
        var btn = $('resetSubmit');
        var err = $('resetError');
        if (err) { err.hidden = true; err.textContent = ''; }
        if (password !== confirm) {
          if (err) {
            err.hidden = false;
            err.textContent = 'A confirmação da senha não confere.';
          }
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
        api('/api/auth/reset-password', {
          method: 'POST',
          body: {
            token: pendingResetToken,
            password: password,
            confirmPassword: confirm
          }
        }).then(function (r) {
          if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
          if (!r.data || !r.data.ok) {
            if (err) {
              err.hidden = false;
              err.textContent = (r.data && r.data.error) || 'Não foi possível redefinir a senha.';
            }
            return;
          }
          pendingResetToken = '';
          clearResetQuery();
          setToken(r.data.token);
          setSavedCreds((r.data.user && r.data.user.email) || '', true);
          showApp(r.data.user);
        }).catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
          if (err) {
            err.hidden = false;
            err.textContent = 'Falha de conexão com o servidor. Tente novamente.';
          }
        });
      });
    }

    // Migra credenciais antigas (que guardavam a chave) para o novo formato
    try {
      var rawOld = localStorage.getItem(CREDS_KEY);
      if (rawOld) {
        var oldData = JSON.parse(rawOld);
        if (oldData && oldData.email && oldData.accessKey && oldData.hasPassword === undefined) {
          setSavedCreds(oldData.email, false);
        }
      }
    } catch (e) {}

    syncLoginForm();

    var urlReset = readResetTokenFromUrl();
    if (urlReset) {
      clearToken();
      showReset(urlReset);
      return;
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
