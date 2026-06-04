'use strict';

const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false,
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
