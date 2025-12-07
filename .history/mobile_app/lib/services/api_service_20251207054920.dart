import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/product.dart';

class ApiService {
  static const String baseUrl = 'http://23.137.84.249:3002'; // Production API server
  // For iOS simulator: 'http://localhost:3002'
  // For physical device: use your computer's IP address

  // Auth endpoints
  static Future<Map<String, dynamic>> login(String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/login'),
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
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/register'),
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
    final response = await http.get(
      Uri.parse('$baseUrl/api/auth/me'),
      headers: {'Authorization': 'Bearer $token'},
    );

    return _handleResponse(response);
  }

  // Products endpoints
  static Future<List<Product>> getProducts({String? category, int? storeId}) async {
    final queryParams = <String, String>{};
    if (category != null) queryParams['category'] = category;
    if (storeId != null) queryParams['store'] = storeId.toString();

    final uri = Uri.parse('$baseUrl/api/products').replace(queryParameters: queryParams);
    final response = await http.get(uri);

    final data = _handleResponse(response);
    final products = (data['products'] as List)
        .map((product) => Product.fromJson(product))
        .toList();

    return products;
  }

  static Future<Product> getProduct(int id) async {
    final response = await http.get(Uri.parse('$baseUrl/api/products/$id'));
    final data = _handleResponse(response);
    return Product.fromJson(data['product']);
  }

  // Orders endpoints
  static Future<Map<String, dynamic>> createOrder({
    required String token,
    required int storeId,
    required List<Map<String, dynamic>> items,
    required String paymentMethod,
    required String deliveryAddress,
    String? deliveryTime,
    String? specialInstructions,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/orders'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'store_id': storeId,
        'items': items,
        'payment_method': paymentMethod,
        'delivery_address': deliveryAddress,
        'delivery_time': deliveryTime,
        'special_instructions': specialInstructions,
      }),
    );

    return _handleResponse(response);
  }

  static Future<List<dynamic>> getOrders(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/orders/my-orders'),
      headers: {'Authorization': 'Bearer $token'},
    );

    final data = _handleResponse(response);
    return data['orders'];
  }

  static Future<List<dynamic>> getAllOrders(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/orders'),
      headers: {'Authorization': 'Bearer $token'},
    );

    final data = _handleResponse(response);
    return data['orders'];
  }

  static Future<void> updateOrderStatus(String token, int orderId, String status) async {
    final response = await http.put(
      Uri.parse('$baseUrl/api/orders/$orderId/status'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'status': status}),
    );

    _handleResponse(response);
  }

  static Future<void> assignRider(String token, int orderId, int riderId) async {
    final response = await http.put(
      Uri.parse('$baseUrl/api/orders/$orderId/assign-rider'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'rider_id': riderId}),
    );

    _handleResponse(response);
  }

  static Future<void> updateRiderLocation(String token, int orderId, String location) async {
    final response = await http.put(
      Uri.parse('$baseUrl/api/orders/$orderId/rider-location'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'location': location}),
    );

    _handleResponse(response);
  }

  static Future<void> markAsDelivered(String token, int orderId) async {
    final response = await http.put(
      Uri.parse('$baseUrl/api/orders/$orderId/deliver'),
      headers: {'Authorization': 'Bearer $token'},
    );

    _handleResponse(response);
  }

  static Future<void> updatePaymentStatus(String token, int orderId, String status) async {
    final response = await http.put(
      Uri.parse('$baseUrl/api/orders/$orderId/payment-status'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'payment_status': status}),
    );

    _handleResponse(response);
  }

  static Future<List<dynamic>> getAvailableRiders(String token) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/orders/available-riders'),
      headers: {'Authorization': 'Bearer $token'},
    );

    final data = _handleResponse(response);
    return data['riders'];
  }

  static Future<List<dynamic>> getRiderDeliveries(String token, {String status = 'assigned'}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/orders/rider/deliveries?status=$status'),
      headers: {'Authorization': 'Bearer $token'},
    );

    final data = _handleResponse(response);
    return data['deliveries'];
  }

  // Categories endpoints
  static Future<List<dynamic>> getCategories() async {
    final response = await http.get(Uri.parse('$baseUrl/api/categories'));
    final data = _handleResponse(response);
    return data['categories'];
  }

  // Stores endpoints
  static Future<List<dynamic>> getStores() async {
    final response = await http.get(Uri.parse('$baseUrl/api/stores'));
    final data = _handleResponse(response);
    return data['stores'];
  }

  static Map<String, dynamic> _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body);
    } else {
      throw Exception('API Error: ${response.statusCode} - ${response.body}');
    }
  }
}
