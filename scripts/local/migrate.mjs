import { startRuntime } from './runtime.mjs';
const runtime = await startRuntime({ watchFiles: false });
await runtime.stop();
console.log('Local migrations are up to date.');
