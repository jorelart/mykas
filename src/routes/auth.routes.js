const express = require('express');
const asyncRoute = require('../middleware/async-route');
const Auth = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/register', Auth.renderRegister);
router.post('/register', asyncRoute(Auth.register));
router.get('/aktivasi', Auth.activationPage);
router.post('/aktivasi/kirim-ulang', asyncRoute(Auth.resendActivation));
router.post('/aktivasi', asyncRoute(Auth.activate));
router.get('/login', Auth.renderLogin);
router.post('/login', asyncRoute(Auth.login));
router.get('/lupa-password', Auth.forgotPage);
router.post('/lupa-password', asyncRoute(Auth.requestPasswordReset));
router.get('/reset-password', Auth.resetPage);
router.post('/reset-password/kirim-ulang', asyncRoute(Auth.resendReset));
router.post('/reset-password', asyncRoute(Auth.resetPassword));
router.get('/profil', requireAuth, asyncRoute(Auth.profilePage));
router.post('/profil', requireAuth, asyncRoute(Auth.updateProfile));
router.post('/profil/password', requireAuth, asyncRoute(Auth.changePassword));
router.post('/logout', asyncRoute(Auth.logout));

module.exports = router;
