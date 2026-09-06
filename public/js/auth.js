const TOKEN_KEY = 'duofinance_token';
const USER_KEY = 'duofinance_user';

export function session() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    return { token, user: JSON.parse(localStorage.getItem(USER_KEY) || '{}'), demo: token === 'demo' };
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function requireSession() {
  const current = session();
  if (!current) window.location.replace('/login');
  return current;
}
