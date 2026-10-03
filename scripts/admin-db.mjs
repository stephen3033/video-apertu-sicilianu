// D1 REST prepared statements for migration/direct administration only.
export function adminDatabase(config) {
  const token = process.env.CLOUDFLARE_DATABASE_ADMIN_TOKEN;
  if (!token || token.startsWith('op://'))
    throw new Error('Resolve the database administration token with op run');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${config.d1_databases[0].database_id}/query`;
  async function query(statement) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(statement),
    });
    if (!response.ok) throw new Error(`D1 administration HTTP ${response.status}`);
    const data = await response.json();
    if (!data.success || data.result.some((r) => !r.success))
      throw new Error('D1 administration query failed');
    return data.result;
  }
  return {
    batch: (statements) => query({ batch: statements.map((s) => s.statement) }),
    prepare(sql) {
      return {
        bind(...params) {
          const statement = { sql, params };
          return {
            statement,
            run: async () => (await query(statement))[0],
            all: async () => (await query(statement))[0],
            first: async () => (await query(statement))[0].results[0] || null,
          };
        },
      };
    },
  };
}
