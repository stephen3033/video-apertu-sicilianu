export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (n) => n.toString(16).padStart(2, '0')).join('');
export const sha256 = async (v: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
export async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}
export function loginCode() {
  const a = new Uint32Array(1);
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= 4_294_000_000);
  return (a[0] % 1_000_000).toString().padStart(6, '0');
}
