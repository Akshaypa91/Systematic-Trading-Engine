'use strict';

const { Pool } = require('pg');
const logger = require('./logger');

// SSL cert validation is off by default (rejectUnauthorized: false), which
// accepts self-signed/unverified certs and is vulnerable to MITM on the DB
// connection. Left as the default here to avoid breaking the existing
// managed-Postgres/CockroachDB connection sight-unseen, but it should be
// set to 'true' in production once the DB host's CA chain is confirmed to
// validate cleanly — see DB_SSL_REJECT_UNAUTHORIZED in .env.example.
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
	},
	max: 10,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000,
});

async function testConnection() {
	const client = await pool.connect();

	try {
		await client.query('SELECT CURRENT_TIMESTAMP');
		logger.info('[DB] CockroachDB connected');
		return true;
	} finally {
		client.release();
	}
}

function convertPlaceholders(sql) {
	let i = 0;
	return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
	sql = convertPlaceholders(sql);
	const result = await pool.query(sql, params);
	result.affectedRows = result.rowCount;
	return [result.rows, result];
}

async function closePool() {
	await pool.end();
}

async function transaction(callback) {
	const client = await pool.connect();

	try {
		await client.query('BEGIN');

		const tx = {
			query: async (sql, params = []) => {
				sql = convertPlaceholders(sql);
				const result = await client.query(sql, params);
				result.affectedRows = result.rowCount;
				return [result.rows, result];
			},
		};

		const result = await callback(tx);

		await client.query('COMMIT');

		return result;
	} catch (err) {
		try {
			await client.query('ROLLBACK');
		} catch (rollbackErr) {
			logger.error(`[DB] Rollback failed: ${rollbackErr.message}`);
		}
		throw err;
	} finally {
		client.release();
	}
}

module.exports = {
	pool,
	query,
	transaction,
	testConnection,
	closePool,
};
