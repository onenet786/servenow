import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'dart:convert';
import '../models/user.dart';
import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
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
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
    notifyListeners();
  }

  Future<void> tryAutoLogin() async {
    final prefs = await SharedPreferences.getInstance();
    if (!prefs.containsKey('token')) return;

    final storedToken = prefs.getString('token');
    if (storedToken == null) return;

    try {
      // Try to validate token with server
      final response = await ApiService.getProfile(storedToken);
      if (response['success'] == true || response['user'] != null) {
        _token = storedToken;
        _user = User.fromJson(response['user']);

        // Update prefs
        await prefs.setString('user', jsonEncode(_user!.toJson()));
        
        // Initialize Stripe with public key
        await _initializeStripe(storedToken);
        
        notifyListeners();
      } else {
        await logout();
      }
    } catch (e) {
      // If network fails, try to load user from prefs as fallback
      if (prefs.containsKey('user')) {
        try {
          final userData = jsonDecode(prefs.getString('user')!);
          _user = User.fromJson(userData);
          _token = storedToken;
          notifyListeners();
        } catch (e) {
          await logout();
        }
      } else {
        await logout();
      }
    }
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
