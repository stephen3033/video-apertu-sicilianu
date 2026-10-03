export const now = () => Math.floor(Date.now() / 1000);
export const iso = (seconds = now()) => new Date(seconds * 1000).toISOString();
