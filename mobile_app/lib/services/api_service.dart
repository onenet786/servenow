import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  // Use localhost for web, 10.0.2.2 for Android emulator
  // Since we are running on web-server mode primarily for now:
  static const String baseUrl = 'http://localhost:3002/api';

  Future<Map<String, dynamic>> login(String email, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'password': password}),
      );

      final data = jsonDecode(response.body);
      if (response.statusCode == 200) {
        return data;
      } else {
        throw Exception(data['message'] ?? 'Login failed');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }

  Future<List<dynamic>> getStores() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/stores'));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['stores'] ?? [];
      } else {
        throw Exception('Failed to load stores');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }

  // Helper to get token
  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('token');
  }
}
