require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false,
	},
});

(async () => {
	try {
		const result = await pool.query('SELECT NOW()');
		console.log('CONNECTED');
		console.log(result.rows);
		process.exit(0);
	} catch (err) {
		console.error(err);
		process.exit(1);
	}
})();