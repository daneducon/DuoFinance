import { saveSession, session } from './auth.js';

if (session()) window.location.replace('/');

const errorElement = document.querySelector('#login-error');
document.querySelector('#demo-button').addEventListener('click', () => {
  saveSession('demo', { name: 'Danilo & Talyta', email: 'Modo demonstração' });
  window.location.assign('/');
});

initializeGoogle();

async function initializeGoogle() {
  try {
    const config = await fetch('/api/config').then((response) => response.json());
    if (!config.googleClientId) {
      document.querySelector('#google-button').innerHTML = '<button class="button google-fallback" disabled>Google não configurado</button>';
      return;
    }
    await loadScript('https://accounts.google.com/gsi/client');
    google.accounts.id.initialize({ client_id: config.googleClientId, callback: authenticate });
    google.accounts.id.renderButton(document.querySelector('#google-button'), { theme: 'filled_black', size: 'large', width: 370, text: 'continue_with', shape: 'rectangular' });
  } catch {
    errorElement.textContent = 'Não foi possível carregar o login do Google.';
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

async function authenticate(response) {
  errorElement.textContent = '';
  try {
    const validation = await fetch('/api/auth', { method: 'POST', headers: { Authorization: `Bearer ${response.credential}` } });
    const body = await validation.json();
    if (!validation.ok) throw new Error(body.error);
    saveSession(response.credential, body.user);
    window.location.assign('/');
  } catch (error) {
    errorElement.textContent = error.message || 'Esta conta não está autorizada.';
  }
}
