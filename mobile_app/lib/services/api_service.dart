import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:logger/logger.dart';

class ApiServiceException implements Exception {
  final String message;
  final bool isServiceUnavailable;

  const ApiServiceException(this.message, {this.isServiceUnavailable = false});

  @override
  String toString() => message;
}

class _CacheEntry<T> {
  final T value;
  final DateTime expiresAt;

  const _CacheEntry({required this.value, required this.expiresAt});

  bool get isFresh => DateTime.now().isBefore(expiresAt);
}

class ApiService {
  static final Logger _logger = Logger();
  static const String _defaultBaseUrl = 'https://servenow.pk';
  static const String _localDebugBaseUrl = 'http://127.0.0.1:3002';
  static const String _configuredBaseUrl = String.fromEnvironment(
    'SERVENOW_API_BASE_URL',
    defaultValue: '',
  );
  static const String serviceUnavailableMessage =
      'ServeNow is temporarily unavailable. The site is under maintenance. Please try again shortly.';
  static Future<String?> Function()? refreshAccessToken;
  static Future<String?>? _refreshInFlight;
  static final Map<String, _CacheEntry<Map<String, dynamic>>> _storesCache = {};
  static final Map<String, _CacheEntry<Map<String, dynamic>>>
  _storeDetailsCache = {};
  static _CacheEntry<List<dynamic>>? _categoriesCache;
  static const Duration _storesCacheTtl = Duration(minutes: 2);
  static const Duration _storeDetailsCacheTtl = Duration(minutes: 2);
  static const Duration _categoriesCacheTtl = Duration(minutes: 5);
  static DateTime? _lastServerTime;

  static DateTime? get lastServerTime => _lastServerTime;

  static String get baseUrl {
    final configured = _configuredBaseUrl.trim();
    if (configured.isNotEmpty) {
      return configured.replaceFirst(RegExp(r'\/+$'), '');
    }

    if (kIsWeb) {
      final host = Uri.base.host.trim().toLowerCase();
      final isLocalWebHost =
          host == 'localhost' || host == '127.0.0.1' || host == '0.0.0.0';

      if (isLocalWebHost) {
        return _defaultBaseUrl;
      }

      if (Uri.base.host.trim().isNotEmpty) {
        return Uri.base.origin.replaceFirst(RegExp(r'\/+$'), '');
      }

      return _defaultBaseUrl;
    }

    if (kDebugMode && !kIsWeb) {
      if (Platform.isAndroid) {
        // 10.0.2.2 only works on the Android emulator. Use the live API by
        // default so physical devices can connect without extra setup.
        return _defaultBaseUrl;
      } else if (Platform.isIOS) {
        return _localDebugBaseUrl;
      } else if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
        return _localDebugBaseUrl;
      }
    }

    return _defaultBaseUrl;
  }

  static String getImageUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:$url';
    if (url.startsWith('/')) return '$baseUrl$url';
    return '$baseUrl/$url';
  }

  static bool _looksLikeConnectivityIssue(String message) {
    final lower = message.toLowerCase();
    return lower.contains('failed host lookup') ||
        lower.contains('connection refused') ||
        lower.contains('connection reset') ||
        lower.contains('connection closed') ||
        lower.contains('network is unreachable') ||
        lower.contains('software caused connection abort') ||
        lower.contains('timed out') ||
        lower.contains('timeout') ||
        lower.contains('network request failed') ||
        lower.contains('socketexception') ||
        lower.contains('clientexception') ||
        lower.contains('23.137.84.249') ||
        lower.contains('servenow.pk');
  }

  static Future<String?> _refreshAccessTokenOnce() async {
    final handler = refreshAccessToken;
    if (handler == null) return null;
    final inflight = _refreshInFlight;
    if (inflight != null) return inflight;

    final future = handler();
    _refreshInFlight = future;
    try {
      return await future;
    } finally {
      if (_refreshInFlight == future) {
        _refreshInFlight = null;
      }
    }
  }

  static bool _shouldAttemptRefresh(
    http.Response response,
    Map<String, String>? headers,
  ) {
    if (response.statusCode != 401 && response.statusCode != 403) return false;
    if (headers == null) return false;
    final authHeader = headers['Authorization'];
    if (authHeader == null || authHeader.trim().isEmpty) return false;
    return refreshAccessToken != null;
  }

  static void _captureServerTime(http.Response response) {
    final raw = response.headers['date'];
    if (raw == null || raw.trim().isEmpty) return;
    final parsed = DateTime.tryParse(raw);
    if (parsed != null) {
      _lastServerTime = parsed.toLocal();
    }
  }

  static Future<http.Response> _send(
    Future<http.Response> Function() request, {
    Map<String, String>? headers,
  }) async {
    try {
      final response = await request().timeout(const Duration(seconds: 20));
      if (_shouldAttemptRefresh(response, headers)) {
        final refreshed = await _refreshAccessTokenOnce();
        if (refreshed != null && headers != null) {
          headers['Authorization'] = 'Bearer $refreshed';
          final refreshedResponse = await request().timeout(
            const Duration(seconds: 20),
          );
          _captureServerTime(refreshedResponse);
          return refreshedResponse;
        }
      }
      _captureServerTime(response);
      return response;
    } on SocketException {
      throw const ApiServiceException(
        serviceUnavailableMessage,
        isServiceUnavailable: true,
      );
    } on http.ClientException catch (error) {
      if (_looksLikeConnectivityIssue(error.message)) {
        throw const ApiServiceException(
          serviceUnavailableMessage,
          isServiceUnavailable: true,
        );
      }
      throw ApiServiceException(error.message);
    } on TimeoutException {
      throw const ApiServiceException(
        serviceUnavailableMessage,
        isServiceUnavailable: true,
      );
    }
  }

  static Future<http.Response> _get(Uri uri, {Map<String, String>? headers}) =>
      _send(() => http.get(uri, headers: headers), headers: headers);

  static Future<http.Response> _post(
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
  }) => _send(
    () => http.post(uri, headers: headers, body: body),
    headers: headers,
  );

  static Future<http.Response> _put(
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
  }) => _send(
    () => http.put(uri, headers: headers, body: body),
    headers: headers,
  );

  static Future<http.Response> _delete(
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
  }) => _send(
    () => http.delete(uri, headers: headers, body: body),
    headers: headers,
  );

  static Map<String, dynamic> _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body);
    } else if (response.statusCode == 502 ||
        response.statusCode == 503 ||
        response.statusCode == 504) {
      throw const ApiServiceException(
        serviceUnavailableMessage,
        isServiceUnavailable: true,
      );
    } else {
      try {
        final errorData = jsonDecode(response.body);
        final message =
            (errorData['message'] ?? 'API Error: ${response.statusCode}')
                .toString();
        throw ApiServiceException(message);
      } on FormatException {
        final preview = response.body.length > 240
            ? '${response.body.substring(0, 240)}...'
            : response.body;
        _logger.w(
          'Non-JSON API error ${response.statusCode} from ${response.request?.url}: $preview',
        );
        throw ApiServiceException(
          'Unable to complete your request right now. Please try again.',
        );
      }
    }
  }

  static Future<Map<String, dynamic>> login(
    String email,
    String password,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/login');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> googleLogin(String idToken) async {
    final uri = Uri.parse('$baseUrl/api/auth/google-mobile');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'id_token': idToken}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> guestLogin() async {
    final uri = Uri.parse('$baseUrl/api/auth/guest-login');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(<String, dynamic>{}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> register({
    required String firstName,
    required String lastName,
    required String dateOfBirth,
    required String email,
    required String password,
    String? phone,
    String? address,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/register');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'firstName': firstName,
        'lastName': lastName,
        'dateOfBirth': dateOfBirth,
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
    final response = await _post(
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
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> forgotPassword(String email) async {
    final uri = Uri.parse('$baseUrl/api/auth/forgot-password');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> verifyResetOTP(
    String email,
    String otp,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/verify-reset-otp');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'otp': otp}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> resetPassword(
    String token,
    String newPassword,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/reset-password');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'token': token, 'password': newPassword}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> changePassword(
    String token,
    String currentPassword,
    String newPassword,
  ) async {
    final uri = Uri.parse('$baseUrl/api/auth/change-password');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getProfile(String token) async {
    final uri = Uri.parse('$baseUrl/api/auth/me');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteAccount(String token) async {
    final uri = Uri.parse('$baseUrl/api/auth/account');
    _logger.d('ApiService: DELETE $uri');
    final response = await _delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> registerPushDeviceToken(
    String token, {
    required String deviceToken,
    required String platform,
    String? deviceId,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/push-token');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'device_token': deviceToken.trim(),
        'platform': platform.trim(),
        if (deviceId != null && deviceId.trim().isNotEmpty)
          'device_id': deviceId.trim(),
      }),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> unregisterPushDeviceToken(
    String token, {
    required String deviceToken,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/push-token');
    _logger.d('ApiService: DELETE $uri');
    final response = await _delete(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'device_token': deviceToken.trim()}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStores({
    int? categoryId,
    double? latitude,
    double? longitude,
    String? city,
    String? token,
    bool admin = false,
    bool forceRefresh = false,
  }) async {
    final query = <String, String>{};
    if (categoryId != null) {
      query['category_id'] = categoryId.toString();
    }
    if (latitude != null && longitude != null) {
      query['latitude'] = latitude.toString();
      query['longitude'] = longitude.toString();
    }
    if (city != null && city.trim().isNotEmpty) {
      query['city'] = city.trim();
    }
    if (admin) {
      query['admin'] = '1';
    }

    final uri = Uri.parse(
      '$baseUrl/api/stores',
    ).replace(queryParameters: query.isEmpty ? null : query);
    _logger.d('ApiService: GET $uri');
    final cacheKey = '${uri.toString()}|${token?.trim() ?? ''}';
    final cached = _storesCache[cacheKey];
    if (!forceRefresh && cached != null && cached.isFresh) {
      return cached.value;
    }
    final headers = <String, String>{};
    if (token != null && token.trim().isNotEmpty) {
      headers['Authorization'] = 'Bearer ${token.trim()}';
    }
    final response = await _get(uri, headers: headers.isEmpty ? null : headers);
    final data = _handleResponse(response);
    _storesCache[cacheKey] = _CacheEntry<Map<String, dynamic>>(
      value: data,
      expiresAt: DateTime.now().add(_storesCacheTtl),
    );
    return data;
  }

  static Future<List<dynamic>> getCategories({bool forceRefresh = false}) async {
    if (!forceRefresh && _categoriesCache != null && _categoriesCache!.isFresh) {
      return _categoriesCache!.value;
    }
    final uri = Uri.parse('$baseUrl/api/categories');
    _logger.d('ApiService: GET $uri');
    final response = await _get(uri);
    final data = _handleResponse(response);
    final categories = (data['categories'] as List<dynamic>?) ?? [];
    _categoriesCache = _CacheEntry<List<dynamic>>(
      value: categories,
      expiresAt: DateTime.now().add(_categoriesCacheTtl),
    );
    return categories;
  }

  static Future<Map<String, dynamic>> getStoreDetails(
    int id, {
    String? token,
    bool admin = false,
    bool forceRefresh = false,
  }) async {
    final query = <String, String>{};
    if (admin) {
      query['admin'] = '1';
    }
    final uri = Uri.parse(
      '$baseUrl/api/stores/$id',
    ).replace(queryParameters: query.isEmpty ? null : query);
    _logger.d('ApiService: GET $uri');
    final cacheKey = '${uri.toString()}|${token?.trim() ?? ''}';
    final cached = _storeDetailsCache[cacheKey];
    if (!forceRefresh && cached != null && cached.isFresh) {
      return cached.value;
    }
    final headers = <String, String>{};
    if (token != null && token.trim().isNotEmpty) {
      headers['Authorization'] = 'Bearer ${token.trim()}';
    }
    final response = await _get(uri, headers: headers.isEmpty ? null : headers);
    final data = _handleResponse(response);
    _storeDetailsCache[cacheKey] = _CacheEntry<Map<String, dynamic>>(
      value: data,
      expiresAt: DateTime.now().add(_storeDetailsCacheTtl),
    );
    return data;
  }

  static Future<Map<String, dynamic>> getStoreStatusMessage(
    String token, {
    int? storeId,
  }) async {
    final query = (storeId != null && storeId > 0) ? '?store_id=$storeId' : '';
    final uri = Uri.parse('$baseUrl/api/stores/status-message$query');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> setStoreStatusMessage(
    String token, {
    int? storeId,
    required String statusMessage,
    required bool isClosed,
  }) async {
    final uri = Uri.parse('$baseUrl/api/stores/status-message');
    _logger.d('ApiService: PUT $uri');
    final body = <String, dynamic>{
      'status_message': statusMessage,
      'is_closed': isClosed,
    };
    if (storeId != null && storeId > 0) {
      body['store_id'] = storeId;
    }
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(body),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getGlobalDeliveryStatus(
    String token,
  ) async {
    final uri = Uri.parse('$baseUrl/api/stores/global-delivery-status');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    if (data['global_delivery_status'] is Map<String, dynamic>) {
      return data['global_delivery_status'] as Map<String, dynamic>;
    }
    if (data['status'] is Map<String, dynamic>) {
      return data['status'] as Map<String, dynamic>;
    }
    if (data['global_status'] is Map<String, dynamic>) {
      return data['global_status'] as Map<String, dynamic>;
    }
    return data;
  }

  static Future<Map<String, dynamic>> getLivePromotions([String? token]) async {
    final uri = Uri.parse('$baseUrl/api/stores/live-promotions');
    _logger.d('ApiService: GET $uri');
    final headers = <String, String>{};
    if (token != null && token.trim().isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    final response = await _get(uri, headers: headers);
    final data = _handleResponse(response);
    if (data['live_promotions'] is Map<String, dynamic>) {
      return data['live_promotions'] as Map<String, dynamic>;
    }
    if (data['promotion'] is Map<String, dynamic>) {
      return data['promotion'] as Map<String, dynamic>;
    }
    return data;
  }

  static Future<Map<String, dynamic>> getCustomerFlashMessage(
    String token,
  ) async {
    final uri = Uri.parse('$baseUrl/api/stores/customer-flash-message');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    if (data['customer_flash_message'] is Map<String, dynamic>) {
      return data['customer_flash_message'] as Map<String, dynamic>;
    }
    if (data['flash_message'] is Map<String, dynamic>) {
      return data['flash_message'] as Map<String, dynamic>;
    }
    return data;
  }

  static Future<Map<String, dynamic>> setGlobalDeliveryStatus(
    String token, {
    required bool isEnabled,
    required bool blockOrdering,
    String? title,
    required String statusMessage,
    String? startAt,
    String? endAt,
  }) async {
    final uri = Uri.parse('$baseUrl/api/stores/global-delivery-status');
    _logger.d('ApiService: PUT $uri');
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'is_enabled': isEnabled,
        'block_ordering': blockOrdering,
        'title': title?.trim().isEmpty == true ? null : title?.trim(),
        'status_message': statusMessage.trim(),
        'start_at': startAt?.trim().isEmpty == true ? null : startAt?.trim(),
        'end_at': endAt?.trim().isEmpty == true ? null : endAt?.trim(),
      }),
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getOrders(
    String token, {
    String? assignment,
    String? status,
    bool includeItemsCount = true,
    bool includeStoreStatuses = true,
    bool includeStoreDetails = true,
    String? startDate,
    String? endDate,
  }) async {
    final query = <String, String>{
      'includeItemsCount': includeItemsCount.toString(),
      'includeStoreStatuses': includeStoreStatuses.toString(),
      'includeStoreDetails': includeStoreDetails.toString(),
    };
    if (assignment != null && assignment.trim().isNotEmpty) {
      query['assignment'] = assignment.trim();
    }
    if (status != null && status.trim().isNotEmpty) {
      query['status'] = status.trim();
    }
    if (startDate != null && startDate.trim().isNotEmpty) {
      query['startDate'] = startDate.trim();
    }
    if (endDate != null && endDate.trim().isNotEmpty) {
      query['endDate'] = endDate.trim();
    }
    final uri = Uri.parse(
      '$baseUrl/api/orders',
    ).replace(queryParameters: query);
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['orders'] ?? [];
  }

  static Future<List<dynamic>> getMyOrders(String token) async {
    final uri = Uri.parse('$baseUrl/api/orders/my-orders');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['orders'] ?? [];
  }

  static Future<Map<String, dynamic>> getOrderDetails(
    String token,
    int orderId,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return (data['order'] as Map?)?.cast<String, dynamic>() ??
        <String, dynamic>{};
  }

  static Future<Map<String, dynamic>> refreshToken(String refreshToken) async {
    final uri = Uri.parse('$baseUrl/api/auth/refresh');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'refresh_token': refreshToken}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getCustomerSupportContact(
    String token,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/customer-support-contact');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return (data['support'] as Map?)?.cast<String, dynamic>() ??
        <String, dynamic>{};
  }

  static Future<Map<String, dynamic>> getDeliveryFeeConfig() async {
    final uri = Uri.parse('$baseUrl/api/orders/delivery-fee-config');
    _logger.d('ApiService: GET $uri');
    final response = await _get(uri);
    final data = _handleResponse(response);
    return data;
  }

  static Future<Map<String, dynamic>> getAppUpdateStatus(String token) async {
    final uri = Uri.parse('$baseUrl/api/stores/app-update-status');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return (data['app_update'] as Map?)?.cast<String, dynamic>() ??
        <String, dynamic>{};
  }

  static Future<Map<String, dynamic>> createOrder(
    String token, {
    int? storeId,
    required List<Map<String, dynamic>> items,
    required String deliveryAddress,
    required String paymentMethod,
    String? deliveryTime,
    String? specialInstructions,
  }) async {
    final uri = Uri.parse('$baseUrl/api/orders');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'store_id': ?storeId,
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
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getRecentActivity(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/recent-activity');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data;
  }

  static Future<Map<String, dynamic>> getAdminDailySalesSummary(
    String token,
    String date,
  ) async {
    final uri = Uri.parse(
      '$baseUrl/api/admin/daily-sales-summary',
    ).replace(queryParameters: {'date': date});
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  // Rider APIs
  static Future<Map<String, dynamic>> getRiderProfile(String token) async {
    final uri = Uri.parse('$baseUrl/api/orders/rider/profile');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
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
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final preview = response.body.length > 300
          ? '${response.body.substring(0, 300)}...'
          : response.body;
      _logger.w(
        'Rider deliveries failed: status=${response.statusCode}, url=$uri, body=$preview',
      );
    }
    final data = _handleResponse(response);
    return data['deliveries'] ?? [];
  }

  static Future<Map<String, dynamic>> getRiderWalletStats(
    String token,
    String period,
  ) async {
    final uri = Uri.parse(
      '$baseUrl/api/orders/rider/wallet-stats?period=$period',
    );
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getRiderFinancialHistory(
    String token, {
    String? from,
    String? to,
    int? riderId,
  }) async {
    final query = <String, String>{};
    if (from != null && from.trim().isNotEmpty) query['from'] = from.trim();
    if (to != null && to.trim().isNotEmpty) query['to'] = to.trim();
    if (riderId != null && riderId > 0) query['rider_id'] = riderId.toString();
    final uri = Uri.parse(
      '$baseUrl/api/orders/rider/financial-history',
    ).replace(queryParameters: query.isEmpty ? null : query);
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> closeRiderDay(
    String token, {
    required String date,
    String? notes,
  }) async {
    final uri = Uri.parse('$baseUrl/api/orders/rider/close-day');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'date': date,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      }),
    );
    return _handleResponse(response);
  }

  // Store Owner APIs
  static Future<Map<String, dynamic>> getStoreOrders(
    String token, {
    String status = 'all',
  }) async {
    final uri = Uri.parse('$baseUrl/api/orders/store-dashboard?status=$status');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStoreOwnerFinancialHistory(
    String token, {
    String? from,
    String? to,
  }) async {
    final query = <String, String>{};
    if (from != null && from.trim().isNotEmpty) query['from'] = from.trim();
    if (to != null && to.trim().isNotEmpty) query['to'] = to.trim();
    final uri = Uri.parse(
      '$baseUrl/api/orders/store-owner/financial-history',
    ).replace(queryParameters: query.isEmpty ? null : query);
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateOrderStatus(
    String token,
    int orderId,
    String status,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId/status');
    _logger.d('ApiService: PUT $uri');
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'status': status}),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> resetOrderToNew(
    String token,
    int orderId,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId/reset-to-new');
    _logger.d('ApiService: PUT $uri');
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> markOrderAsDelivered(
    String token,
    int orderId,
  ) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId/deliver');
    _logger.d('ApiService: PUT $uri');
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
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
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'payment_status': status}),
    );
    return _handleResponse(response);
  }

  // Wallet APIs
  static Future<Map<String, dynamic>> getWalletBalance(String token) async {
    final uri = Uri.parse('$baseUrl/api/wallet/balance');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
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
    final response = await _get(
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
    final response = await _get(
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
    final response = await _post(
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
    final response = await _post(
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
    final response = await _get(
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
    final response = await _put(
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
    final response = await _delete(
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
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'recipient_id': ?recipientId,
        'email': ?email,
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
    final response = await _get(
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
    final response = await _get(
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
    final response = await _post(
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
    final response = await _post(
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
    final response = await _post(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getInventoryReport(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/inventory-report');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStoreSalesReport(String token) async {
    final uri = Uri.parse('$baseUrl/api/admin/store-sales-report');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getSalesByPaymentReport(
    String token, {
    String? startDate,
    String? endDate,
  }) async {
    final query = <String, String>{};
    if (startDate != null && startDate.isNotEmpty) {
      query['start_date'] = startDate;
    }
    if (endDate != null && endDate.isNotEmpty) {
      query['end_date'] = endDate;
    }
    final uri = Uri.parse(
      '$baseUrl/api/admin/sales-by-payment-report',
    ).replace(queryParameters: query.isEmpty ? null : query);
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStoreOrderBreakdown(
    String token,
  ) async {
    final uri = Uri.parse('$baseUrl/api/admin/store-order-breakdown');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getAdminWallets(
    String token, {
    int page = 1,
    int limit = 500,
  }) async {
    final uri = Uri.parse('$baseUrl/api/admin/wallets?page=$page&limit=$limit');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getUsers(String token) async {
    final uri = Uri.parse('$baseUrl/api/users');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['users'] ?? [];
  }

  static Future<List<dynamic>> getStoresForAdmin(
    String token, {
    bool includeInactive = false,
    bool lite = false,
  }) async {
    final query = <String>[];
    if (includeInactive) query.add('admin=1');
    if (lite) query.add('lite=1');
    final qs = query.isEmpty ? '' : '?${query.join('&')}';
    final uri = Uri.parse('$baseUrl/api/stores$qs');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['stores'] ?? [];
  }

  static Future<Map<String, dynamic>> getStoreOfferCampaigns(
    String token, {
    required int storeId,
  }) async {
    final uri = Uri.parse(
      '$baseUrl/api/stores/offer-campaigns?store_id=$storeId',
    );
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> createStoreOfferCampaign(
    String token, {
    required Map<String, dynamic> payload,
  }) async {
    final uri = Uri.parse('$baseUrl/api/stores/offer-campaigns');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> updateStoreOfferCampaign(
    String token, {
    required int campaignId,
    required Map<String, dynamic> payload,
  }) async {
    final uri = Uri.parse('$baseUrl/api/stores/offer-campaigns/$campaignId');
    _logger.d('ApiService: PUT $uri');
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> deleteStoreOfferCampaign(
    String token, {
    required int campaignId,
  }) async {
    final uri = Uri.parse('$baseUrl/api/stores/offer-campaigns/$campaignId');
    _logger.d('ApiService: DELETE $uri');
    final response = await _delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getProductsForAdmin(String token) async {
    final uri = Uri.parse('$baseUrl/api/products');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['products'] ?? [];
  }

  static Future<List<dynamic>> getProductsForOwner(
    String token,
    int ownerId,
  ) async {
    // Load all stores and filter by owner
    final stores = await getStoresForAdmin(token);
    final ownerStores = stores
        .where((s) => (s['owner_id']?.toString() ?? '') == ownerId.toString())
        .toList();
    if (ownerStores.isEmpty) return [];

    // Fetch products for each store
    final List<dynamic> products = [];
    for (final s in ownerStores) {
      final sid = s['id'];
      if (sid == null) continue;
      final uri = Uri.parse(
        '$baseUrl/api/products?store=$sid&admin=1&include_variants=1',
      );
      _logger.d('ApiService: GET $uri');
      final resp = await _get(uri, headers: {'Authorization': 'Bearer $token'});
      final data = _handleResponse(resp);
      final list = (data['products'] as List<dynamic>? ?? []);
      products.addAll(list);
    }
    return products;
  }

  static Future<Map<String, dynamic>> updateProduct(
    String token, {
    required int productId,
    String? name,
    double? price,
    List<Map<String, dynamic>>? sizeVariants,
    double? costPrice,
    String? discountType,
    double? discountValue,
  }) async {
    final uri = Uri.parse('$baseUrl/api/products/$productId');
    _logger.d('ApiService: PUT $uri');
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name;
    if (price != null) body['price'] = price;
    if (sizeVariants != null) {
      body['size_variants'] = sizeVariants;
    }
    if (costPrice != null) body['cost_price'] = costPrice;
    if (discountType != null) body['discount_type'] = discountType;
    if (discountValue != null) body['discount_value'] = discountValue;

    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(body),
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getRiders(String token) async {
    final uri = Uri.parse('$baseUrl/api/riders');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['riders'] ?? [];
  }

  static Future<Map<String, dynamic>> updateRiderLocation(
    String token, {
    required double latitude,
    required double longitude,
    String? location,
  }) async {
    final uri = Uri.parse('$baseUrl/api/orders/rider/location');
    _logger.d('ApiService: PUT $uri');
    final body = <String, dynamic>{
      'latitude': latitude,
      'longitude': longitude,
    };
    final trimmedLocation = location?.trim();
    if (trimmedLocation != null && trimmedLocation.isNotEmpty) {
      body['location'] = trimmedLocation;
    }
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(body),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getRiderLocationHistory(
    String token, {
    required List<String> riderIds,
    List<String> orderIds = const <String>[],
    int hours = 3,
    int limit = 40,
  }) async {
    final ids = riderIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList(growable: false);
    if (ids.isEmpty) {
      return const {'success': true, 'histories': <String, dynamic>{}};
    }
    final orders = orderIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList(growable: false);

    final uri = Uri.parse('$baseUrl/api/orders/rider/location-history').replace(
      queryParameters: {
        'riderIds': ids.join(','),
        if (orders.isNotEmpty) 'orderIds': orders.join(','),
        'hours': hours.toString(),
        'limit': limit.toString(),
      },
    );
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getRiderTravelSummary(
    String token, {
    required String date,
  }) async {
    final uri = Uri.parse(
      '$baseUrl/api/orders/rider/travel-summary',
    ).replace(queryParameters: {'date': date.trim()});
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<List<dynamic>> getAvailableRiders(String token) async {
    final uri = Uri.parse('$baseUrl/api/orders/available-riders');
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _handleResponse(response);
    return data['riders'] ?? [];
  }

  static Future<Map<String, dynamic>> assignOrderRider(
    String token,
    int orderId,
    int riderId, {
    double? deliveryFee,
  }) async {
    final uri = Uri.parse('$baseUrl/api/orders/$orderId/assign-rider');
    _logger.d('ApiService: PUT $uri');
    final body = <String, dynamic>{'rider_id': riderId};
    if (deliveryFee != null) body['delivery_fee'] = deliveryFee;
    final response = await _put(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(body),
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> getStoreGraceAlerts(
    String token, {
    String channel = 'mobile',
  }) async {
    final safeChannel = channel.toLowerCase() == 'web' ? 'web' : 'mobile';
    final uri = Uri.parse(
      '$baseUrl/api/stores/grace-alerts?channel=$safeChannel',
    );
    _logger.d('ApiService: GET $uri');
    final response = await _get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    return _handleResponse(response);
  }

  static Future<Map<String, dynamic>> muteStoreGraceAlert(
    String token,
    int storeId, {
    int hours = 24,
  }) async {
    final uri = Uri.parse('$baseUrl/api/stores/$storeId/grace-alert-mute');
    _logger.d('ApiService: POST $uri');
    final response = await _post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'hours': hours}),
    );
    return _handleResponse(response);
  }
}
