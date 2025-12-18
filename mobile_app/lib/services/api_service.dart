import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:logger/logger.dart';

class ApiService {
  static final Logger _logger = Logger();

  static String get baseUrl {
    if (kIsWeb) {
      return 'http://23.137.84.249:3002';
    }
    try {
      if (Platform.isAndroid) {
        return 'http://23.137.84.249:3002';
      }
    } catch (e) {
      // Platform check failed (likely on web if kIsWeb check missed somehow), fallback to default
    }
    return 'http://23.137.84.249:3002';
  }

  static String getImageUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('/')) return '$baseUrl$url';
    return '$baseUrl/$url';
  }

  static Map<String, dynamic> _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body);
    } else {
      try {
        final errorData = jsonDecode(response.body);
        throw Exception(
          errorData['message'] ?? 'API Error: ${response.statusCode}',
        );
      } catch (e) {
        throw Exception('API Error: ${response.statusCode} - ${response.body}');
      }
    }
  }

  static Future<Map<String, dynamic>> login(
    String email,
    String password,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/login');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> register({
    required String firstName,
    required String lastName,
    required String email,
    required String password,
    String? phone,
    String? address,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/register');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'firstName': firstName,
        'lastName': lastName,
        'email': email,
        'password': password,
        'phone': phone,
        'address': address,
        'userType': 'customer',
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getProfile(String token) async {
    final uri = Uri.parse('$baseUrl/api/auth/me');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getStores() async {
    final uri = Uri.parse('$baseUrl/api/stores');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    final data = _handleResponse(response);
    return data['stores'] ?? [];
  }

  static Future<Map<String, dynamic>> getStoreDetails(int id) async {
    final uri = Uri.parse('$baseUrl/api/stores/$id');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getOrders(String token) async {
    final uri = Uri.parse('$baseUrl/api/orders');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['orders'] ?? [];
  }

  static Future<Map<String, dynamic>> createOrder(
    String token, {
    required int storeId,
    required List<Map<String, dynamic>> items,
    required String deliveryAddress,
    required String paymentMethod,
    String? deliveryTime,
    String? specialInstructions,
  }) async {
    final uri = Uri.parse('$baseUrl/api/orders');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'store_id': storeId,
        'items': items,
        'delivery_address': deliveryAddress,
        'payment_method': paymentMethod,
        'delivery_time': deliveryTime,
        'special_instructions': specialInstructions,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getVisitorStats(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/visitor-stats');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // Rider APIs
  static Future<Map<String, dynamic>> getRiderProfile(String token) async {
    final uri = Uri.parse('$baseUrl/api/orders/rider/profile');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getRiderDeliveries(
    String token,
    String status,
  ) async {
    final uri = Uri.parse(
      '$baseUrl/api/orders/rider/deliveries?status=$status',
    );
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['deliveries'] ?? [];
  }

  static Future<Map<String, dynamic>> updateOrderStatus(
    String token,
    int orderId,
    String status,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId/status');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'status': status}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updatePaymentStatus(
    String token,
    int orderId,
    String status,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId/payment-status');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'paymentStatus': status}),
    );
    return _handleResponse(response);
  }
}
