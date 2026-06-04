// src/services/api.js
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

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

export const authAPI = {
  login:      (email, password) => api.post('/auth/login',  { email, password }),
  signup:     (email, password) => api.post('/auth/signup', { email, password }),
  googleAuth:      (credential)       => api.post('/auth/google', { credential }),
  forgotPassword:  (email)             => api.post('/auth/forgot-password', { email }),
  resetPassword:   (token, password)   => api.post('/auth/reset-password', { token, password }),
  submitFeedback:  (data)              => api.post('/feedback', data),
};

export const backtestAPI = {
  run:      (params)             => api.post('/backtest', params),
  getRuns:  (symbol, limit = 10) => {
    const params = { limit };
    if (symbol) params.symbol = symbol;
    return api.get('/backtest/runs', { params });
  },
  getTrades: (runId) => api.get(`/backtest/runs/${runId}/trades`),
};

export const signalAPI = {
  get:      (symbol, strategy = 'AGGREGATED') =>
    api.get(`/signal/${symbol}`, { params: { strategy } }),
  history:  (symbol, limit = 50) =>
    api.get(`/signal/history/${symbol}`, { params: { limit } }),
  describe: () => api.get('/signal/describe'),
};

export const tradeAPI = {
  getOrders:    (limit = 50) => api.get('/trade/orders', { params: { limit } }),
  getPortfolio: ()           => api.get('/trade/portfolio'),
  placeOrder:   (body)       => api.post('/trade/order', body),
};

export const tradeJournalAPI = {
  list:      (params = {}) => api.get('/trade-journal', { params }),
  create:    (body)        => api.post('/trade-journal', body),
  update:    (id, body)    => api.put(`/trade-journal/${id}`, body),
  remove:    (id)          => api.delete(`/trade-journal/${id}`),
  analytics: ()            => api.get('/trade-journal/analytics'),
};

export const screenerAPI = {
  run:   (params = {}) => api.get('/screener',          { params }),
  score: (symbol)      => api.get(`/screener/score/${symbol}`),
};

export const simAPI = {
  // Simulation engine
  getSignals:   (symbols) => api.get('/sim/signals', {
    params: symbols?.length ? { symbols: symbols.join(',') } : {},
  }),
  getEquity:    ()        => api.get('/sim/equity'),
  getTrades:    (limit)   => api.get('/sim/trades', { params: { limit: limit || 50 } }),
  getStatus:    ()        => api.get('/sim/status'),
  startEngine:  (opts)    => api.post('/sim/engine/start',    opts || {}),
  stopEngine:   ()        => api.post('/sim/engine/stop'),
  addSymbol:    (symbol)  => api.post('/sim/watchlist/add',    { symbol }),
  removeSymbol: (symbol)  => api.post('/sim/watchlist/remove', { symbol }),

  // Manual portfolio — user-defined capital
  getPortfolio: ()        => api.get('/sim/portfolio'),
  start:        (capital) => api.post('/sim/start', { capital }),
  reset:        ()        => api.post('/sim/reset'),
  exitAll:      ()        => api.post('/sim/exit-all'),
  exitOne:      (symbol)  => api.post('/sim/exit-one', { symbol }),
};

export const marketAPI = {
  getQuote:  (symbol) => api.get(`/data/quote/${symbol}`),
  getHealth: ()       => api.get('/data/health'),
};

export const manualTradeAPI = {
  place: (symbol, action, qty) =>
    api.post('/trade/manual', { symbol, action, qty }),
};

export default api;

// ── Live trading API ──────────────────────────────────────────────────────────
export const liveAPI = {
  status:      ()           => api.get('/live/status'),
  setMode:     (mode)       => api.post('/live/mode', { mode }),
  placeOrder:  (body)       => api.post('/live/order', body),
  cancelOrder: (id)         => api.delete(`/live/order/${id}`),
  positions:   ()           => api.get('/live/positions'),
  orders:      ()           => api.get('/live/orders'),
  funds:       ()           => api.get('/live/funds'),
};
