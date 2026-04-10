import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach JWT
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — auto-logout on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  signup: (email, password) => api.post('/auth/signup', { email, password }),
};

// ── Backtest ──────────────────────────────────────────────────────────────────
export const backtestAPI = {
  run: (params) => api.post('/backtest', params),
  // FIXED — filter out undefined params
  getRuns: (symbol, limit = 10) => {
    const params = { limit };
    if (symbol) params.symbol = symbol;
    return api.get('/backtest/runs', { params });
  },
  getTrades: (runId) => api.get(`/backtest/runs/${runId}/trades`),
};

// ── Signals ───────────────────────────────────────────────────────────────────
export const signalAPI = {
  get: (symbol, strategy = 'AGGREGATED') =>
    api.get(`/signal/${symbol}`, { params: { strategy } }),
  history: (symbol, limit = 50) =>
    api.get(`/signal/history/${symbol}`, { params: { limit } }),
  describe: () => api.get('/signal/describe'),
};

// ── Trades ────────────────────────────────────────────────────────────────────
export const tradeAPI = {
  getOrders: (limit = 50) => api.get('/trade/orders', { params: { limit } }),
  getPortfolio: () => api.get('/trade/portfolio'),
  placeOrder: (body) => api.post('/trade/order', body),
};

// ── Screener ──────────────────────────────────────────────────────────────────
export const screenerAPI = {
  run: (params = {}) => api.get('/screener', { params }),
  score: (symbol) => api.get(`/screener/score/${symbol}`),
};

// ── Simulation Live Trading ───────────────────────────────────────────────────
export const simAPI = {
  getSignals:    (symbols) => api.get('/sim/signals', {
    params: symbols?.length ? { symbols: symbols.join(',') } : {},
  }),
  getPortfolio:  ()       => api.get('/sim/portfolio'),
  getTrades:     (limit)  => api.get('/sim/trades', { params: { limit: limit || 50 } }),
  getEquity:     ()       => api.get('/sim/equity'),
  getStatus:     ()       => api.get('/sim/status'),
  startEngine:   (opts)   => api.post('/sim/engine/start', opts || {}),
  stopEngine:    ()       => api.post('/sim/engine/stop'),
  addSymbol:     (symbol) => api.post('/sim/watchlist/add',    { symbol }),
  removeSymbol:  (symbol) => api.post('/sim/watchlist/remove', { symbol }),
};

export default api;
