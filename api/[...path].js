'use strict';
// Điểm vào duy nhất của Vercel cho mọi đường dẫn /api/*
const { createHandler } = require('../lib/router');
const { createService } = require('../lib/service');
const { getDb, getAuth } = require('../lib/firebase');

let handler;
module.exports = (req, res) => {
  if (!handler) {
    try {
      handler = createHandler({
        svc: createService(getDb()),
        verify: (token) => getAuth().verifyIdToken(token),
      });
    } catch (e) {
      console.error('Khởi tạo Firebase thất bại:', e.message);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ detail: 'Máy chủ chưa được cấu hình Firebase (kiểm tra biến FIREBASE_SERVICE_ACCOUNT trên Vercel).' }));
    }
  }
  return handler(req, res);
};
