// app/main/db.js
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// 1) URL de conexión
// Prioridad: PG_URL > DATABASE_URL > (fallback con tus credenciales conocidas)
const CONNECTION_STRING =
  process.env.PG_URL ||
  process.env.DATABASE_URL ||
  'postgres://hunter23:Phix6021@100.120.164.101:5433/imprenta_db?sslmode=prefer';

// 2) Pool de conexiones
export const pool = new Pool({
  connectionString: CONNECTION_STRING,
  max: 10,                  // conexiones simultáneas
  idleTimeoutMillis: 10_000, // cierra conex inactivas
  connectionTimeoutMillis: 10_000, // tiempo máx para conectar
  // Nota: ssl se controla con la querystring (sslmode=prefer) en la URL
});

// 3) Log de errores del pool (evita que el proceso muera silenciosamente)
pool.on('error', (err) => {
  console.error('[DB] Error inesperado en el pool:', err);
});

// 4) Helper simple de consultas (auto acquire/release)
export async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// 5) Ejecutar una transacción con callback
//    Uso:
//    const result = await runTransaction(async (tx) => {
//      const r1 = await tx.query('INSERT ... RETURNING id', [..]);
//      const r2 = await tx.query('UPDATE ... WHERE id=$1', [r1.rows[0].id]);
//      return { id: r1.rows[0].id };
//    });
export async function runTransaction(workFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await workFn({
      query: (text, params) => client.query(text, params),
      client,
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// 6) Obtener un cliente manualmente (para lotes o cursores grandes)
//    Recuerda SIEMPRE liberar con `release()` cuando termines.
export async function getClient() {
  return pool.connect();
}

// 7) Cierre ordenado del pool (útil al salir de Electron)
export async function closePool() {
  await pool.end();
}

// 8) Chequeo de salud (opcional)
export async function healthCheck() {
  try {
    const r = await query('select current_database() as db, current_user as usr, now() as ts');
    return { ok: true, info: r.rows[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 9) Log de conexión (una sola vez, no bloqueante)
(async () => {
  try {
    const r = await query('select current_database() as db, current_user as usr');
    console.log(`[DB] Conectado a ${r.rows[0].db} como ${r.rows[0].usr}`);
  } catch (err) {
    console.error('[DB] No se pudo verificar la conexión inicial:', err.message);
  }
})();
