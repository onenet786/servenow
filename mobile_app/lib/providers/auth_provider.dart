import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:logger/logger.dart';
import 'dart:convert';
import '../models/user.dart';
import '../services/api_service.dart';
import '../services/notification_service.dart';

class AuthProvider with ChangeNotifier {
  final Logger _logger = Logger();
  User? _user;
  String? _token;
  bool _isLoading = false;

  User? get user => _user;
  String? get token => _token;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _token != null;
  bool get isAdmin => _user?.userType == 'admin';
  bool get isRider => _user?.userType == 'rider';

  Future<void> login(String email, String password) async {
    _isLoading = true;
    notifyListeners();

    try {
      final data = await ApiService.login(email, password);
      if (data['success'] == true || data['token'] != null) {
        _token = data['token'];
        if (data['user'] != null) {
          _user = User.fromJson(data['user']);
        }

        // Save to prefs
        final prefs = await SharedPreferences.getInstance();
        if (_token != null) {
          await prefs.setString('token', _token!);
        }
        if (_user != null) {
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }

        // Initialize Stripe with public key
        await _initializeStripe(_token!);

        // Connect to Socket.IO for real-time notifications
        if (_user != null) {
          NotificationService.connect(_user!.id, _user!.userType);
        }
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

  Future<bool> register({
    required String firstName,
    required String lastName,
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
        if (response['user'] != null) {
          _user = User.fromJson(response['user']);
        }

        // Save to prefs
        final prefs = await SharedPreferences.getInstance();
        if (_token != null) {
          await prefs.setString('token', _token!);
        }
        if (_user != null) {
          await prefs.setString('user', jsonEncode(_user!.toJson()));
        }

        // Connect to Socket.IO for real-time notifications
        if (_user != null) {
          NotificationService.connect(_user!.id, _user!.userType);
        }

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

  Future<void> logout() async {
    _token = null;
    _user = null;
    NotificationService.disconnect();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
    notifyListeners();
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
      // Optional: force logout if 401
      _logger.w('Auto-login verification failed: $e');
    }

    notifyListeners();
  }

  Future<void> _initializeStripe(String token) async {
    try {
      final data = await ApiService.getWalletBalance(token);
      final stripePublicKey = data['stripePublicKey'];

      if (stripePublicKey != null && stripePublicKey.isNotEmpty) {
        await Stripe.instance.applySettings();
        Stripe.publishableKey = stripePublicKey;
      }
    } catch (e) {
      // Ignore Stripe initialization errors, wallet is optional
    }
  }
}
