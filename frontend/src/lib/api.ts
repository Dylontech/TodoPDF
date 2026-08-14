/**
 * Cliente de API de TodoPDF.
 * Incluye automáticamente las cookies de sesión (credentials: include)
 * para el flujo autenticado.
 */

const API = '/api';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

/** URL de descarga de una conversión guardada (flujo autenticado). */
export const downloadUrl = (id: number): string => `${API}/convert/${id}/download`;
