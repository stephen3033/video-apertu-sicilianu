export const runtimeSecrets = [
  'AUTH_CODE_SECRET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'IA_ACCESS_KEY',
  'IA_SECRET_KEY',
  'RESEND_API_KEY',
];
export function secretPayload(environment) {
  return Object.fromEntries(
    runtimeSecrets.map((name) => {
      const value = environment[name];
      if (
        !value ||
        value.startsWith('op://') ||
        /REPLACE|placeholder|development-only/i.test(value)
      )
        throw new Error(`Missing resolved runtime secret: ${name}`);
      return [name, value];
    }),
  );
}
