import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user.dart';
import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
  User? _user;
  String? _token;
  bool _isLoading = false;

  User? get user => _user;
  String? get token => _token;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _token != null && _user != null;

  AuthProvider(SharedPreferences prefs) {
    _loadFromPrefs(prefs);
  }

  void _loadFromPrefs(SharedPreferences prefs) {
    _token = prefs.getString('token');
    final userData = prefs.getString('user');
    if (userData != null) {
      try {
        // Parse user data and create User object
        final userMap = Map<String, dynamic>.from(userData as Map);
        _user = User.fromJson(userMap);
      } catch (e) {
        // Clear invalid data
        prefs.remove('token');
        prefs.remove('user');
        _token = null;
        _user = null;
      }
    }
  }

  Future<void> login(String email, String password) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await ApiService.login(email, password);
      if (response['success']) {
        _token = response['token'];
        _user = User.fromJson(response['user']);

        // Save to prefs
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('token', _token!);
        await prefs.setString('user', _user!.toJson().toString());
      } else {
        throw Exception(response['message'] ?? 'Login failed');
      }
    } catch (e) {
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> register({
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

      if (response['success']) {
        _token = response['token'];
        _user = User.fromJson(response['user']);

        // Save to prefs
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('token', _token!);
        await prefs.setString('user', _user!.toJson().toString());
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

  Future<void> logout() async {
    _user = null;
    _token = null;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');

    notifyListeners();
  }

  Future<void> loadProfile() async {
    if (_token == null) return;

    try {
      final response = await ApiService.getProfile(_token!);
      if (response['success']) {
        _user = User.fromJson(response['user']);

        // Update prefs
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('user', _user!.toJson().toString());
        notifyListeners();
      }
    } catch (e) {
      // If token is invalid, logout
      await logout();
    }
  }
}
