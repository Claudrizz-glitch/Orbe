'use client';

import { RequestError } from './api';
import type { Attachment, Channel } from '../types';

export const MAX_FILE = 25 * 1024 * 1024;
const CHUNK = 3 * 1024 * 1024; // abaixo do limite de ~4,5 MB por requisição da Vercel

/** Dimensões de uma imagem (para reservar espaço na tela antes de carregar). */
async function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  if (!file.type.startsWith('image/') || file.type.includes('svg')) return null;
  try {
    const bmp = await createImageBitmap(file);
    const r = { w: bmp.width, h: bmp.height };
    bmp.close();
    return r;
  } catch { return null; }
}

/**
 * Envia um arquivo como anexo de uma mensagem, em partes de 3 MB.
 * onProgress recebe de 0 a 1. Lança RequestError com mensagem legível em caso de falha.
 */
export async function uploadAttachment(messageId: string, file: File, onProgress?: (p: number) => void): Promise<Attachment> {
  if (file.size > MAX_FILE) throw new RequestError(413, `“${file.name}” passa de 25 MB.`);
  if (!file.size) throw new RequestError(400, `“${file.name}” está vazio.`);
  const upload = crypto.randomUUID();
  const parts = Math.max(1, Math.ceil(file.size / CHUNK));
  const dims = await imageSize(file);
  let result: Attachment | null = null;

  for (let part = 0; part < parts; part++) {
    const blob = file.slice(part * CHUNK, Math.min(file.size, (part + 1) * CHUNK));
    const q = new URLSearchParams({
      upload, name: file.name, type: file.type || 'application/octet-stream',
      size: String(file.size), part: String(part), parts: String(parts),
      ...(dims ? { w: String(dims.w), h: String(dims.h) } : {}),
    });
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(`/api/messages/${messageId}/attachments?${q}`, {
          method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin',
        });
        if (res.status < 500) break;
      } catch { res = null; }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    if (!res) throw new RequestError(0, 'Sem conexão durante o envio do arquivo.');
    if (res.status === 401) { window.location.href = '/login'; throw new RequestError(401, 'Sessão expirada.'); }
    const data = await res.json().catch(() => null) as { error?: string; attachment?: Attachment } | null;
    if (!res.ok) throw new RequestError(res.status, data?.error ?? `Falha ao enviar “${file.name}”.`);
    if (data?.attachment) result = data.attachment;
    onProgress?.((part + 1) / parts);
  }
  if (!result) throw new RequestError(500, `O servidor não confirmou “${file.name}”.`);
  return result;
}

/** Envia o HTML de um canal-página (texto editado ou arquivo), em partes. */
export async function uploadPage(channelId: string, html: Blob, onProgress?: (p: number) => void): Promise<Channel> {
  if (html.size > MAX_FILE) throw new RequestError(413, 'A página passa de 25 MB.');
  if (!html.size) throw new RequestError(400, 'A página está vazia.');
  const upload = crypto.randomUUID();
  const parts = Math.max(1, Math.ceil(html.size / CHUNK));
  let channel: Channel | null = null;
  for (let part = 0; part < parts; part++) {
    const q = new URLSearchParams({ upload, size: String(html.size), part: String(part), parts: String(parts) });
    const res = await fetch(`/api/channels/${channelId}/page?${q}`, {
      method: 'POST', body: html.slice(part * CHUNK, Math.min(html.size, (part + 1) * CHUNK)),
      headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin',
    }).catch(() => null);
    if (!res) throw new RequestError(0, 'Sem conexão durante o envio da página.');
    if (res.status === 401) { window.location.href = '/login'; throw new RequestError(401, 'Sessão expirada.'); }
    const data = await res.json().catch(() => null) as { error?: string; channel?: Channel } | null;
    if (!res.ok) throw new RequestError(res.status, data?.error ?? 'Falha ao salvar a página.');
    if (data?.channel) channel = data.channel;
    onProgress?.((part + 1) / parts);
  }
  if (!channel) throw new RequestError(500, 'O servidor não confirmou a página.');
  return channel;
}

export function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
