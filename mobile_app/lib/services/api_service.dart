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

  static Future<Map<String, dynamic>> verifyEmail(
    String email,
    String code,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/verify-email');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'code': code}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> resendVerificationCode(
    String email,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/resend-code');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
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

  // Admin - Stores Management
  static Future<Map<String, dynamic>> createStore(
    String token,
    Map<String, dynamic> storeData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/stores');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(storeData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateStore(
    String token,
    int id,
    Map<String, dynamic> storeData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/stores/$id');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(storeData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteStore(String token, int id) async {
    final uri = Uri.parse('$baseUrl/api/stores/$id');
    _logger.d('ApiService: DELETE $uri');
    final response = await http.delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // Admin - Products Management
  static Future<List<dynamic>> getProducts(
    String token, {
    bool admin = true,
  }) async {
    final uri = Uri.parse('$baseUrl/api/products?admin=${admin ? 1 : 0}');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['products'] ?? [];
  }

  static Future<Map<String, dynamic>> createProduct(
    String token,
    Map<String, dynamic> productData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/products');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(productData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateProduct(
    String token,
    int id,
    Map<String, dynamic> productData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/products/$id');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(productData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteProduct(
    String token,
    int id,
  ) async {
    final uri = Uri.parse('$baseUrl/api/products/$id');
    _logger.d('ApiService: DELETE $uri');
    final response = await http.delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // Admin - Users Management
  static Future<List<dynamic>> getUsers(String token) async {
    final uri = Uri.parse('$baseUrl/api/users');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['users'] ?? [];
  }

  static Future<Map<String, dynamic>> updateUser(
    String token,
    int id,
    Map<String, dynamic> userData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/users/$id');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(userData),
    );
    return _handleResponse(response);
  }

  // Admin - Catalogue - Units
  static Future<List<dynamic>> getUnits() async {
    final uri = Uri.parse('$baseUrl/api/units');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    final data = _handleResponse(response);
    return data['units'] ?? [];
  }

  static Future<Map<String, dynamic>> createUnit(
    String token,
    Map<String, dynamic> unitData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/units');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(unitData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateUnit(
    String token,
    int id,
    Map<String, dynamic> unitData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/units/$id');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(unitData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteUnit(String token, int id) async {
    final uri = Uri.parse('$baseUrl/api/units/$id');
    _logger.d('ApiService: DELETE $uri');
    final response = await http.delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // Admin - Catalogue - Sizes
  static Future<List<dynamic>> getSizes() async {
    final uri = Uri.parse('$baseUrl/api/sizes');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    final data = _handleResponse(response);
    return data['sizes'] ?? [];
  }

  static Future<Map<String, dynamic>> createSize(
    String token,
    Map<String, dynamic> sizeData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/sizes');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(sizeData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateSize(
    String token,
    int id,
    Map<String, dynamic> sizeData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/sizes/$id');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(sizeData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteSize(String token, int id) async {
    final uri = Uri.parse('$baseUrl/api/sizes/$id');
    _logger.d('ApiService: DELETE $uri');
    final response = await http.delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // Admin - Catalogue - Categories
  static Future<List<dynamic>> getCategories() async {
    final uri = Uri.parse('$baseUrl/api/categories');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    final data = _handleResponse(response);
    return data['categories'] ?? [];
  }

  static Future<Map<String, dynamic>> createCategory(
    String token,
    Map<String, dynamic> categoryData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/categories');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(categoryData),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateCategory(
    String token,
    int id,
    Map<String, dynamic> categoryData,
  ) async {
    final uri = Uri.parse('$baseUrl/api/categories/$id');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(categoryData),
    );
    return _handleResponse(response);
  }

  // Admin - Utilities
  static Future<List<String>> getBackups(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/backup-db/list');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return List<String>.from(data['files'] ?? []);
  }

  static Future<void> createBackup(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/backup-db');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    _handleResponse(response);
  }
}
