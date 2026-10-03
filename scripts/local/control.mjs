const [command, value, extra] = process.argv.slice(2);
const origin = 'http://localhost:8788';
const routes = {
  reviewer: `/reviewer?email=${encodeURIComponent(value || '')}&enabled=${extra !== '--revoke'}`,
  recover: `/recover?due=${value === '--due'}`,
  capacity: `/capacity?enabled=${value !== 'off'}`,
  fault: `/archive/fault?mode=${encodeURIComponent(value || 'none')}&count=${Number(extra || 1)}`,
  state: '/state', archive: '/archive',
};
if (!(command in routes)) throw new Error('Usage: npm run local -- reviewer EMAIL [--revoke] | recover [--due] | capacity on/off | fault none/throttle/lost-ack [COUNT] | state | archive');
const response = await fetch(origin + routes[command], { method: ['state', 'archive'].includes(command) ? 'GET' : 'POST', headers: { 'X-VAS-Local-Control': '1' } });
if (!response.ok) throw new Error(`Local command failed: ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
