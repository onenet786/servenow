import 'dart:async';

import 'package:background_location_2/background_location.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';

class RiderBackgroundTrackingService {
  RiderBackgroundTrackingService._();

  static final RiderBackgroundTrackingService instance =
      RiderBackgroundTrackingService._();

  static const String _tokenKey = 'rider_background_tracking_token';
  static const String _enabledKey = 'rider_background_tracking_enabled';
  static const String _lastLatKey = 'rider_background_tracking_last_lat';
  static const String _lastLngKey = 'rider_background_tracking_last_lng';
  static const String _lastSentAtKey = 'rider_background_tracking_last_sent_at';

  bool _listenerAttached = false;
  bool _isSending = false;
  bool _isTogglingService = false;
  double? _lastLatitude;
  double? _lastLongitude;
  DateTime? _lastSentAt;
  double? _pendingLatitude;
  double? _pendingLongitude;
  bool _pendingForce = false;

  Future<void> updateToken(String token) async {
    final trimmedToken = token.trim();
    if (trimmedToken.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, trimmedToken);
  }

  Future<void> start(String token) async {
    final trimmedToken = token.trim();
    if (trimmedToken.isEmpty || kIsWeb) return;

    final prefs = await SharedPreferences.getInstance();
    await updateToken(trimmedToken);
    await prefs.setBool(_enabledKey, true);
    await _loadLastSentState(prefs);

    if (_isTogglingService) return;
    _isTogglingService = true;
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;

      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }

      if (!_listenerAttached) {
        BackgroundLocation.getLocationUpdates((location) {
          unawaited(_handleLocationUpdate(location));
        });
        _listenerAttached = true;
      }

      if (defaultTargetPlatform == TargetPlatform.android) {
        await BackgroundLocation.setAndroidNotification(
          title: 'ServeNow rider tracking',
          message: 'Live delivery tracking is active in the background.',
          icon: '@mipmap/ic_launcher',
          channelID: 'servenow_rider_tracking',
          actionText: 'Open',
        );
        await BackgroundLocation.setAndroidConfiguration(5000);
      }

      final isRunning = await BackgroundLocation.isServiceRunning();
      if (!isRunning) {
        await BackgroundLocation.startLocationService(
          distanceFilter: 3,
          interval: 5000,
          fastestInterval: 2500,
          forceAndroidLocationManager: false,
          startOnBoot: false,
        );
      }
    } on PlatformException {
      // Rider login should not fail just because runtime location permission
      // has not been granted yet. The dashboard can request it later.
    } finally {
      _isTogglingService = false;
    }
  }

  Future<void> stop({bool clearToken = false}) async {
    if (kIsWeb) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, false);
    if (clearToken) {
      await prefs.remove(_tokenKey);
    }

    if (_isTogglingService) return;
    _isTogglingService = true;
    try {
      final isRunning = await BackgroundLocation.isServiceRunning();
      if (isRunning) {
        await BackgroundLocation.stopLocationService();
      }
    } finally {
      _isTogglingService = false;
    }
  }

  Future<void> syncCurrentLocationNow() async {
    if (kIsWeb) return;
    final token = await _loadTokenIfEnabled();
    if (token == null) return;

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;

      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation,
        ),
      );
      await _sendCoordinates(
        token,
        latitude: position.latitude,
        longitude: position.longitude,
        force: true,
      );
    } on PlatformException {
      return;
    }
  }

  Future<void> syncPosition(
    Position position, {
    bool force = false,
  }) async {
    if (kIsWeb) return;
    final token = await _loadTokenIfEnabled();
    if (token == null) return;

    await _sendCoordinates(
      token,
      latitude: position.latitude,
      longitude: position.longitude,
      force: force,
    );
  }

  Future<void> _handleLocationUpdate(Location location) async {
    final token = await _loadTokenIfEnabled();
    if (token == null) return;

    await _sendCoordinates(
      token,
      latitude: location.latitude,
      longitude: location.longitude,
    );
  }

  Future<String?> _loadTokenIfEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_enabledKey) ?? false;
    if (!enabled) return null;
    final token = prefs.getString(_tokenKey)?.trim();
    if (token == null || token.isEmpty) return null;
    await _loadLastSentState(prefs);
    return token;
  }

  Future<void> _loadLastSentState(SharedPreferences prefs) async {
    _lastLatitude ??= prefs.getDouble(_lastLatKey);
    _lastLongitude ??= prefs.getDouble(_lastLngKey);
    if (_lastSentAt == null) {
      final raw = prefs.getString(_lastSentAtKey);
      if (raw != null && raw.trim().isNotEmpty) {
        _lastSentAt = DateTime.tryParse(raw)?.toLocal();
      }
    }
  }

  Future<void> _sendCoordinates(
    String token, {
    required double latitude,
    required double longitude,
    bool force = false,
  }) async {
    if (_isSending) {
      _pendingLatitude = latitude;
      _pendingLongitude = longitude;
      _pendingForce = _pendingForce || force;
      return;
    }

    final movedEnough =
        _lastLatitude == null ||
        _lastLongitude == null ||
        Geolocator.distanceBetween(
              _lastLatitude!,
              _lastLongitude!,
              latitude,
              longitude,
            ) >=
            3;
    final staleEnough =
        _lastSentAt == null ||
        DateTime.now().difference(_lastSentAt!) >= const Duration(seconds: 5);

    if (!force && !movedEnough && !staleEnough) {
      return;
    }

    _isSending = true;
    try {
      final coordinateLabel =
          '${latitude.toStringAsFixed(4)}, ${longitude.toStringAsFixed(4)}';
      await ApiService.updateRiderLocation(
        token,
        latitude: latitude,
        longitude: longitude,
        location: coordinateLabel,
      );

      _lastLatitude = latitude;
      _lastLongitude = longitude;
      _lastSentAt = DateTime.now();

      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_lastLatKey, latitude);
      await prefs.setDouble(_lastLngKey, longitude);
      await prefs.setString(_lastSentAtKey, _lastSentAt!.toIso8601String());
    } finally {
      _isSending = false;

      final pendingLatitude = _pendingLatitude;
      final pendingLongitude = _pendingLongitude;
      final pendingForce = _pendingForce;
      _pendingLatitude = null;
      _pendingLongitude = null;
      _pendingForce = false;

      if (pendingLatitude != null && pendingLongitude != null) {
        unawaited(
          _sendCoordinates(
            token,
            latitude: pendingLatitude,
            longitude: pendingLongitude,
            force: pendingForce,
          ),
        );
      }
    }
  }
}
