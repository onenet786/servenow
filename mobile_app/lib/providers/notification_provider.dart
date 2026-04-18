import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import 'auth_provider.dart';

typedef NotificationEventListener = void Function(Map<String, dynamic> event);

class Notification {
  final int id;
  final String title;
  final String message;
  final String type;
  final String icon;
  final DateTime timestamp;
  final Map<String, dynamic>? payload;
  bool unread;

  Notification({
    required this.id,
    required this.title,
    required this.message,
    this.type = 'info',
    this.icon = 'info',
    required this.timestamp,
    this.payload,
    this.unread = true,
  });

  factory Notification.fromJson(Map<String, dynamic> json) {
    return Notification(
      id: json['id'],
      title: json['title'],
      message: json['message'],
      type: json['type'] ?? 'info',
      icon: json['icon'] ?? 'info',
      timestamp: DateTime.parse(json['timestamp']),
      payload:
          json['payload'] is Map
              ? Map<String, dynamic>.from(json['payload'])
              : null,
      unread: json['unread'] ?? true,
    );
  }
}

class NotificationProvider with ChangeNotifier {
  static const String androidChannelId = 'servenow_channel';
  static const String androidChannelName = 'ServeNow Notifications';
  static const String androidChannelDescription =
      'Order updates and app notifications';

  socket_io.Socket? _socket;
  bool _isSocketInitializing = false;
  final GlobalKey<NavigatorState> navigatorKey;
  AuthProvider? _authProvider;
  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  FirebaseMessaging? _firebaseMessaging;
  bool _isFirebaseMessagingReady = false;
  String? _currentPushToken;

  final List<Notification> _notifications = [];
  final Map<Object, NotificationEventListener> _eventListeners = {};
  static const int _maxNotifications = 20;
  static const Duration _duplicateWindow = Duration(seconds: 4);
  String? _lastNotificationKey;
  DateTime? _lastNotificationAt;

  NotificationProvider(this.navigatorKey) {
    _initLocalNotifications();
  }

  void _initLocalNotifications() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings();
    const settings = InitializationSettings(android: androidSettings, iOS: iosSettings);
    
    await _localNotifications.initialize(
      settings,
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload == null || payload.isEmpty) return;
        try {
          final data = jsonDecode(payload);
          if (data is Map<String, dynamic>) {
            _handleNotificationAction(data);
          }
        } catch (_) {}
      },
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            androidChannelId,
            androidChannelName,
            description: androidChannelDescription,
            importance: Importance.max,
          ),
        );
    await _localNotifications
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
    await _initFirebaseMessaging();
  }

  List<Notification> get notifications => _notifications;
  int get unreadCount => _notifications.where((n) => n.unread).length;

  void addEventListener(Object owner, NotificationEventListener listener) {
    _eventListeners[owner] = listener;
  }

  void removeEventListener(Object owner) {
    _eventListeners.remove(owner);
  }

  void addNotification({
    required String title,
    required String message,
    String type = 'info',
    String icon = 'info',
    bool persistUntilDismissed = false,
    Map<String, dynamic>? payload,
  }) {
    final key = '${title.trim()}|${message.trim()}|$type';
    final now = DateTime.now();
    if (_lastNotificationKey == key &&
        _lastNotificationAt != null &&
        now.difference(_lastNotificationAt!) <= _duplicateWindow) {
      debugPrint('[NotificationProvider] Duplicate notification suppressed: $key');
      return;
    }
    _lastNotificationKey = key;
    _lastNotificationAt = now;
    final notificationId =
        payload == null || payload.isEmpty
            ? now.millisecondsSinceEpoch.remainder(2147483647)
            : (jsonEncode(payload).hashCode & 0x7fffffff);

    final notification = Notification(
      id: notificationId,
      title: title,
      message: message,
      type: type,
      icon: icon,
      timestamp: now,
      payload: payload,
      unread: true,
    );

    _notifications.insert(0, notification);

    if (_notifications.length > _maxNotifications) {
      _notifications.removeRange(_maxNotifications, _notifications.length);
    }

    notifyListeners();
    _showForegroundNotification(
      notificationId,
      title,
      message,
      persistUntilDismissed: persistUntilDismissed,
      payload: payload,
    );
  }

  void clearNotifications() {
    _notifications.clear();
    notifyListeners();
  }

  Future<void> removeNotificationsWhere(
    bool Function(Notification notification) test,
  ) async {
    final removed = _notifications.where(test).toList(growable: false);
    if (removed.isEmpty) return;

    _notifications.removeWhere(test);
    notifyListeners();

    for (final notification in removed) {
      try {
        await _localNotifications.cancel(notification.id);
      } catch (_) {}
    }
  }

  void markAsRead(int notificationId) {
    final index = _notifications.indexWhere((n) => n.id == notificationId);
    if (index != -1) {
      _notifications[index].unread = false;
      notifyListeners();
    }
  }

  void update(AuthProvider auth) {
    _authProvider = auth;
    _updateSocketConnection();
    _syncPushToken();
  }

  Future<void> _initFirebaseMessaging() async {
    if (_isFirebaseMessagingReady) return;
    if (kIsWeb) return;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
    } catch (_) {
      // Firebase may already be initialized or pending native config.
      return;
    }

    try {
      _firebaseMessaging = FirebaseMessaging.instance;
      await _firebaseMessaging!.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      _isFirebaseMessagingReady = true;

      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        final n = message.notification;
        final title =
            n?.title ??
            message.data['title']?.toString() ??
            'ServeNow Notification';
        final body =
            n?.body ?? message.data['message']?.toString() ?? '';
        addNotification(
          title: title,
          message: body,
          type: message.data['type']?.toString() ?? 'info',
          icon:
              message.data['type'] == 'app_update_available'
                  ? 'system_update'
                  : 'notifications',
          persistUntilDismissed:
              message.data['type']?.toString() == 'app_update_available',
          payload: Map<String, dynamic>.from(message.data),
        );
      });

      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        _handleNotificationAction(Map<String, dynamic>.from(message.data));
      });

      final initialMessage = await _firebaseMessaging!.getInitialMessage();
      if (initialMessage != null) {
        _handleNotificationAction(
          Map<String, dynamic>.from(initialMessage.data),
        );
      }

      _firebaseMessaging!.onTokenRefresh.listen((token) {
        _currentPushToken = token;
        _syncPushToken();
      });
    } catch (e) {
      debugPrint('[NotificationProvider] Firebase messaging init failed: $e');
    }
  }

  String _platformName() {
    if (kIsWeb) return 'web';
    if (defaultTargetPlatform == TargetPlatform.iOS) return 'ios';
    if (defaultTargetPlatform == TargetPlatform.android) return 'android';
    return 'unknown';
  }

  Future<void> _syncPushToken() async {
    try {
      if (!_isFirebaseMessagingReady) {
        await _initFirebaseMessaging();
      }
      if (!_isFirebaseMessagingReady || _firebaseMessaging == null) return;
      if (_authProvider == null || !_authProvider!.isAuthenticated) return;
      if (_authProvider!.isGuest) return;
      final authToken = _authProvider!.token;
      if (authToken == null || authToken.trim().isEmpty) return;

      final pushToken = _currentPushToken ?? await _firebaseMessaging!.getToken();
      if (pushToken == null || pushToken.trim().isEmpty) return;
      _currentPushToken = pushToken;

      final prefs = await SharedPreferences.getInstance();
      final oldToken = prefs.getString('push_token');
      if (oldToken != null &&
          oldToken.isNotEmpty &&
          oldToken != pushToken &&
          authToken.isNotEmpty) {
        try {
          await ApiService.unregisterPushDeviceToken(
            authToken,
            deviceToken: oldToken,
          );
        } catch (_) {}
      }

      await ApiService.registerPushDeviceToken(
        authToken,
        deviceToken: pushToken,
        platform: _platformName(),
      );
      await prefs.setString('push_token', pushToken);
    } catch (e) {
      debugPrint('[NotificationProvider] Push token sync failed: $e');
    }
  }

  void _updateSocketConnection() {
    // Connect if user is authenticated (Admin, Rider, or User)
    if (_authProvider != null &&
        _authProvider!.isAuthenticated &&
        !_authProvider!.isGuest) {
      if (_socket == null) {
        _initSocket();
      } else if (_socket!.connected) {
        _identifyUser();
      } else if (!_isSocketInitializing) {
        debugPrint('[NotificationProvider] Socket exists but not connected, reconnecting...');
        _socket!.connect();
      }
    } else {
      _disconnectSocket();
    }
  }

  void _disconnectSocket() {
    if (_socket != null) {
      _socket!.disconnect();
      _socket = null;
    }
    _isSocketInitializing = false;
  }

  void _identifyUser() {
    if (_socket == null || !_socket!.connected) {
      debugPrint(
        '[NotificationProvider] Socket not connected, cannot identify user',
      );
      return;
    }

    if (_authProvider != null && _authProvider!.user != null) {
      final userId = _authProvider!.user!.id;
      final userType = _authProvider!.user!.userType;

      _socket!.emit('identify_user', {
        'user_id': userId,
        'user_type': userType,
      });
      debugPrint(
        '[NotificationProvider] User identified: ID=$userId, Type=$userType, SocketID=${_socket?.id}',
      );
    } else {
      debugPrint(
        '[NotificationProvider] Cannot identify: auth or user not available',
      );
    }
  }

  Map<String, dynamic> _normalizeSocketPayload(dynamic data) {
    if (data is Map<String, dynamic>) return Map<String, dynamic>.from(data);
    if (data is Map) return Map<String, dynamic>.from(data);
    return {'value': data};
  }

  void _emitSocketEvent(String eventName, dynamic data) {
    if (_eventListeners.isEmpty) return;

    final payload = _normalizeSocketPayload(data);
    final event = <String, dynamic>{
      ...payload,
      'event': eventName,
      'socket_event': eventName,
      'data': Map<String, dynamic>.from(payload),
    };
    final currentType = (event['type'] ?? '').toString().trim();
    if (currentType.isEmpty) {
      event['type'] = eventName;
    }

    for (final listener in List<NotificationEventListener>.from(
      _eventListeners.values,
    )) {
      try {
        listener(Map<String, dynamic>.from(event));
      } catch (e) {
        debugPrint(
          '[NotificationProvider] Event listener failed for $eventName: $e',
        );
      }
    }
  }

  void _initSocket() {
    if (_socket != null) {
      if (_socket!.connected) {
        _identifyUser();
        return;
      }
      if (_isSocketInitializing) return;
      debugPrint('[NotificationProvider] Reusing existing socket, attempting connect...');
      _isSocketInitializing = true;
      _socket!.connect();
      return;
    }
    if (_isSocketInitializing) return;
    _isSocketInitializing = true;

    // Normalize base URL to origin for socket.io (strip any path like /api)
    String baseUrl = ApiService.baseUrl;
    try {
      final uri = Uri.parse(baseUrl);
      final origin =
          '${uri.scheme.isEmpty ? 'http' : uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
      baseUrl = origin.endsWith('/')
          ? origin.substring(0, origin.length - 1)
          : origin;
    } catch (e) {
      debugPrint(
        '[NotificationProvider] Invalid baseUrl "$baseUrl", using as-is. Error: $e',
      );
      if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.substring(0, baseUrl.length - 1);
      }
    }

    debugPrint(
      '[NotificationProvider] Initializing socket connection to: $baseUrl',
    );

    _socket = socket_io.io(
      baseUrl,
      socket_io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(5000)
          .setReconnectionAttempts(20)
          .build(),
    );

    _socket!.connect();

    _socket!.onConnect((_) {
      _isSocketInitializing = false;
      debugPrint('[NotificationProvider] Socket connected: ${_socket?.id}');
      _identifyUser();
    });

    _socket!.onReconnect((_) {
      debugPrint('[NotificationProvider] Socket reconnected: ${_socket?.id}');
      _identifyUser();
    });
    _socket!.onReconnectAttempt((attempt) {
      debugPrint(
        '[NotificationProvider] Socket reconnect attempt: $attempt to $baseUrl',
      );
    });

    _socket!.onConnectError((data) {
      _isSocketInitializing = false;
      debugPrint(
        '[NotificationProvider] Socket connection error to $baseUrl: $data',
      );
    });

    _socket!.onError((data) {
      debugPrint('[NotificationProvider] Socket error: $data');
    });

    _socket!.onDisconnect((_) {
      _isSocketInitializing = false;
      debugPrint('[NotificationProvider] Socket disconnected');
    });

    _socket!.on('new_user', (data) {
      _emitSocketEvent('new_user', data);
      debugPrint('Socket: new_user received');
      if (_authProvider?.isAdmin == true) {
        addNotification(
          title: 'New User Registered',
          message:
              '${data['first_name']} ${data['last_name']} (${data['user_type']}) has joined.',
          type: 'success',
          icon: 'person_add',
        );
      }
    });

    _socket!.on('new_order', (data) {
      _emitSocketEvent('new_order', data);
      debugPrint('Socket: new_order received');
      if (_authProvider?.isAdmin == true) {
        addNotification(
          title: 'New Order Placed',
          message:
              'Order #${data['order_number']} received. Total: PKR ${data['total_amount']}',
          type: 'success',
          icon: 'shopping_bag',
        );
      }
    });

    _socket!.on('order_assigned', (data) {
      _emitSocketEvent('order_assigned', data);
      debugPrint('Socket: order_assigned received');
      if (_authProvider?.isAdmin == true) {
        addNotification(
          title: 'Order Assigned',
          message:
              'Order #${data['order_number']} assigned to ${data['rider_name']}',
          type: 'info',
          icon: 'assignment',
        );
      }
    });

    _socket!.on('order_status_update', (data) {
      _emitSocketEvent('order_status_update', data);
      debugPrint(
        'Socket: order_status_update received for user ${data['user_id']}',
      );
      if (_authProvider?.isAdmin == true) {
        String icon = 'schedule';
        if (data['status'] == 'delivered') icon = 'check_circle';
        if (data['status'] == 'confirmed') icon = 'check';

        addNotification(
          title:
              'Order ${data['status']?.toString().toUpperCase() ?? 'UPDATED'}',
          message: 'Order #${data['order_number']}',
          type: 'info',
          icon: icon,
        );
      } else if (_authProvider?.user?.id.toString() ==
          data['user_id'].toString()) {
        String icon = 'schedule';
        if (data['status'] == 'delivered') icon = 'check_circle';
        if (data['status'] == 'confirmed') icon = 'check';

        addNotification(
          title:
              'Order ${data['status']?.toString().toUpperCase() ?? 'UPDATED'}',
          message: 'Your order #${data['order_number']}',
          type: 'info',
          icon: icon,
        );
      }
    });

    _socket!.on('rider_location_update', (data) {
      _emitSocketEvent('rider_location_update', data);
      debugPrint(
        'Socket: rider_location_update received for rider ${data['rider_id']}',
      );
    });

    _socket!.on('notification', (data) {
      _emitSocketEvent('notification', data);
      debugPrint('Socket: notification received: $data');
      // Generic handler for targeted notifications
      addNotification(
        title: data['title'] ?? 'Notification',
        message: data['message'] ?? '',
        type: data['type'] ?? 'info',
        icon: 'notifications',
      );
    });

    _socket!.on('rider_notification', (data) {
      _emitSocketEvent('rider_notification', data);
      final riderId = data['rider_id'].toString();
      final currentUserId = _authProvider?.user?.id.toString();
      debugPrint(
        '[NotificationProvider] rider_notification: received=$riderId, currentUser=$currentUserId, isRider=${_authProvider?.isRider}',
      );

      if (_authProvider?.isRider == true && currentUserId == riderId) {
        debugPrint('[NotificationProvider] Showing rider notification');
        addNotification(
          title: 'New Assignment',
          message: data['message'] ?? 'You have a new order assignment.',
          type: 'info',
          icon: 'assignment_turned_in',
        );
      } else {
        debugPrint(
          '[NotificationProvider] Rider notification filtered out - not matching rider',
        );
      }
    });

    _socket!.on('user_notification', (data) {
      _emitSocketEvent('user_notification', data);
      final userId = data['user_id'].toString();
      final currentUserId = _authProvider?.user?.id.toString();
      debugPrint(
        '[NotificationProvider] user_notification: received=$userId, currentUser=$currentUserId',
      );

      // If type is 'refresh_orders', we don't show a notification, just consume it (UI will refresh)
      // BUT if the app is in background, we might want to show it?
      // The user requested: "send system notification which shown if application is closed"
      // So we should show it if the type implies an update.
      // However, for 'refresh_orders' with empty message (from my previous fix), we skip it.
      if (data['type'] == 'refresh_orders' && (data['message'] == null || data['message'].toString().isEmpty)) {
          return;
      }

      if (currentUserId == userId) {
        debugPrint('[NotificationProvider] Showing user notification');
        final notificationType =
            (data['type'] ?? 'info').toString().trim().toLowerCase();
        final isCustomerFlash = notificationType == 'customer_flash_message';
        final title =
            isCustomerFlash
                ? (data['title'] ?? 'ServeNow Update').toString()
                : (data['title'] ?? 'Order Update').toString();
        final message =
            isCustomerFlash
                ? (data['message'] ?? 'Please check the latest update.').toString()
                : (data['message'] ?? 'Your order has been updated.').toString();
        addNotification(
          title: title,
          message: message,
          type: notificationType.isEmpty ? 'info' : notificationType,
          icon: isCustomerFlash ? 'campaign' : 'inventory_2',
          payload:
              data is Map<String, dynamic> ? Map<String, dynamic>.from(data) : null,
        );
      } else {
        debugPrint(
          '[NotificationProvider] User notification filtered out - not matching user',
        );
      }
    });

    _socket!.on('store_owner_notification', (data) {
      _emitSocketEvent('store_owner_notification', data);
      final storeId = data['store_id'].toString();
      debugPrint(
        '[NotificationProvider] store_owner_notification (store $storeId): $data',
      );

      // Skip silent refresh
      if (data['type'] == 'silent_refresh') return;

      addNotification(
        title: 'Store Order Update',
        message: data['message'] ?? 'New update for your store.',
        type: 'info', // You can change this based on data['type']
        icon:
            'store', // Need to make sure 'store' icon is handled or use 'inventory_2'
      );
    });

    _socket!.on('payment_status_update', (data) {
      _emitSocketEvent('payment_status_update', data);
      debugPrint(
        'Socket: payment_status_update received for user ${data['user_id']}',
      );
      if (_authProvider?.isAdmin == true) {
        addNotification(
          title:
              'Payment ${data['payment_status'] == 'paid' ? 'Received' : 'Update'}',
          message: 'Order #${data['order_number']}',
          type: data['payment_status'] == 'paid' ? 'success' : 'info',
          icon: data['payment_status'] == 'paid' ? 'check_circle' : 'payment',
        );
      } else if (_authProvider?.user?.id.toString() ==
          data['user_id'].toString()) {
        addNotification(
          title:
              'Payment ${data['payment_status'] == 'paid' ? 'Received' : 'Update'}',
          message: 'Order #${data['order_number']}',
          type: data['payment_status'] == 'paid' ? 'success' : 'info',
          icon: data['payment_status'] == 'paid' ? 'check_circle' : 'payment',
        );
      }
    });

    _socket!.on('order_completed', (data) {
      _emitSocketEvent('order_completed', data);
      debugPrint(
        'Socket: order_completed received for user ${data['user_id']}',
      );
      if (_authProvider?.isAdmin == true) {
        addNotification(
          title: 'Order Fully Completed',
          message: 'Order #${data['order_number']}',
          type: 'success',
          icon: 'task_alt',
        );
      } else if (_authProvider?.user?.id.toString() ==
          data['user_id'].toString()) {
        addNotification(
          title: 'Order Completed',
          message:
              data['message'] ?? 'Your order has been delivered. Thank you!',
          type: 'success',
          icon: 'check_circle',
        );
      }
    });

    _socket!.onDisconnect((_) => debugPrint('Socket disconnected'));
  }

  Future<void> _showForegroundNotification(
    int notificationId,
    String title,
    String message, {
    bool persistUntilDismissed = false,
    Map<String, dynamic>? payload,
  }) async {
    try {
      final androidDetails = AndroidNotificationDetails(
        androidChannelId,
        androidChannelName,
        channelDescription: androidChannelDescription,
        importance: Importance.max,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
        autoCancel: !persistUntilDismissed,
        ongoing: persistUntilDismissed,
      );
      const iosDetails = DarwinNotificationDetails();
      final details = NotificationDetails(
        android: androidDetails,
        iOS: iosDetails,
      );

      await _localNotifications.show(
        notificationId,
        title,
        message,
        details,
        payload:
            payload == null || payload.isEmpty ? null : jsonEncode(payload),
      );
    } catch (e) {
      debugPrint('[NotificationProvider] Foreground notification failed: $e');
    }
  }

  Future<void> _handleNotificationAction(Map<String, dynamic> data) async {
    final type = (data['type'] ?? '').toString().trim().toLowerCase();
    if (type != 'app_update_available') return;

    final packageId =
        (data['android_package'] ?? 'com.onenetsol.servenow').toString().trim();
    final playStoreUrl =
        (data['play_store_url'] ??
                'https://play.google.com/store/apps/details?id=$packageId')
            .toString()
            .trim();

    Uri? primaryUri;
    Uri? fallbackUri;

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      primaryUri = Uri.parse('market://details?id=$packageId');
      fallbackUri = Uri.parse(playStoreUrl);
    } else {
      primaryUri = Uri.parse(playStoreUrl);
    }

    try {
      if (await launchUrl(primaryUri, mode: LaunchMode.externalApplication)) {
        return;
      }
    } catch (_) {}

    if (fallbackUri != null) {
      try {
        await launchUrl(fallbackUri, mode: LaunchMode.externalApplication);
      } catch (_) {}
    }
  }

  @override
  void dispose() {
    _disconnectSocket();
    super.dispose();
  }
}
