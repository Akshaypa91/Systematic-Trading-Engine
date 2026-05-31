CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email STRING UNIQUE NOT NULL,
    password STRING NOT NULL,
    name STRING,
    role STRING NOT NULL DEFAULT 'user',
    provider STRING DEFAULT 'local',
    picture STRING,
    trading_mode STRING DEFAULT 'paper',
    is_active BOOL DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolios (
    id SERIAL PRIMARY KEY,
    user_id INT,
    initial_capital DECIMAL(16,2) NOT NULL,
    current_capital DECIMAL(16,2) NOT NULL,
    status STRING NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
    user_id INT PRIMARY KEY,
    token STRING NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    user_id INT,
    name STRING,
    email STRING,
    type STRING DEFAULT 'general',
    message STRING NOT NULL,
    rating INT,
    created_at TIMESTAMP DEFAULT now()
);