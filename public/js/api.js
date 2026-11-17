// Les URLs sont calculées depuis l'emplacement de ce module et non depuis la page : elles restent
// valables sous l'ingress de Home Assistant (/api/hassio_ingress/<jeton>/), avec ou sans « / » final.
const BASE = new URL('../api/', import.meta.url);

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(new URL(path, BASE), {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Serveur injoignable. Vérifiez que l’application est démarrée.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.erreur || `Erreur ${res.status}`, res.status, data);
  return data;
}

export const api = {
  get: (p) => call('GET', p),
  post: (p, b = {}) => call('POST', p, b),
  put: (p, b) => call('PUT', p, b),
  patch: (p, b) => call('PATCH', p, b),
  del: (p) => call('DELETE', p),
};
