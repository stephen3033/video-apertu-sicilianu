// A second origin emulates browser-to-R2 transport in local/browser tests only.
import http from 'node:http';
const server = http.createServer((request, response) => {
  if (!request.url.startsWith('/__local/uploads/')) {
    response.writeHead(404).end();
    return;
  }
  const upstream = http.request(
    {
      hostname: 'localhost',
      port: 8787,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: 'localhost:8787' },
    },
    (res) => {
      response.writeHead(res.statusCode, res.headers);
      res.pipe(response);
    },
  );
  upstream.on('error', () => response.writeHead(502).end());
  request.pipe(upstream);
});
server.listen(8788, 'localhost');
