// src/middleware/rbac.js
'use strict';
const PERMISSIONS = {
  admin: ['*'],
  user: ['trade:read','trade:write','backtest:run','backtest:read','signal:read','screener:read','live:read','live:write','feedback:write'],
};
function requirePermission(permission) {
  return (req, res, next) => {
    const role  = req.user?.role || 'user';
    const perms = PERMISSIONS[role] || [];
    if (perms.includes('*') || perms.includes(permission)) return next();
    return res.status(403).json({ success:false, error:'Insufficient permissions', required:permission });
  };
}
function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ success:false, error:'Admin only' });
}
module.exports = { requirePermission, requireAdmin, PERMISSIONS };
