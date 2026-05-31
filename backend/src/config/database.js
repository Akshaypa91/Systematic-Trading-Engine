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
		await client.query('SELECT NOW()');
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

	return [result.rows, result];
}

async function closePool() {
	await pool.end();
}

module.exports = {
	pool,
	query,
	testConnection,
	closePool,
};