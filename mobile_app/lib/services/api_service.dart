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

  static Future<List<dynamic>> getStores({int? categoryId}) async {
    String url = '$baseUrl/api/stores';
    if (categoryId != null) {
      url += '?category_id=$categoryId';
    }
    final uri = Uri.parse(url);
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    final data = _handleResponse(response);
    return data['stores'] ?? [];
  }

  static Future<List<dynamic>> getCategories() async {
    final uri = Uri.parse('$baseUrl/api/categories');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(uri);
    final data = _handleResponse(response);
    return data['categories'] ?? [];
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

  // Wallet APIs
  static Future<Map<String, dynamic>> getWalletBalance(String token) async {
    final uri = Uri.parse('$baseUrl/api/wallet/balance');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getWalletTransactions(
    String token, {
    int limit = 20,
    int offset = 0,
    String? type,
  }) async {
    String query = 'limit=$limit&offset=$offset';
    if (type != null && type.isNotEmpty) {
      query += '&type=$type';
    }
    final uri = Uri.parse('$baseUrl/api/wallet/transactions?$query');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getAutoRechargeSettings(
    String token,
  ) async {
    final uri = Uri.parse('$baseUrl/api/wallet/auto-recharge');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> saveAutoRechargeSettings(
    String token, {
    required bool enabled,
    required double amount,
    required double threshold,
  }) async {
    final uri = Uri.parse('$baseUrl/api/wallet/auto-recharge');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'enabled': enabled,
        'amount': amount,
        'threshold': threshold,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> topupWallet(
    String token, {
    required double amount,
    required String paymentMethod,
    String? cardToken,
    bool saveCard = false,
  }) async {
    final uri = Uri.parse('$baseUrl/api/wallet/topup');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'amount': amount,
        'paymentMethod': paymentMethod,
        'cardToken': cardToken,
        'saveCard': saveCard,
      }),
    );
    return _handleResponse(response);
  }

  // Payment Methods APIs
  static Future<Map<String, dynamic>> getPaymentMethods(String token) async {
    final uri = Uri.parse('$baseUrl/api/wallet/payment-methods');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> setPrimaryPaymentMethod(
    String token,
    int id,
  ) async {
    final uri = Uri.parse('$baseUrl/api/wallet/payment-methods/$id/primary');
    _logger.d('ApiService: PUT $uri');
    final response = await http.put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deletePaymentMethod(
    String token,
    int id,
  ) async {
    final uri = Uri.parse('$baseUrl/api/wallet/payment-methods/$id');
    _logger.d('ApiService: DELETE $uri');
    final response = await http.delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // P2P Transfers APIs
  static Future<Map<String, dynamic>> sendMoney(
    String token, {
    int? recipientId,
    String? email,
    required double amount,
    String? description,
  }) async {
    final uri = Uri.parse('$baseUrl/api/wallet/transfers/send');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        if (recipientId != null) 'recipient_id': recipientId,
        if (email != null) 'email': email,
        'amount': amount,
        'description': description,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getSentTransfers(
    String token, {
    int limit = 20,
    int offset = 0,
  }) async {
    final uri = Uri.parse(
      '$baseUrl/api/wallet/transfers/sent?limit=$limit&offset=$offset',
    );
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getReceivedTransfers(
    String token, {
    int limit = 20,
    int offset = 0,
  }) async {
    final uri = Uri.parse(
      '$baseUrl/api/wallet/transfers/received?limit=$limit&offset=$offset',
    );
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> acceptTransfer(
    String token,
    int id,
  ) async {
    final uri = Uri.parse('$baseUrl/api/wallet/transfers/$id/accept');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> rejectTransfer(
    String token,
    int id, {
    String? reason,
  }) async {
    final uri = Uri.parse('$baseUrl/api/wallet/transfers/$id/reject');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'reason': reason}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> cancelTransfer(
    String token,
    int id,
  ) async {
    final uri = Uri.parse('$baseUrl/api/wallet/transfers/$id/cancel');
    _logger.d('ApiService: POST $uri');
    final response = await http.post(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getInventoryReport(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/inventory-report');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStoreSalesReport(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/store-sales-report');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

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

  static Future<List<dynamic>> getStoresForAdmin(String token) async {
    final uri = Uri.parse('$baseUrl/api/stores');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['stores'] ?? [];
  }

  static Future<List<dynamic>> getProductsForAdmin(String token) async {
    final uri = Uri.parse('$baseUrl/api/products');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['products'] ?? [];
  }

  static Future<List<dynamic>> getRiders(String token) async {
    final uri = Uri.parse('$baseUrl/api/riders');
    _logger.d('ApiService: GET $uri');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['riders'] ?? [];
  }
}
