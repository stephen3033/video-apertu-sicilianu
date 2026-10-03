import { startRuntime } from './runtime.mjs';
const runtime = await startRuntime({ test: process.argv.includes('--test') });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await runtime.stop(); process.exit(0); });
