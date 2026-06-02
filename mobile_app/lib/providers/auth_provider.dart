import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:logger/logger.dart';
import 'dart:convert';
import '../models/user.dart';
import '../services/api_service.dart';
import '../services/rider_background_tracking_service.dart';

class AuthProvider with ChangeNotifier {
  final Logger _logger = Logger();
  User? _user;
  String? _token;
  String? _refreshToken;
  bool _isLoading = false;
  bool _sessionExpired = false;
  bool _handlingUnauthorized = false;
  Future<String?>? _refreshingToken;
  Future<void>? _googleSignInInitialization;

  AuthProvider() {
    ApiService.refreshAccessToken = _refreshAccessToken;
  }

  User? get user => _user;
  String? get token => _token;
  String? get refreshToken => _refreshToken;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _token != null;
  bool get isAdmin =>
      _user?.userType == 'admin' || _user?.userType == 'standard_user';
  bool get isRider => _user?.userType == 'rider';
  bool get isStoreOwner => _user?.userType == 'store_owner';
  bool get isGuest => _user?.isGuest == true || _user?.userType == 'guest';
  bool get sessionExpired => _sessionExpired;

  Future<void> _initializeGoogleSignIn() {
    return _googleSignInInitialization ??= GoogleSignIn.instance.initialize();
  }

  Future<void> _syncRiderTrackingSession() async {
    final token = _token?.trim();
    if (_user?.userType == 'rider' && token != null && token.isNotEmpty) {
      try {
        await RiderBackgroundTrackingService.instance.start(token);
        await RiderBackgroundTrackingService.instance.syncCurrentLocationNow();
      } catch (error, stackTrace) {
        _logger.w(
          'Rider tracking start skipped during session sync: $error',
          error: error,
          stackTrace: stackTrace,
        );
      }
      return;
    }
    await RiderBackgroundTrackingService.instance.stop();
  }

  bool _isUnauthorizedError(Object error) {
    final message = error.toString().toLowerCase();
    return message.contains('invalid or expired token') ||
        message.contains('expired token') ||
        message.contains('token expired') ||
        message.contains('token invalid') ||
        message.contains('unauthorized') ||
        message.contains('jwt');
  }

  Future<void> _clearLocalSession({bool clearPushToken = true}) async {
    await RiderBackgroundTrackingService.instance.stop(clearToken: true);
    _token = null;
    _refreshToken = null;
    _user = null;
    _isLoading = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('refresh_token');
    await prefs.remove('user');
    if (clearPushToken) {
      await prefs.remove('push_token');
    }
    notifyListeners();
  }

  Future<void> _handleUnauthorized() async {
    if (_handlingUnauthorized) return;
    if (_token == null && _user == null) return;
    _handlingUnauthorized = true;
    _sessionExpired = true;
    try {
      await _clearLocalSession(clearPushToken: true);
    } finally {
      _handlingUnauthorized = false;
    }
  }

  void clearSessionExpiredFlag() {
    _sessionExpired = false;
  }

  Future<void> login(String email, String password) async {
    _isLoading = true;
    notifyListeners();

    try {
      final data = await ApiService.login(email, password);
      if (data['success'] == true || data['token'] != null) {
        _token = data['token'];
        _refreshToken = data['refresh_token'];
        if (data['user'] != null) {
          _user = User.fromJson(data['user']);
        }

        // Save to prefs
        final prefs = await SharedPreferences.getInstance();
        if (_token != null) {
          await prefs.setString('token', _token!);
          await RiderBackgroundTrackingService.instance.updateToken(_token!);
        }
        if (_refreshToken != null && _refreshToken!.isNotEmpty) {
          await prefs.setString('refresh_token', _refreshToken!);
        }
        if (_user != null) {
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }

        _sessionExpired = false;

        // Initialize Stripe with public key
        if (!isGuest) {
          await _initializeStripe(_token!);
        }
        await _syncRiderTrackingSession();
      } else {
        throw Exception(data['message'] ?? 'Login failed');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> loginWithGoogle() async {
    _isLoading = true;
    notifyListeners();

    try {
      if (kIsWeb ||
          (defaultTargetPlatform != TargetPlatform.android &&
              defaultTargetPlatform != TargetPlatform.iOS)) {
        throw Exception(
          'Google sign in is available only on Android/iPhone builds right now.',
        );
      }

      final googleSignIn = GoogleSignIn.instance;
      await _initializeGoogleSignIn();
      if (!googleSignIn.supportsAuthenticate()) {
        throw Exception(
          'Google sign in is not supported on this platform build.',
        );
      }

      await googleSignIn.signOut();
      final account = await googleSignIn.authenticate(
        scopeHint: <String>['email', 'profile'],
      );

      final auth = account.authentication;
      final idToken = auth.idToken?.trim();
      if (idToken == null || idToken.isEmpty) {
        throw Exception('Google sign in did not return a valid ID token.');
      }

      final data = await ApiService.googleLogin(idToken);
      if (data['success'] == true || data['token'] != null) {
        _token = data['token'];
        _refreshToken = data['refresh_token'];
        if (data['user'] != null) {
          _user = User.fromJson(data['user']);
        }

        final prefs = await SharedPreferences.getInstance();
        if (_token != null) {
          await prefs.setString('token', _token!);
          await RiderBackgroundTrackingService.instance.updateToken(_token!);
        }
        if (_refreshToken != null && _refreshToken!.isNotEmpty) {
          await prefs.setString('refresh_token', _refreshToken!);
        }
        if (_user != null) {
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }

        _sessionExpired = false;
        if (!isGuest) {
          await _initializeStripe(_token!);
        }
        await _syncRiderTrackingSession();
      } else {
        throw Exception(data['message'] ?? 'Google login failed');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> register({
    required String firstName,
    required String lastName,
    required String dateOfBirth,
    required String email,
    required String password,
    String? phone,
    String? address,
  }) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await ApiService.register(
        firstName: firstName,
        lastName: lastName,
        dateOfBirth: dateOfBirth,
        email: email,
        password: password,
        phone: phone,
        address: address,
      );

      if (response['requires_verification'] == true) {
        return true;
      }

      if (response['success'] == true || response['token'] != null) {
        _token = response['token'];
        _refreshToken = response['refresh_token'];
        if (response['user'] != null) {
          _user = User.fromJson(response['user']);
        }

        // Save to prefs
        final prefs = await SharedPreferences.getInstance();
        if (_token != null) {
          await prefs.setString('token', _token!);
          await RiderBackgroundTrackingService.instance.updateToken(_token!);
        }
        if (_refreshToken != null && _refreshToken!.isNotEmpty) {
          await prefs.setString('refresh_token', _refreshToken!);
        }
        if (_user != null) {
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }

        _sessionExpired = false;
        await _syncRiderTrackingSession();

        return false;
      } else {
        throw Exception(response['message'] ?? 'Registration failed');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> verifyEmail(String email, String code) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.verifyEmail(email, code);
      if (response['success'] != true) {
        throw Exception(response['message'] ?? 'Verification failed');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> resendCode(String email) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.resendVerificationCode(email);
      if (response['success'] != true) {
        throw Exception(response['message'] ?? 'Failed to resend code');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> forgotPassword(String email) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.forgotPassword(email);
      if (response['success'] != true) {
        throw Exception(response['message'] ?? 'Failed to send reset link');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<String> verifyResetOTP(String email, String otp) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.verifyResetOTP(email, otp);
      if (response['success'] == true) {
        return response['reset_token'];
      } else {
        throw Exception(response['message'] ?? 'Failed to verify OTP');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> resetPassword(String token, String newPassword) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.resetPassword(token, newPassword);
      if (response['success'] != true) {
        throw Exception(response['message'] ?? 'Failed to reset password');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    _sessionExpired = false;
    final oldToken = _token;
    final prefs = await SharedPreferences.getInstance();
    final pushToken = prefs.getString('push_token');
    if (oldToken != null && pushToken != null && pushToken.trim().isNotEmpty) {
      try {
        await ApiService.unregisterPushDeviceToken(
          oldToken,
          deviceToken: pushToken,
        );
      } catch (_) {}
    }
    await _clearLocalSession(clearPushToken: true);
  }

  Future<void> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    if (_token == null) throw Exception('Not authenticated');

    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.changePassword(
        _token!,
        currentPassword,
        newPassword,
      );
      if (response['success'] != true) {
        throw Exception(response['message'] ?? 'Failed to change password');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> deleteAccount() async {
    if (_token == null) throw Exception('Not authenticated');

    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiService.deleteAccount(_token!);
      if (response['success'] == true) {
        await logout();
      } else {
        throw Exception(response['message'] ?? 'Failed to delete account');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> tryAutoLogin() async {
    final prefs = await SharedPreferences.getInstance();
    if (!prefs.containsKey('token')) return;

    _token = prefs.getString('token');
    _refreshToken = prefs.getString('refresh_token');

    // First load from cache to show something immediately
    if (prefs.containsKey('user')) {
      try {
        final userData = jsonDecode(prefs.getString('user')!);
        _user = User.fromJson(userData);
      } catch (e) {
        // invalid user data
      }
    }

    // Then verify with server to get fresh data
    try {
      if (_token != null) {
        final data = await ApiService.getProfile(_token!);
        if (data['success'] == true && data['user'] != null) {
          _user = User.fromJson(data['user']);
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }
      }
    } catch (e) {
      // Token might be expired or invalid
      if (_isUnauthorizedError(e)) {
        _logger.w('Auto-login token invalid, attempting refresh: $e');
        final refreshed = await _refreshAccessToken();
        if (refreshed != null) {
          try {
            final data = await ApiService.getProfile(refreshed);
            if (data['success'] == true && data['user'] != null) {
              _user = User.fromJson(data['user']);
              await prefs.setString('user', jsonEncode(_user!.toJson()));
            }
            await _syncRiderTrackingSession();
          } catch (refreshError) {
            _logger.w('Profile fetch failed after refresh: $refreshError');
          }
        } else {
          await _handleUnauthorized();
          return;
        }
      } else {
        _logger.w('Auto-login verification failed: $e');
      }
    }

    await _syncRiderTrackingSession();
    notifyListeners();
  }

  Future<String?> _refreshAccessToken() async {
    final prefs = await SharedPreferences.getInstance();
    final refreshToken = _refreshToken ?? prefs.getString('refresh_token');
    if (refreshToken == null || refreshToken.trim().isEmpty) return null;

    final inflight = _refreshingToken;
    if (inflight != null) return inflight;

    final future = _doRefresh(refreshToken);
    _refreshingToken = future;
    try {
      return await future;
    } finally {
      if (_refreshingToken == future) {
        _refreshingToken = null;
      }
    }
  }

  Future<void> guestLogin() async {
    _isLoading = true;
    notifyListeners();

    try {
      final data = await ApiService.guestLogin();
      if (data['success'] == true || data['token'] != null) {
        _token = data['token'];
        _refreshToken = data['refresh_token'];
        if (data['user'] != null) {
          _user = User.fromJson(data['user']);
        }

        final prefs = await SharedPreferences.getInstance();
        if (_token != null) {
          await prefs.setString('token', _token!);
          await RiderBackgroundTrackingService.instance.updateToken(_token!);
        }
        await prefs.remove('refresh_token');
        if (_user != null) {
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }

        _sessionExpired = false;
        await _syncRiderTrackingSession();
      } else {
        throw Exception(data['message'] ?? 'Guest login failed');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<String?> _doRefresh(String refreshToken) async {
    try {
      final response = await ApiService.refreshToken(refreshToken);
      final newToken = response['token']?.toString();
      if (newToken == null || newToken.trim().isEmpty) {
        return null;
      }
      _token = newToken;
      final newRefresh = response['refresh_token']?.toString();
      if (newRefresh != null && newRefresh.trim().isNotEmpty) {
        _refreshToken = newRefresh;
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', _token!);
      await RiderBackgroundTrackingService.instance.updateToken(_token!);
      if (_refreshToken != null && _refreshToken!.trim().isNotEmpty) {
        await prefs.setString('refresh_token', _refreshToken!);
      }
      _sessionExpired = false;
      await _syncRiderTrackingSession();
      notifyListeners();
      return _token;
    } catch (e) {
      if (e is ApiServiceException && e.isServiceUnavailable) {
        return null;
      }
      if (_isUnauthorizedError(e) ||
          e.toString().toLowerCase().contains('refresh token')) {
        _logger.w('Refresh token invalid, clearing session: $e');
        await _handleUnauthorized();
      } else {
        _logger.w('Refresh token request failed: $e');
      }
      return null;
    }
  }

  Future<void> _initializeStripe(String token) async {
    try {
      final data = await ApiService.getWalletBalance(token);
      final stripePublicKey = data['stripePublicKey'];

      if (stripePublicKey != null && stripePublicKey.isNotEmpty) {
        Stripe.publishableKey = stripePublicKey;
        await Stripe.instance.applySettings();
      }
    } catch (e) {
      // Ignore Stripe initialization errors, wallet is optional
    }
  }

  @override
  void dispose() {
    if (ApiService.refreshAccessToken == _refreshAccessToken) {
      ApiService.refreshAccessToken = null;
    }
    super.dispose();
  }
}
