import 'dart:async';

import 'package:flutter_map/flutter_map.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:latlong2/latlong.dart' as latlng;
import 'package:logger/logger.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/notification_provider.dart';
import '../services/api_service.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/notification_bell_widget.dart';
import 'customer_tile_demo_screen.dart';
import 'offer_campaigns_screen.dart';

class _LiveRiderTrackerPayload {
  const _LiveRiderTrackerPayload({
    required this.trails,
    required this.speedsMph,
  });

  final Map<String, List<latlng.LatLng>> trails;
  final Map<String, double> speedsMph;
}

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen>
    with TickerProviderStateMixin {
  static const Set<String> _liveRiderTrackerEmails = {
    'admin@servenow.com',
    'nazir@servenow.pk',
  };
  static const Duration _liveRiderRefreshInterval = Duration(seconds: 4);
  static const Duration _riderMotionDuration = Duration(milliseconds: 3600);
  static const Duration _liveRiderStaleAfter = Duration(minutes: 10);
  static const List<Color> _riderRoutePalette = [
    Color(0xFF2563EB),
    Color(0xFFDC2626),
    Color(0xFF16A34A),
    Color(0xFFD97706),
    Color(0xFF7C3AED),
    Color(0xFFDB2777),
    Color(0xFF0891B2),
    Color(0xFF4F46E5),
  ];

  final Logger _logger = Logger();
  bool _isLoading = true;
  Timer? _liveStatsTimer;
  Timer? _liveRiderTimer;
  Timer? _graceAlertTimer;
  final Map<String, DateTime> _lastGraceAlertAt = {};
  late final AnimationController _riderMotionController;
  final MapController _liveRiderMapController = MapController();
  final Map<String, latlng.LatLng> _displayedRiderPositions = {};
  final Map<String, latlng.LatLng> _motionStartPositions = {};
  final Map<String, latlng.LatLng> _motionTargetPositions = {};
  final Map<String, String> _liveLocationNameByRider = {};
  final Map<String, double> _liveRiderSpeedsMphById = {};
  final Map<String, String> _reverseGeocodeCache = {};
  final Set<String> _pendingReverseGeocodeKeys = {};

  int _todayTotal = 0;
  int _todayDelivered = 0;
  int _todayPending = 0;
  int _todayCancelled = 0;

  int _allTotal = 0;
  int _allDelivered = 0;
  int _allPending = 0;
  int _allCancelled = 0;

  int _activeUsers = 0;
  int _todayLogins = 0;

  List<dynamic> _recentOrdersList = [];
  List<dynamic> _recentUsersList = [];
  List<dynamic> _recentStoresList = [];
  List<dynamic> _assignableOrdersList = [];
  List<Map<String, dynamic>> _liveRiderLocations = [];
  Map<String, List<latlng.LatLng>> _liveRiderTrails = {};
  String? _selectedLiveRiderId;
  String _selectedActivityType = 'orders';
  bool _isUrdu = false;

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) {
    const localTranslations = <String, String>{
      'Live Rider Tracker': 'لائیو رائیڈر ٹریکر',
      'Auto-refreshing rider positions for active deliveries':
          'فعال ڈلیوریوں کے لیے رائیڈر کی پوزیشن خودکار طور پر تازہ ہو رہی ہے',
      'Select Rider': 'رائیڈر منتخب کریں',
      'All riders': 'تمام رائیڈرز',
      'Back to all riders': 'تمام رائیڈرز پر واپس',
      'Routes': 'روٹس',
      'Assigned Order': 'تعین شدہ آرڈر',
      'Trail Points': 'ٹریل پوائنٹس',
      'Distance': 'فاصلہ',
      'ETA': 'متوقع وقت',
      'Location': 'موقع',
      'Coordinates': 'کوآرڈینیٹس',
      'No riders are currently sharing live locations':
          'اس وقت کوئی رائیڈر اپنی لائیو لوکیشن شیئر نہیں کر رہا',
    };
    if (_isUrdu && localTranslations.containsKey(text)) {
      return localTranslations[text]!;
    }
    return CustomerLanguage.tr(_isUrdu, text);
  }

  int _toInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.round();
    if (value is String) return int.tryParse(value.trim()) ?? 0;
    return 0;
  }

  int _readFirstInt(Map<String, dynamic> src, List<String> keys) {
    for (final key in keys) {
      if (src.containsKey(key) && src[key] != null) {
        return _toInt(src[key]);
      }
    }
    return 0;
  }

  bool _canViewLiveRiderTracker(String? email) {
    final normalized = (email ?? '').trim().toLowerCase();
    return _liveRiderTrackerEmails.contains(normalized);
  }

  bool _isLiveTrackableOrderStatus(String status) {
    switch (status.trim().toLowerCase()) {
      case 'confirmed':
      case 'preparing':
      case 'ready':
      case 'ready_for_pickup':
      case 'picked_up':
      case 'out_for_delivery':
        return true;
      default:
        return false;
    }
  }

  List<Map<String, dynamic>> _extractLiveRiderLocations(List<dynamic> orders) {
    final latestPerRider = <String, Map<String, dynamic>>{};
    final now = DateTime.now();

    for (final raw in orders) {
      if (raw is! Map) continue;
      final order = raw.cast<String, dynamic>();
      final status = (order['status'] ?? '').toString().toLowerCase();
      if (!_isLiveTrackableOrderStatus(status)) continue;

      final riderId = (order['rider_id'] ?? '').toString().trim();
      if (riderId.isEmpty) continue;

      final latitude = double.tryParse(
        (order['rider_latitude'] ?? '').toString(),
      );
      final longitude = double.tryParse(
        (order['rider_longitude'] ?? '').toString(),
      );
      if (latitude == null || longitude == null) continue;

      DateTime createdAt = DateTime.fromMillisecondsSinceEpoch(0);
      try {
        createdAt = DateTime.parse(
          (order['updated_at'] ?? order['created_at'] ?? '').toString(),
        );
      } catch (_) {}
      if (now.difference(createdAt.toLocal()) > _liveRiderStaleAfter) {
        continue;
      }

      final riderName =
          '${order['rider_first_name'] ?? ''} ${order['rider_last_name'] ?? ''}'
              .trim();
      final riderKey = riderId;
      final existing = latestPerRider[riderKey];
      if (existing != null) {
        final existingAt = existing['createdAt'] as DateTime?;
        if (existingAt != null && !createdAt.isAfter(existingAt)) {
          continue;
        }
      }

      latestPerRider[riderKey] = {
        'riderId': riderId,
        'riderName': riderName.isEmpty ? 'Rider #$riderId' : riderName,
        'orderNumber': (order['order_number'] ?? '').toString(),
        'storeName': (order['store_name'] ?? '').toString(),
        'locationLabel': (order['rider_location'] ?? '').toString().trim(),
        'storeLatitude': double.tryParse(
          (order['store_latitude'] ?? '').toString(),
        ),
        'storeLongitude': double.tryParse(
          (order['store_longitude'] ?? '').toString(),
        ),
        'status': status,
        'latitude': latitude,
        'longitude': longitude,
        'createdAt': createdAt,
      };
    }

    final items = latestPerRider.values.toList()
      ..sort((a, b) {
        final aAt =
            a['createdAt'] as DateTime? ??
            DateTime.fromMillisecondsSinceEpoch(0);
        final bAt =
            b['createdAt'] as DateTime? ??
            DateTime.fromMillisecondsSinceEpoch(0);
        return bAt.compareTo(aAt);
      });
    return items;
  }

  bool _isRiderFresh(Map<String, dynamic> rider) {
    final updatedAt = rider['createdAt'] as DateTime?;
    if (updatedAt == null) return false;
    return DateTime.now().difference(updatedAt.toLocal()) <=
        _liveRiderStaleAfter;
  }

  DateTime? _parseLiveTrackingTime(dynamic value) {
    if (value == null) return null;
    if (value is DateTime) return value.toLocal();
    final text = value.toString().trim();
    if (text.isEmpty) return null;
    try {
      return DateTime.parse(text).toLocal();
    } catch (_) {
      return null;
    }
  }

  double? _estimateRiderSpeedMph(List<Map<String, dynamic>> telemetry) {
    if (telemetry.length < 2) return null;

    final distance = latlng.Distance();
    for (var index = telemetry.length - 1; index > 0; index--) {
      final current = telemetry[index];
      final previous = telemetry[index - 1];
      final currentPoint = current['point'] as latlng.LatLng?;
      final previousPoint = previous['point'] as latlng.LatLng?;
      final currentTime = current['timestamp'] as DateTime?;
      final previousTime = previous['timestamp'] as DateTime?;
      if (currentPoint == null ||
          previousPoint == null ||
          currentTime == null ||
          previousTime == null) {
        continue;
      }

      final seconds = currentTime.difference(previousTime).inSeconds;
      if (seconds <= 0 || seconds > 20 * 60) continue;

      final meters = distance(previousPoint, currentPoint);
      if (meters < 10) continue;

      final mph = (meters / seconds) * 2.23693629;
      if (!mph.isFinite || mph <= 0) continue;
      return mph.clamp(0, 80).toDouble();
    }
    return null;
  }

  Future<_LiveRiderTrackerPayload> _fetchLiveRiderTrails(
    String token,
    List<Map<String, dynamic>> riders,
  ) async {
    final riderIds = riders
        .map((rider) => (rider['riderId'] ?? '').toString().trim())
        .where((id) => id.isNotEmpty)
        .toList(growable: false);
    if (riderIds.isEmpty) {
      return const _LiveRiderTrackerPayload(
        trails: <String, List<latlng.LatLng>>{},
        speedsMph: <String, double>{},
      );
    }

    final response = await ApiService.getRiderLocationHistory(
      token,
      riderIds: riderIds,
      hours: 3,
      limit: 40,
    );
    final rawHistories =
        (response['histories'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};

    final trails = <String, List<latlng.LatLng>>{};
    final speedsMph = <String, double>{};
    for (final rider in riders) {
      final riderId = (rider['riderId'] ?? '').toString().trim();
      if (riderId.isEmpty) continue;

      final points = <latlng.LatLng>[];
      final telemetry = <Map<String, dynamic>>[];
      final entries = rawHistories[riderId];
      if (entries is List) {
        for (final raw in entries) {
          if (raw is! Map) continue;
          final entry = raw.cast<String, dynamic>();
          final latitude = double.tryParse(
            (entry['latitude'] ?? '').toString(),
          );
          final longitude = double.tryParse(
            (entry['longitude'] ?? '').toString(),
          );
          if (latitude == null || longitude == null) continue;
          final point = latlng.LatLng(latitude, longitude);
          _appendTrailPoint(points, point);
          telemetry.add({
            'point': point,
            'timestamp': _parseLiveTrackingTime(entry['created_at']),
          });
        }
      }

      final currentLatitude = rider['latitude'] as double?;
      final currentLongitude = rider['longitude'] as double?;
      if (currentLatitude != null && currentLongitude != null) {
        final point = latlng.LatLng(currentLatitude, currentLongitude);
        _appendTrailPoint(points, point);
        telemetry.add({
          'point': point,
          'timestamp': rider['createdAt'] as DateTime?,
        });
      }

      if (points.isNotEmpty) {
        trails[riderId] = points;
      }
      final speedMph = _estimateRiderSpeedMph(telemetry);
      if (speedMph != null) {
        speedsMph[riderId] = speedMph;
      }
    }

    return _LiveRiderTrackerPayload(trails: trails, speedsMph: speedsMph);
  }

  void _appendTrailPoint(List<latlng.LatLng> points, latlng.LatLng point) {
    if (points.isEmpty) {
      points.add(point);
      return;
    }

    final last = points.last;
    final samePoint =
        (last.latitude - point.latitude).abs() < 0.000001 &&
        (last.longitude - point.longitude).abs() < 0.000001;
    if (!samePoint) {
      points.add(point);
    }
  }

  Color _routeColorForRider(String riderId) {
    final normalized = riderId.trim();
    if (normalized.isEmpty) return _riderRoutePalette.first;
    final hash = normalized.codeUnits.fold<int>(
      0,
      (value, code) => (value * 31 + code) & 0x7fffffff,
    );
    return _riderRoutePalette[hash % _riderRoutePalette.length];
  }

  latlng.LatLng? _resolveRiderStartPoint(Map<String, dynamic> rider) {
    final storeLatitude = rider['storeLatitude'] as double?;
    final storeLongitude = rider['storeLongitude'] as double?;
    if (storeLatitude != null && storeLongitude != null) {
      return latlng.LatLng(storeLatitude, storeLongitude);
    }

    final riderId = (rider['riderId'] ?? '').toString();
    final trail = _liveRiderTrails[riderId];
    if (trail != null && trail.isNotEmpty) {
      return trail.first;
    }
    return null;
  }

  latlng.LatLng? _resolveRiderCurrentPoint(Map<String, dynamic> rider) {
    final latitude = rider['latitude'] as double?;
    final longitude = rider['longitude'] as double?;
    if (latitude == null || longitude == null) return null;
    return latlng.LatLng(latitude, longitude);
  }

  double? _distanceKmForRider(Map<String, dynamic> rider) {
    final start = _resolveRiderStartPoint(rider);
    final current = _resolveRiderCurrentPoint(rider);
    if (start == null || current == null) return null;
    final meters = latlng.Distance()(start, current);
    return meters / 1000;
  }

  int? _etaMinutesForRider(Map<String, dynamic> rider) {
    final distanceKm = _distanceKmForRider(rider);
    if (distanceKm == null) return null;
    if (distanceKm <= 0.1) return 1;
    return ((distanceKm / 22) * 60).round().clamp(1, 240);
  }

  String _formatDistanceKm(double? value) {
    if (value == null) return '-';
    return '${value.toStringAsFixed(value >= 10 ? 0 : 1)} km';
  }

  String _formatEtaMinutes(int? minutes) {
    if (minutes == null) return '-';
    if (minutes <= 1) return '1 min';
    return '$minutes mins';
  }

  String _formatLiveUpdatedLabel(DateTime? value) {
    if (value == null) return 'Last updated recently';
    final local = value.toLocal();
    final now = DateTime.now();
    final diff = now.difference(local);
    if (diff.inSeconds.abs() <= 75) {
      return 'Last updated now';
    }
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    final suffix = local.hour >= 12 ? 'pm' : 'am';
    return 'Last updated $hour:$minute $suffix';
  }

  String? _speedLabelForRider(Map<String, dynamic> rider) {
    final riderId = (rider['riderId'] ?? '').toString().trim();
    final speedMph = _liveRiderSpeedsMphById[riderId];
    if (speedMph == null || !speedMph.isFinite || speedMph <= 0) return null;
    return '${speedMph.round()} mph';
  }

  String _coordinateKey(latlng.LatLng point) {
    return '${point.latitude.toStringAsFixed(4)},${point.longitude.toStringAsFixed(4)}';
  }

  String _shortCoordinateLabel(latlng.LatLng? point) {
    if (point == null) return '-';
    return '${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)}';
  }

  String _formatPlacemarkLabel(Placemark placemark) {
    final parts =
        <String?>[
              placemark.street,
              placemark.subLocality,
              placemark.locality,
              placemark.subAdministrativeArea,
              placemark.administrativeArea,
            ]
            .map((value) => (value ?? '').trim())
            .where((value) => value.isNotEmpty)
            .toList();

    final deduped = <String>[];
    for (final part in parts) {
      if (!deduped.contains(part)) {
        deduped.add(part);
      }
    }
    if (deduped.isEmpty) {
      return '';
    }
    return deduped.take(3).join(', ');
  }

  String _liveLocationLabelForRider(Map<String, dynamic> rider) {
    final riderId = (rider['riderId'] ?? '').toString().trim();
    final livePoint = _displayPointForRider(rider);
    final serverLabel = (rider['locationLabel'] ?? '').toString().trim();
    if (serverLabel.isNotEmpty) {
      return serverLabel;
    }
    if (riderId.isNotEmpty) {
      final cached = _liveLocationNameByRider[riderId];
      if (cached != null && cached.trim().isNotEmpty) {
        return cached;
      }
    }
    return _shortCoordinateLabel(livePoint);
  }

  Future<void> _refreshLiveLocationNames(
    List<Map<String, dynamic>> riders,
  ) async {
    for (final rider in riders) {
      final riderId = (rider['riderId'] ?? '').toString().trim();
      final point = _displayPointForRider(rider);
      if (riderId.isEmpty || point == null) continue;

      final key = _coordinateKey(point);
      final cached = _reverseGeocodeCache[key];
      if (cached != null && cached.trim().isNotEmpty) {
        if (_liveLocationNameByRider[riderId] != cached && mounted) {
          setState(() {
            _liveLocationNameByRider[riderId] = cached;
          });
        }
        continue;
      }

      if (_pendingReverseGeocodeKeys.contains(key)) continue;
      _pendingReverseGeocodeKeys.add(key);

      try {
        final placemarks = await placemarkFromCoordinates(
          point.latitude,
          point.longitude,
        );
        final label = placemarks.isNotEmpty
            ? _formatPlacemarkLabel(placemarks.first)
            : '';
        final finalLabel = label.isNotEmpty
            ? label
            : _shortCoordinateLabel(point);
        _reverseGeocodeCache[key] = finalLabel;
        if (mounted) {
          setState(() {
            _liveLocationNameByRider[riderId] = finalLabel;
          });
        }
      } catch (e) {
        final fallback = _shortCoordinateLabel(point);
        _reverseGeocodeCache[key] = fallback;
        if (mounted) {
          setState(() {
            _liveLocationNameByRider[riderId] = fallback;
          });
        }
      } finally {
        _pendingReverseGeocodeKeys.remove(key);
      }
    }
  }

  double _lerpCoordinate(double start, double end, double t) {
    return start + ((end - start) * t);
  }

  latlng.LatLng? _displayPointForRider(Map<String, dynamic> rider) {
    final riderId = (rider['riderId'] ?? '').toString().trim();
    if (riderId.isNotEmpty && _displayedRiderPositions.containsKey(riderId)) {
      return _displayedRiderPositions[riderId];
    }
    return _resolveRiderCurrentPoint(rider);
  }

  void _syncAnimatedRiderLocations(List<Map<String, dynamic>> riders) {
    final activeIds = riders
        .map((rider) => (rider['riderId'] ?? '').toString().trim())
        .where((id) => id.isNotEmpty)
        .toSet();

    _displayedRiderPositions.removeWhere((key, _) => !activeIds.contains(key));
    _motionStartPositions.removeWhere((key, _) => !activeIds.contains(key));
    _motionTargetPositions.removeWhere((key, _) => !activeIds.contains(key));

    var shouldAnimate = false;
    final distance = latlng.Distance();

    for (final rider in riders) {
      final riderId = (rider['riderId'] ?? '').toString().trim();
      final target = _resolveRiderCurrentPoint(rider);
      if (riderId.isEmpty || target == null) continue;

      final displayed = _displayedRiderPositions[riderId];
      if (displayed == null) {
        _displayedRiderPositions[riderId] = target;
        _motionStartPositions[riderId] = target;
        _motionTargetPositions[riderId] = target;
        continue;
      }

      final moveMeters = distance(displayed, target);
      if (moveMeters <= 2) {
        _displayedRiderPositions[riderId] = target;
        _motionStartPositions[riderId] = target;
        _motionTargetPositions[riderId] = target;
        continue;
      }

      _motionStartPositions[riderId] = displayed;
      _motionTargetPositions[riderId] = target;
      shouldAnimate = true;
    }

    if (shouldAnimate) {
      _riderMotionController.forward(from: 0);
    } else if (_riderMotionController.isAnimating) {
      _riderMotionController.stop();
    }
  }

  void _tickRiderMotion() {
    if (!mounted) return;
    final progress = Curves.easeInOut.transform(_riderMotionController.value);
    var changed = false;

    _motionTargetPositions.forEach((riderId, target) {
      final start = _motionStartPositions[riderId];
      if (start == null) {
        _displayedRiderPositions[riderId] = target;
        changed = true;
        return;
      }

      final next = latlng.LatLng(
        _lerpCoordinate(start.latitude, target.latitude, progress),
        _lerpCoordinate(start.longitude, target.longitude, progress),
      );

      final current = _displayedRiderPositions[riderId];
      final samePoint =
          current != null &&
          (current.latitude - next.latitude).abs() < 0.0000001 &&
          (current.longitude - next.longitude).abs() < 0.0000001;
      if (!samePoint) {
        _displayedRiderPositions[riderId] = next;
        changed = true;
      }
    });

    if (changed) {
      setState(() {});
    }

    _autoFollowSelectedRider();
  }

  void _autoFollowSelectedRider() {
    final selectedId = _selectedLiveRiderId;
    if (selectedId == null || selectedId.isEmpty) return;

    final rider = _liveRiderLocations.cast<Map<String, dynamic>?>().firstWhere(
      (item) => item?['riderId'].toString() == selectedId,
      orElse: () => null,
    );
    if (rider == null) return;

    final point = _displayPointForRider(rider);
    if (point == null) return;

    try {
      final camera = _liveRiderMapController.camera;
      final currentCenter = camera.center;
      final distanceMeters = latlng.Distance()(currentCenter, point);
      if (distanceMeters < 8) return;
      _liveRiderMapController.move(point, camera.zoom);
    } catch (_) {
      // Map controller may not be attached yet; safe to ignore.
    }
  }

  void _handleLiveRiderSocketEvent(Map<String, dynamic> data) {
    final riderId = (data['rider_id'] ?? data['riderId'] ?? '')
        .toString()
        .trim();
    if (riderId.isEmpty) return;

    final latitude = double.tryParse((data['latitude'] ?? '').toString());
    final longitude = double.tryParse((data['longitude'] ?? '').toString());
    if (latitude == null || longitude == null) return;

    final updatedAt =
        _parseLiveTrackingTime(data['updated_at']) ?? DateTime.now();
    final locationLabel = (data['location'] ?? '').toString().trim();
    final existingIndex = _liveRiderLocations.indexWhere(
      (rider) => (rider['riderId'] ?? '').toString() == riderId,
    );
    if (existingIndex < 0) return;

    final updatedRiders = List<Map<String, dynamic>>.from(_liveRiderLocations);
    final rider = Map<String, dynamic>.from(updatedRiders[existingIndex]);
    rider['latitude'] = latitude;
    rider['longitude'] = longitude;
    rider['createdAt'] = updatedAt;
    if (locationLabel.isNotEmpty) {
      rider['locationLabel'] = locationLabel;
      _liveLocationNameByRider[riderId] = locationLabel;
    }
    updatedRiders[existingIndex] = rider;

    final trails = Map<String, List<latlng.LatLng>>.from(_liveRiderTrails);
    final riderTrail = List<latlng.LatLng>.from(trails[riderId] ?? const []);
    _appendTrailPoint(riderTrail, latlng.LatLng(latitude, longitude));
    trails[riderId] = riderTrail;

    if (!mounted) return;
    setState(() {
      _liveRiderLocations = updatedRiders
          .where(_isRiderFresh)
          .toList(growable: false);
      _liveRiderTrails = trails;
      _syncAnimatedRiderLocations(_liveRiderLocations);
    });
  }

  @override
  void initState() {
    super.initState();
    _riderMotionController = AnimationController(
      vsync: this,
      duration: _riderMotionDuration,
    )..addListener(_tickRiderMotion);
    _loadLanguagePreference();
    _loadStats();
    _setupLiveRefresh();
  }

  @override
  void dispose() {
    _liveStatsTimer?.cancel();
    _liveRiderTimer?.cancel();
    _graceAlertTimer?.cancel();
    _riderMotionController
      ..removeListener(_tickRiderMotion)
      ..dispose();
    Provider.of<NotificationProvider>(
      context,
      listen: false,
    ).removeEventListener(this);
    super.dispose();
  }

  void _setupLiveRefresh() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    Provider.of<NotificationProvider>(context, listen: false).addEventListener(
      this,
      (data) {
        if (!mounted) return;
        final type = (data['type'] ?? data['event'] ?? '')
            .toString()
            .toLowerCase();
        // Refresh stats quickly for events that can affect dashboard counters.
        if (type.contains('user') ||
            type.contains('order') ||
            type.contains('payment') ||
            type.contains('new')) {
          _loadVisitorStatsOnly();
        }
        if (type.contains('rider_location')) {
          _handleLiveRiderSocketEvent(data);
        }
        if (type == 'order_status_update' || type == 'order_completed') {
          _loadLiveRiderLocationsOnly();
        }
      },
    );

    // Fallback polling so logins are reflected even without explicit socket events.
    _liveStatsTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted) return;
      _loadVisitorStatsOnly();
    });

    final email = auth.user?.email;
    if (_canViewLiveRiderTracker(email)) {
      _liveRiderTimer = Timer.periodic(_liveRiderRefreshInterval, (_) {
        if (!mounted) return;
        _loadLiveRiderLocationsOnly();
      });
    }

    _graceAlertTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (!mounted) return;
      _checkStoreGraceAlerts();
    });
    _checkStoreGraceAlerts();
  }

  Future<void> _checkStoreGraceAlerts() async {
    if (!mounted) return;
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null || token.trim().isEmpty) return;
      final notificationProvider = Provider.of<NotificationProvider>(
        context,
        listen: false,
      );
      final data = await ApiService.getStoreGraceAlerts(
        token,
        channel: 'mobile',
      );
      final alerts = (data['alerts'] as List?) ?? const [];
      if (alerts.isEmpty || !mounted) {
        await notificationProvider.removeNotificationsWhere(
          (notification) =>
              notification.payload?['type']?.toString() == 'store_due_alert',
        );
        return;
      }
      final alert = (alerts.first as Map?)?.cast<String, dynamic>() ?? {};
      final storeId = int.tryParse((alert['store_id'] ?? '').toString());
      if (storeId == null || storeId <= 0) return;
      final storeName = (alert['store_name'] ?? 'Store').toString();
      final dueDate = (alert['due_date'] ?? '-').toString();
      final pending =
          double.tryParse((alert['pending_amount'] ?? '0').toString()) ?? 0;
      final daysLeft = int.tryParse((alert['days_left'] ?? '').toString());
      final lead = (daysLeft != null && daysLeft < 0)
          ? 'Overdue by ${daysLeft.abs()} day(s)'
          : (daysLeft != null ? 'Due in $daysLeft day(s)' : 'Payment due');
      final key = '$storeId|$dueDate|${pending.toStringAsFixed(2)}';
      final now = DateTime.now();
      final lastAt = _lastGraceAlertAt[key];
      // Keep periodic reminders, but avoid a notification every minute.
      if (lastAt != null &&
          now.difference(lastAt) < const Duration(minutes: 30)) {
        return;
      }
      _lastGraceAlertAt[key] = now;
      await notificationProvider.removeNotificationsWhere(
        (notification) =>
            notification.payload?['type']?.toString() == 'store_due_alert' &&
            notification.payload?['store_id']?.toString() != storeId.toString(),
      );
      notificationProvider.addNotification(
        title: 'Store Due Alert',
        message:
            '$storeName: $lead | Due: $dueDate | Pending: PKR ${pending.toStringAsFixed(2)}',
        type: 'warning',
        icon: 'warning',
        persistUntilDismissed: true,
        payload: {
          'type': 'store_due_alert',
          'store_id': storeId,
          'store_name': storeName,
        },
      );
    } catch (e) {
      _logger.w('Grace alert poll skipped: $e');
    }
  }

  Future<void> _loadStats() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      final currentUser = Provider.of<AuthProvider>(
        context,
        listen: false,
      ).user;
      final currentUserId = currentUser?.id;
      final allowLiveTracker = _canViewLiveRiderTracker(currentUser?.email);

      final results = await Future.wait([
        ApiService.getOrders(
          token,
          includeItemsCount: false,
          includeStoreStatuses: false,
        ),
        ApiService.getVisitorStats(token),
        ApiService.getRecentActivity(token),
      ]);

      final orders = results[0] as List<dynamic>;
      final visitorStats = results[1] as Map<String, dynamic>;
      final recentActivityData = results[2] as Map<String, dynamic>;
      final liveRiders = allowLiveTracker
          ? _extractLiveRiderLocations(
              orders
                  .where((o) {
                    if (o is! Map) return false;
                    final status = (o['status'] ?? '').toString().toLowerCase();
                    return _isLiveTrackableOrderStatus(status);
                  })
                  .toList(growable: false),
            )
          : const <Map<String, dynamic>>[];
      final liveRiderTrackerPayload = allowLiveTracker
          ? await _fetchLiveRiderTrails(token, liveRiders)
          : const _LiveRiderTrackerPayload(
              trails: <String, List<latlng.LatLng>>{},
              speedsMph: <String, double>{},
            );

      final now = DateTime.now();
      final todayOrders = orders.where((o) {
        try {
          final dt = DateTime.parse(o['created_at'].toString());
          return dt.year == now.year &&
              dt.month == now.month &&
              dt.day == now.day;
        } catch (_) {
          return false;
        }
      }).toList();

      int countStatus(List list, String status) {
        return list
            .where(
              (o) => (o['status'] ?? '').toString().toLowerCase() == status,
            )
            .length;
      }

      int countPendingLike(List list) {
        return list.where((o) {
          final s = (o['status'] ?? '').toString().toLowerCase();
          return s != 'delivered' && s != 'cancelled';
        }).length;
      }

      final assignableOrders =
          orders.where((o) {
            final s = (o['status'] ?? '').toString().toLowerCase();
            final customerId = int.tryParse(
              (o['customer_id'] ?? '').toString(),
            );
            final isOwnOrder =
                currentUserId != null && customerId == currentUserId;
            return s != 'delivered' && s != 'cancelled' && !isOwnOrder;
          }).toList()..sort((a, b) {
            DateTime ad = DateTime.fromMillisecondsSinceEpoch(0);
            DateTime bd = DateTime.fromMillisecondsSinceEpoch(0);
            try {
              ad = DateTime.parse((a['created_at'] ?? '').toString());
            } catch (_) {}
            try {
              bd = DateTime.parse((b['created_at'] ?? '').toString());
            } catch (_) {}
            return bd.compareTo(ad);
          });

      final stats = (visitorStats['stats'] is Map<String, dynamic>)
          ? visitorStats['stats'] as Map<String, dynamic>
          : visitorStats;

      int activeUsers = _readFirstInt(stats, const [
        'active_users',
        'activeUsers',
        'currently_logged_in',
        'currentlyLogin',
        'online_users',
        'onlineUsers',
      ]);
      if (activeUsers == 0) {
        activeUsers =
            _toInt(stats['active_customers']) +
            _toInt(stats['active_admins']) +
            _toInt(stats['active_riders']) +
            _toInt(stats['active_store_owners']) +
            _toInt(stats['active_storeOwners']) +
            _toInt(stats['active_store_managers']);
      }

      final todayLogins = _readFirstInt(stats, const [
        'today_logins',
        'todayLogins',
        'todays_logins',
        'logins_today',
      ]);

      setState(() {
        _todayTotal = todayOrders.length;
        _todayDelivered = countStatus(todayOrders, 'delivered');
        _todayPending = countPendingLike(todayOrders);
        _todayCancelled = countStatus(todayOrders, 'cancelled');

        _allTotal = orders.length;
        _allDelivered = countStatus(orders, 'delivered');
        _allPending = countPendingLike(orders);
        _allCancelled = countStatus(orders, 'cancelled');

        _activeUsers = activeUsers;
        _todayLogins = todayLogins;

        _recentOrdersList = recentActivityData['recent_orders'] ?? [];
        _recentUsersList = recentActivityData['recent_users'] ?? [];
        _recentStoresList = recentActivityData['recent_stores'] ?? [];
        _assignableOrdersList = assignableOrders;
        _liveRiderLocations = liveRiders
            .where(_isRiderFresh)
            .toList(growable: false);
        _liveRiderTrails = Map<String, List<latlng.LatLng>>.from(
          liveRiderTrackerPayload.trails,
        );
        _liveRiderSpeedsMphById
          ..clear()
          ..addAll(liveRiderTrackerPayload.speedsMph);
        _syncAnimatedRiderLocations(_liveRiderLocations);
        _liveLocationNameByRider.removeWhere(
          (key, _) => !_liveRiderLocations.any(
            (rider) => rider['riderId'].toString() == key,
          ),
        );
        if (_selectedLiveRiderId != null &&
            !_liveRiderLocations.any(
              (rider) => rider['riderId'].toString() == _selectedLiveRiderId,
            )) {
          _selectedLiveRiderId = null;
        }
        _isLoading = false;
      });
      unawaited(_refreshLiveLocationNames(liveRiders));
    } catch (e) {
      _logger.e('Error loading stats: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadLiveRiderLocationsOnly() async {
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final token = auth.token;
      if (token == null || !_canViewLiveRiderTracker(auth.user?.email)) return;

      final orders = await ApiService.getOrders(
        token,
        includeItemsCount: false,
        includeStoreStatuses: false,
      );
      final riders = _extractLiveRiderLocations(orders);
      final trackerPayload = await _fetchLiveRiderTrails(token, riders);
      if (!mounted) return;
      setState(() {
        _liveRiderLocations = riders
            .where(_isRiderFresh)
            .toList(growable: false);
        _liveRiderTrails = trackerPayload.trails;
        _liveRiderSpeedsMphById
          ..clear()
          ..addAll(trackerPayload.speedsMph);
        _syncAnimatedRiderLocations(_liveRiderLocations);
        _liveLocationNameByRider.removeWhere(
          (key, _) => !_liveRiderLocations.any(
            (rider) => rider['riderId'].toString() == key,
          ),
        );
        if (_selectedLiveRiderId != null &&
            !_liveRiderLocations.any(
              (rider) => rider['riderId'].toString() == _selectedLiveRiderId,
            )) {
          _selectedLiveRiderId = null;
        }
      });
      unawaited(_refreshLiveLocationNames(riders));
    } catch (e) {
      _logger.w('Live rider refresh skipped: $e');
    }
  }

  Future<void> _loadVisitorStatsOnly() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      final visitorStats = await ApiService.getVisitorStats(token);
      final stats = (visitorStats['stats'] is Map<String, dynamic>)
          ? visitorStats['stats'] as Map<String, dynamic>
          : visitorStats;
      final activeUsers = _readFirstInt(stats, const [
        'active_users',
        'activeUsers',
        'currently_logged_in',
        'currentlyLogin',
        'online_users',
        'onlineUsers',
      ]);
      final todayLogins = _readFirstInt(stats, const [
        'today_logins',
        'todayLogins',
        'todays_logins',
        'logins_today',
      ]);
      if (!mounted) return;
      setState(() {
        _activeUsers = activeUsers;
        _todayLogins = todayLogins;
      });
    } catch (e) {
      _logger.w('Live visitor stats refresh skipped: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final mediaWidth = MediaQuery.of(context).size.width;
    final useBottomQuickMenu = mediaWidth < 920;

    return Directionality(
      textDirection: CustomerLanguage.textDirection(_isUrdu),
      child: Scaffold(
        backgroundColor: const Color(0xFFE8F5EC),
        appBar: AppBar(
          elevation: 0,
          backgroundColor: Colors.white.withValues(alpha: 0.78),
          iconTheme: const IconThemeData(color: Colors.black87),
          title: Text(
            _tr('Admin Dashboard'),
            style: const TextStyle(
              color: Colors.black87,
              fontWeight: FontWeight.bold,
            ),
          ),
          actions: [
            const NotificationBellWidget(),
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: CircleAvatar(
                backgroundColor: Colors.indigo,
                child: Text(
                  authProvider.user?.firstName.substring(0, 1).toUpperCase() ??
                      'A',
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ),
          ],
        ),
        drawer: _buildDrawer(context, authProvider),
        bottomNavigationBar: useBottomQuickMenu
            ? SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
                  child: _buildQuickMenu(context),
                ),
              )
            : null,
        body: _isLoading
            ? Stack(
                children: [
                  _buildDashboardBackdrop(),
                  const Center(child: CircularProgressIndicator()),
                ],
              )
            : RefreshIndicator(
                onRefresh: _loadStats,
                child: Stack(
                  children: [
                    _buildDashboardBackdrop(),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final isWide = constraints.maxWidth >= 1080;
                        final isMedium = constraints.maxWidth >= 760;
                        return SingleChildScrollView(
                          padding: EdgeInsets.fromLTRB(
                            isWide ? 28 : 16,
                            18,
                            isWide ? 28 : 16,
                            useBottomQuickMenu ? 96 : 28,
                          ),
                          physics: const AlwaysScrollableScrollPhysics(),
                          child: Center(
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 1320),
                              child: Container(
                                padding: EdgeInsets.all(isWide ? 20 : 14),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.4),
                                  borderRadius: BorderRadius.circular(34),
                                  border: Border.all(
                                    color: Colors.white.withValues(alpha: 0.7),
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: const Color(
                                        0xFF6AA6A0,
                                      ).withValues(alpha: 0.18),
                                      blurRadius: 36,
                                      offset: const Offset(0, 18),
                                    ),
                                  ],
                                ),
                                child: isWide
                                    ? Row(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          SizedBox(
                                            width: 236,
                                            child: _buildAdminSidePanel(
                                              context,
                                              authProvider,
                                            ),
                                          ),
                                          const SizedBox(width: 18),
                                          Expanded(
                                            child: _buildAdminOverviewContent(
                                              context,
                                              authProvider,
                                              isWide: true,
                                              isMedium: true,
                                              showInlineQuickMenu: false,
                                            ),
                                          ),
                                        ],
                                      )
                                    : _buildAdminOverviewContent(
                                        context,
                                        authProvider,
                                        isWide: false,
                                        isMedium: isMedium,
                                        showInlineQuickMenu:
                                            !useBottomQuickMenu,
                                      ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildDashboardBackdrop() {
    return Stack(
      children: [
        Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFD9F1C8), Color(0xFFCDEDE2), Color(0xFFCDE1FF)],
            ),
          ),
        ),
        Positioned(
          top: -90,
          left: -60,
          child: _buildBackdropOrb(
            size: 240,
            colors: const [Color(0x80B7E26A), Color(0x00B7E26A)],
          ),
        ),
        Positioned(
          top: 120,
          right: -40,
          child: _buildBackdropOrb(
            size: 220,
            colors: const [Color(0x7098D8D3), Color(0x0098D8D3)],
          ),
        ),
        Positioned(
          bottom: -30,
          right: 30,
          child: _buildBackdropOrb(
            size: 180,
            colors: const [Color(0x60A5C9FF), Color(0x00A5C9FF)],
          ),
        ),
      ],
    );
  }

  Widget _buildBackdropOrb({
    required double size,
    required List<Color> colors,
  }) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: colors),
      ),
    );
  }

  Widget _buildAdminOverviewContent(
    BuildContext context,
    AuthProvider authProvider, {
    required bool isWide,
    required bool isMedium,
    required bool showInlineQuickMenu,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildOverviewHeader(authProvider),
        if (showInlineQuickMenu) ...[
          const SizedBox(height: 14),
          _buildAdminMiniActions(context),
        ],
        const SizedBox(height: 18),
        _buildOverviewSummaryGrid(isWide: isWide, isMedium: isMedium),
        if (_canViewLiveRiderTracker(authProvider.user?.email)) ...[
          const SizedBox(height: 18),
          _buildSoftPanel(child: _buildLiveRiderTrackerSection()),
        ],
        const SizedBox(height: 18),
        _buildRecentActivityPanel(),
      ],
    );
  }

  Widget _buildOverviewHeader(AuthProvider authProvider) {
    final firstName = (authProvider.user?.firstName ?? '').trim();
    final lastName = (authProvider.user?.lastName ?? '').trim();
    final fullName = '$firstName $lastName'.trim();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.58),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: 0.8)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Dashboard Overview',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF16263E),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Track orders, users, riders, and live operational activity in one place.',
                  style: TextStyle(
                    fontSize: 13.5,
                    height: 1.35,
                    color: Colors.blueGrey.shade700,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.88),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFFDCE6EE)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: const Color(0xFFE8EEF8),
                  child: Text(
                    firstName.isNotEmpty
                        ? firstName.substring(0, 1).toUpperCase()
                        : 'A',
                    style: const TextStyle(
                      color: Color(0xFF334155),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  fullName.isNotEmpty ? fullName : 'Admin User',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF334155),
                  ),
                ),
                const SizedBox(width: 6),
                const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  color: Color(0xFF64748B),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAdminSidePanel(BuildContext context, AuthProvider authProvider) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.62),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.85)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),
          const Text(
            'ServeNow',
            style: TextStyle(
              fontSize: 26,
              height: 0.95,
              fontWeight: FontWeight.w900,
              color: Color(0xFF18253B),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'ADMIN CONTROL',
            style: TextStyle(
              fontSize: 11,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w800,
              color: Colors.blueGrey.shade500,
            ),
          ),
          const SizedBox(height: 18),
          _buildSideMenuEntry(
            icon: Icons.dashboard_rounded,
            label: 'Dashboard',
            selected: true,
            onTap: () {},
          ),
          const SizedBox(height: 10),
          _buildSideMenuEntry(
            icon: Icons.receipt_long_rounded,
            label: 'Orders',
            onTap: _openManageOrdersForAssignment,
          ),
          const SizedBox(height: 10),
          _buildSideMenuEntry(
            icon: Icons.inventory_2_rounded,
            label: 'Products',
            onTap: () => Navigator.of(context).pushNamed('/manage-products'),
          ),
          const SizedBox(height: 10),
          _buildSideMenuEntry(
            icon: Icons.storefront_rounded,
            label: 'Stores',
            onTap: () => Navigator.of(context).pushNamed('/manage-stores'),
          ),
          const SizedBox(height: 10),
          _buildSideMenuEntry(
            icon: Icons.bar_chart_rounded,
            label: 'Reports',
            onTap: () => Navigator.of(context).pushNamed('/inventory-report'),
          ),
          const SizedBox(height: 10),
          _buildSideMenuEntry(
            icon: Icons.settings_rounded,
            label: 'Settings',
            onTap: _openStoreStatusMessageDialog,
          ),
          const SizedBox(height: 18),
          Text(
            'Quick access',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: Colors.blueGrey.shade700,
            ),
          ),
          const SizedBox(height: 12),
          _buildAdminMiniActions(context),
        ],
      ),
    );
  }

  Widget _buildSideMenuEntry({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool selected = false,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          gradient: selected
              ? const LinearGradient(
                  colors: [Color(0xFFA5DD52), Color(0xFF82C739)],
                )
              : null,
          color: selected ? null : Colors.white.withValues(alpha: 0.72),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? const Color(0xFF7DBA33) : const Color(0xFFDDE5EA),
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: const Color(0xFF8AC73C).withValues(alpha: 0.22),
                    blurRadius: 16,
                    offset: const Offset(0, 8),
                  ),
                ]
              : null,
        ),
        child: Row(
          children: [
            Icon(
              icon,
              size: 19,
              color: selected ? Colors.white : const Color(0xFF64748B),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: selected ? Colors.white : const Color(0xFF475569),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAdminMiniActions(BuildContext context) {
    final actions = [
      (
        icon: Icons.store_mall_directory_rounded,
        label: 'Stores',
        onTap: () => Navigator.of(context).pushNamed('/manage-stores'),
      ),
      (
        icon: Icons.shopping_bag_rounded,
        label: 'Products',
        onTap: () => Navigator.of(context).pushNamed('/manage-products'),
      ),
      (
        icon: Icons.receipt_long_rounded,
        label: 'Orders',
        onTap: _openManageOrdersForAssignment,
      ),
      (
        icon: Icons.campaign_rounded,
        label: 'Status',
        onTap: _openStoreStatusMessageDialog,
      ),
    ];

    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: actions.map((action) {
        return InkWell(
          onTap: action.onTap,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            width: 104,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.86),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFFDDE5EA)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE9F7D8),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(action.icon, color: const Color(0xFF5E9820)),
                ),
                const SizedBox(height: 8),
                Text(
                  action.label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF334155),
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildOverviewSummaryGrid({
    required bool isWide,
    required bool isMedium,
  }) {
    final cards = [
      _buildOverviewMetricCard(
        title: "Today's Orders",
        value: _todayTotal.toString(),
        accent: const Color(0xFF6DBB37),
        icon: Icons.show_chart_rounded,
        subtitle: '${_todayDelivered} delivered today',
        trendLabel: '+${_todayPending} pending',
        visual: _buildMiniTrendLine(const Color(0xFF6DBB37)),
      ),
      _buildOverviewMetricCard(
        title: 'All Orders',
        value: _allTotal.toString(),
        accent: const Color(0xFF4A90E2),
        icon: Icons.bar_chart_rounded,
        subtitle: '${_allCancelled} cancelled overall',
        trendLabel: '${_allDelivered} delivered',
        visual: _buildMiniBarChart(const Color(0xFF4A90E2)),
      ),
      _buildOverviewMetricCard(
        title: 'Active Users',
        value: _activeUsers.toString(),
        accent: const Color(0xFFF58A1F),
        icon: Icons.pie_chart_outline_rounded,
        subtitle: '${_todayLogins} logged in today',
        trendLabel: '${_todayPending} awaiting attention',
        visual: _buildMiniDonut(
          primary: const Color(0xFFF58A1F),
          secondary: const Color(0xFF4A90E2),
          tertiary: const Color(0xFFB5D96B),
        ),
      ),
      _buildOverviewMetricCard(
        title: 'Operations Pulse',
        value: '${_recentOrdersList.length}',
        accent: const Color(0xFF809A22),
        icon: Icons.local_shipping_rounded,
        subtitle:
            '${_recentUsersList.length} new users | ${_recentStoresList.length} stores',
        trendLabel: '${_assignableOrdersList.length} orders need assignment',
        visual: _buildMiniLeaderboard(),
      ),
    ];

    if (isWide) {
      return GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: cards.length,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
          childAspectRatio: 1.5,
        ),
        itemBuilder: (_, index) => cards[index],
      );
    }

    if (isMedium) {
      return GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: cards.length,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.18,
        ),
        itemBuilder: (_, index) => cards[index],
      );
    }

    return Column(
      children: [
        for (var i = 0; i < cards.length; i++) ...[
          cards[i],
          if (i != cards.length - 1) const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _buildOverviewMetricCard({
    required String title,
    required String value,
    required Color accent,
    required IconData icon,
    required String subtitle,
    required String trendLabel,
    required Widget visual,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.10),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF334155),
                  ),
                ),
              ),
              Icon(icon, color: accent, size: 20),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 34,
              height: 1,
              fontWeight: FontWeight.w900,
              color: accent,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: Colors.blueGrey.shade600,
            ),
          ),
          const SizedBox(height: 12),
          Expanded(child: visual),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(Icons.arrow_upward_rounded, size: 15, color: accent),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  trendLabel,
                  style: TextStyle(
                    color: accent,
                    fontWeight: FontWeight.w800,
                    fontSize: 12.5,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMiniTrendLine(Color color) {
    return CustomPaint(
      painter: _SimpleTrendPainter(color: color),
      child: const SizedBox.expand(),
    );
  }

  Widget _buildMiniBarChart(Color color) {
    final bars = [0.18, 0.34, 0.26, 0.42, 0.57, 0.35, 0.48, 0.74];
    return Align(
      alignment: Alignment.bottomLeft,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: bars.map((heightFactor) {
          return Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: Container(
                height: 72 * heightFactor,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.85),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildMiniDonut({
    required Color primary,
    required Color secondary,
    required Color tertiary,
  }) {
    return Center(
      child: SizedBox(
        width: 86,
        height: 86,
        child: Stack(
          fit: StackFit.expand,
          children: [
            CircularProgressIndicator(
              value: 0.78,
              strokeWidth: 14,
              backgroundColor: secondary.withValues(alpha: 0.14),
              valueColor: AlwaysStoppedAnimation<Color>(primary),
            ),
            Center(
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: tertiary.withValues(alpha: 0.24),
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMiniLeaderboard() {
    final bars = [0.72, 0.48, 0.83, 0.34];
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: bars.map((value) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: Color(0xFFF58A1F),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: value,
                    minHeight: 8,
                    backgroundColor: const Color(0xFFE8EDF2),
                    valueColor: const AlwaysStoppedAnimation<Color>(
                      Color(0xFFF58A1F),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildRecentActivityPanel() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Recent Activity',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w900,
              color: Color(0xFF1E293B),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Review the latest operations and jump directly into order management.',
            style: TextStyle(
              color: Colors.blueGrey.shade600,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 14),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: _buildActivityFilter(),
          ),
          const SizedBox(height: 14),
          _buildRecentActivityList(),
        ],
      ),
    );
  }

  Widget _buildSoftPanel({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.86),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 14,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: child,
    );
  }

  Widget _buildDrawer(BuildContext context, AuthProvider authProvider) {
    final bottomInset = MediaQuery.of(context).padding.bottom;
    return Drawer(
      child: ListView(
        padding: EdgeInsets.only(bottom: bottomInset + 12),
        children: [
          UserAccountsDrawerHeader(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.indigo, Colors.blueAccent],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            accountName: Text(
              '${authProvider.user?.firstName} ${authProvider.user?.lastName}',
            ),
            accountEmail: Text(authProvider.user?.email ?? ''),
            currentAccountPicture: CircleAvatar(
              backgroundColor: Colors.white,
              child: Text(
                authProvider.user?.firstName.substring(0, 1).toUpperCase() ??
                    'A',
                style: const TextStyle(fontSize: 24, color: Colors.indigo),
              ),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.dashboard),
            title: Text(_tr('Dashboard')),
            selected: true,
            onTap: () => Navigator.of(context).pop(),
          ),
          ListTile(
            leading: const Icon(Icons.store),
            title: Text(_tr('Manage Stores')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-stores');
            },
          ),
          ListTile(
            leading: const Icon(Icons.storefront),
            title: Text(_tr('Store Balances')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/store-balances');
            },
          ),
          ListTile(
            leading: const Icon(Icons.campaign),
            title: Text(_tr('Store Status')),
            onTap: () {
              Navigator.of(context).pop();
              _openStoreStatusMessageDialog();
            },
          ),
          ListTile(
            leading: const Icon(Icons.shopping_bag),
            title: Text(_tr('Products & Variants')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-products');
            },
          ),
          ListTile(
            leading: const Icon(Icons.view_carousel),
            title: Text(_tr('Customer Tile Demo')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/customer-tile-demo');
            },
          ),
          ListTile(
            leading: const Icon(Icons.people),
            title: Text(_tr('Manage Users')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-users');
            },
          ),
          ListTile(
            leading: const Icon(Icons.account_balance_wallet),
            title: Text(_tr('Wallet')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/wallet');
            },
          ),
          ListTile(
            leading: const Icon(Icons.delivery_dining),
            title: Text(_tr('Riders')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-riders');
            },
          ),
          ListTile(
            leading: const Icon(Icons.inventory),
            title: Text(_tr('Inventory Reports')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/inventory-report');
            },
          ),
          ListTile(
            leading: const Icon(Icons.receipt_long),
            title: Text(_tr('Manage Orders')),
            onTap: () {
              Navigator.of(context).pop();
              _openManageOrdersForAssignment();
            },
          ),
          ListTile(
            leading: const Icon(Icons.key),
            title: Text(_tr('Change Password')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/change-password');
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: Text(
              _tr('Logout'),
              style: const TextStyle(color: Colors.red),
            ),
            onTap: () {
              authProvider.logout();
              Navigator.of(context).pushReplacementNamed('/login');
            },
          ),
        ],
      ),
    );
  }

  Widget _buildStatGrid({
    required int total,
    required int delivered,
    required int pending,
    required int cancelled,
  }) {
    final cards = [
      (
        title: _tr('Total'),
        value: total.toString(),
        icon: Icons.shopping_cart,
        gradient: [Colors.blue.shade400, Colors.blue.shade700],
      ),
      (
        title: _tr('Delivered'),
        value: delivered.toString(),
        icon: Icons.check_circle,
        gradient: [Colors.green.shade400, Colors.green.shade700],
      ),
      (
        title: _tr('Pending'),
        value: pending.toString(),
        icon: Icons.pending_actions,
        gradient: [Colors.orange.shade400, Colors.orange.shade700],
      ),
      (
        title: _tr('Cancelled'),
        value: cancelled.toString(),
        icon: Icons.cancel,
        gradient: [Colors.red.shade400, Colors.red.shade700],
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        const spacing = 8.0;
        final width = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : MediaQuery.of(context).size.width;
        final cardWidth = (((width - (spacing * 3)) / 4).clamp(
          62.0,
          140.0,
        )).toDouble();
        return Row(
          children: [
            for (var i = 0; i < cards.length; i++) ...[
              SizedBox(
                width: cardWidth,
                child: _buildStatCard(
                  title: cards[i].title,
                  value: cards[i].value,
                  icon: cards[i].icon,
                  color: cards[i].gradient.first,
                  gradient: cards[i].gradient,
                ),
              ),
              if (i != cards.length - 1) const SizedBox(width: spacing),
            ],
          ],
        );
      },
    );
  }

  Widget _buildLiveRiderTrackerSection() {
    final allRiders = _liveRiderLocations;
    final hasSelectedRider =
        _selectedLiveRiderId != null &&
        allRiders.any(
          (rider) => rider['riderId'].toString() == _selectedLiveRiderId,
        );
    final riders = hasSelectedRider
        ? allRiders
              .where(
                (rider) => rider['riderId'].toString() == _selectedLiveRiderId,
              )
              .toList(growable: false)
        : allRiders;
    final focusedRider = riders.length == 1 ? riders.first : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _tr('Live Rider Tracker'),
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 10),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.06),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: const BoxDecoration(
                      color: Color(0xFF16A34A),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _tr(
                        'Auto-refreshing rider positions for active deliveries',
                      ),
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  Text(
                    '${allRiders.length} ${_tr('live')}',
                    style: TextStyle(
                      color: Colors.grey[700],
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (allRiders.isNotEmpty) ...[
                DropdownButtonFormField<String>(
                  initialValue: hasSelectedRider
                      ? _selectedLiveRiderId
                      : '__all__',
                  decoration: InputDecoration(
                    labelText: _tr('Select Rider'),
                    filled: true,
                    fillColor: const Color(0xFFF8FAFC),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Color(0xFFD7E3F4)),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Color(0xFFD7E3F4)),
                    ),
                  ),
                  items: [
                    DropdownMenuItem<String>(
                      value: '__all__',
                      child: Text(_tr('All riders')),
                    ),
                    ...allRiders.map((rider) {
                      final riderId = (rider['riderId'] ?? '').toString();
                      final riderName = (rider['riderName'] ?? _tr('Rider'))
                          .toString();
                      final orderNumber = (rider['orderNumber'] ?? '')
                          .toString();
                      return DropdownMenuItem<String>(
                        value: riderId,
                        child: Text(
                          orderNumber.isEmpty
                              ? riderName
                              : '$riderName - $orderNumber',
                          overflow: TextOverflow.ellipsis,
                        ),
                      );
                    }),
                  ],
                  onChanged: (value) {
                    setState(() {
                      _selectedLiveRiderId = value == null || value == '__all__'
                          ? null
                          : value;
                    });
                  },
                ),
                const SizedBox(height: 12),
              ],
              if (allRiders.isEmpty)
                Container(
                  height: 220,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    gradient: const LinearGradient(
                      colors: [Color(0xFFF8FAFC), Color(0xFFEFF6FF)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    border: Border.all(color: const Color(0xFFD7E3F4)),
                  ),
                  child: Center(
                    child: Text(
                      _tr('No riders are currently sharing live locations'),
                      style: TextStyle(
                        color: Colors.black54,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                )
              else
                _buildLiveMapSurface(riders),
              if (focusedRider != null) ...[
                const SizedBox(height: 12),
                _buildFocusedRiderTrackingCard(focusedRider),
              ],
              if (_selectedLiveRiderId == null && riders.length > 1) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: riders.map(_buildRiderInfoChip).toList(),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildLiveMapSurface(List<Map<String, dynamic>> riders) {
    final focusedRider = riders.length == 1 ? riders.first : null;
    final isFocusedTrackingMode = focusedRider != null;
    final selectedRiderName = _selectedLiveRiderId == null
        ? null
        : _liveRiderLocations
              .where(
                (rider) => rider['riderId'].toString() == _selectedLiveRiderId,
              )
              .map((rider) => (rider['riderName'] ?? 'this rider').toString())
              .cast<String?>()
              .firstOrNull;
    final startCoordinates = riders
        .map((r) {
          final storeLatitude = r['storeLatitude'] as double?;
          final storeLongitude = r['storeLongitude'] as double?;
          if (storeLatitude != null && storeLongitude != null) {
            return latlng.LatLng(storeLatitude, storeLongitude);
          }
          final riderId = (r['riderId'] ?? '').toString();
          final trail = _liveRiderTrails[riderId];
          if (trail != null && trail.isNotEmpty) {
            return trail.first;
          }
          return null;
        })
        .whereType<latlng.LatLng>()
        .toList(growable: false);
    final coordinates = riders
        .map((r) => _displayPointForRider(r))
        .whereType<latlng.LatLng>()
        .toList(growable: false);
    final trailCoordinates = riders
        .expand((rider) {
          final riderId = (rider['riderId'] ?? '').toString();
          final basePoints = List<latlng.LatLng>.from(
            _liveRiderTrails[riderId] ?? const <latlng.LatLng>[],
          );
          final displayPoint = _displayPointForRider(rider);
          if (displayPoint != null) {
            _appendTrailPoint(basePoints, displayPoint);
          }
          return basePoints;
        })
        .toList(growable: false);
    final mapCoordinates = <latlng.LatLng>[
      ...startCoordinates,
      ...trailCoordinates,
      ...coordinates,
    ];
    final mapKey = riders.map((rider) => rider['riderId'].toString()).join('_');

    final fallbackCenter = mapCoordinates.isNotEmpty
        ? mapCoordinates.first
        : const latlng.LatLng(30.3753, 69.3451);

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: SizedBox(
        height: isFocusedTrackingMode ? 430 : 280,
        child: Stack(
          children: [
            FlutterMap(
              key: ValueKey(
                'live-rider-map-$mapKey-${_selectedLiveRiderId ?? 'all'}',
              ),
              mapController: _liveRiderMapController,
              options: MapOptions(
                initialCenter: fallbackCenter,
                initialZoom: isFocusedTrackingMode ? 15 : 6,
                initialCameraFit: mapCoordinates.isEmpty
                    ? null
                    : CameraFit.coordinates(
                        coordinates: mapCoordinates,
                        padding: EdgeInsets.fromLTRB(44, 56, 44, 48),
                        maxZoom: isFocusedTrackingMode ? 16 : 15,
                      ),
                interactionOptions: const InteractionOptions(
                  flags:
                      InteractiveFlag.drag |
                      InteractiveFlag.pinchZoom |
                      InteractiveFlag.doubleTapZoom,
                ),
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.onenetsol.servenow',
                  maxZoom: 19,
                ),
                MarkerLayer(
                  markers: riders
                      .map((rider) {
                        if (isFocusedTrackingMode) return null;
                        final riderId = (rider['riderId'] ?? '').toString();
                        final routeColor = _routeColorForRider(riderId);
                        final startPoint = _resolveRiderStartPoint(rider);
                        if (startPoint == null) return null;
                        return Marker(
                          point: startPoint,
                          width: 112,
                          height: 62,
                          child: _buildWaypointMarker(
                            label: 'Start',
                            icon: Icons.storefront,
                            color: routeColor,
                          ),
                        );
                      })
                      .whereType<Marker>()
                      .toList(growable: false),
                ),
                if (_liveRiderTrails.isNotEmpty)
                  PolylineLayer(
                    polylines: riders
                        .map((rider) {
                          final riderId = (rider['riderId'] ?? '').toString();
                          final points = List<latlng.LatLng>.from(
                            _liveRiderTrails[riderId] ?? const [],
                          );
                          final displayPoint = _displayPointForRider(rider);
                          if (displayPoint != null) {
                            _appendTrailPoint(points, displayPoint);
                          }
                          if (points.length < 2) return null;
                          final isSelected = riderId == _selectedLiveRiderId;
                          final routeColor = _routeColorForRider(riderId);
                          return Polyline(
                            points: points,
                            color: isSelected
                                ? routeColor
                                : routeColor.withValues(alpha: 0.52),
                            strokeWidth: isFocusedTrackingMode
                                ? 6
                                : (isSelected ? 5 : 3.5),
                          );
                        })
                        .whereType<Polyline>()
                        .toList(growable: false),
                  ),
                MarkerLayer(
                  markers: riders.map((rider) {
                    final riderId = (rider['riderId'] ?? '').toString();
                    final isSelected = riderId == _selectedLiveRiderId;
                    final routeColor = _routeColorForRider(riderId);
                    final displayPoint =
                        _displayPointForRider(rider) ??
                        latlng.LatLng(
                          (rider['latitude'] as double?) ?? 0,
                          (rider['longitude'] as double?) ?? 0,
                        );
                    return Marker(
                      point: displayPoint,
                      width: isFocusedTrackingMode ? 160 : 110,
                      height: isFocusedTrackingMode ? 170 : 76,
                      child: GestureDetector(
                        onTap: () {
                          setState(() {
                            _selectedLiveRiderId = riderId;
                          });
                          WidgetsBinding.instance.addPostFrameCallback((_) {
                            _autoFollowSelectedRider();
                          });
                          _showLiveRiderDetails(rider);
                        },
                        child: isFocusedTrackingMode
                            ? _buildTrackingHeroMarker(
                                rider,
                                accentColor: routeColor,
                              )
                            : _buildMapMarker(
                                rider,
                                isSelected: isSelected,
                                accentColor: routeColor,
                              ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
            Positioned(
              top: 12,
              right: 12,
              child: _selectedLiveRiderId == null && riders.length > 1
                  ? _buildRouteLegend(riders)
                  : const SizedBox.shrink(),
            ),
            Positioned(
              top: 12,
              left: 12,
              child: _selectedLiveRiderId != null
                  ? Material(
                      color: Colors.transparent,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(999),
                        onTap: () {
                          setState(() {
                            _selectedLiveRiderId = null;
                          });
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.94),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: const Color(0xFFD7E3F4)),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.08),
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.arrow_back_rounded,
                                size: 16,
                                color: Colors.black87,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                selectedRiderName == null
                                    ? _tr('Back to all riders')
                                    : 'Back from $selectedRiderName',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: Colors.black87,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
            if (focusedRider == null)
              Positioned(
                left: 12,
                right: 12,
                bottom: 10,
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: const Color(0xFFD7E3F4)),
                      ),
                      child: const Text(
                        'Map data OpenStreetMap contributors',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: Colors.black87,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: const Color(0xFFD7E3F4)),
                      ),
                      child: const Text(
                        'Tap a rider pin',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: Colors.black87,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildTrackingHeroMarker(
    Map<String, dynamic> rider, {
    required Color accentColor,
  }) {
    final riderName = (rider['riderName'] ?? 'Rider').toString().trim();
    final initial = riderName.isEmpty
        ? 'R'
        : String.fromCharCode(riderName.runes.first);
    final speedLabel = _speedLabelForRider(rider);

    return SizedBox(
      width: 160,
      height: 170,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          Positioned(
            top: 0,
            child: AnimatedOpacity(
              opacity: speedLabel == null ? 0 : 1,
              duration: const Duration(milliseconds: 220),
              child: IgnorePointer(
                ignoring: true,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.96),
                    borderRadius: BorderRadius.circular(999),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.12),
                        blurRadius: 12,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.local_shipping_rounded,
                        size: 16,
                        color: Color(0xFF0F766E),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        speedLabel ?? '',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF111827),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 24,
            child: Container(
              width: 26,
              height: 26,
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.20),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            bottom: 18,
            child: Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                color: accentColor,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: accentColor.withValues(alpha: 0.28),
                    blurRadius: 12,
                    spreadRadius: 2,
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            top: 34,
            child: Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const LinearGradient(
                  colors: [Color(0xFFFFA000), Color(0xFFFF6F00)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                border: Border.all(
                  color: accentColor.withValues(alpha: 0.92),
                  width: 4,
                ),
                boxShadow: [
                  BoxShadow(
                    color: accentColor.withValues(alpha: 0.22),
                    blurRadius: 22,
                    spreadRadius: 3,
                  ),
                ],
              ),
              child: Center(
                child: Text(
                  initial.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: 32,
            bottom: 34,
            child: Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: const Color(0xFF10B981),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
              ),
              child: const Icon(
                Icons.bolt_rounded,
                size: 13,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFocusedRiderTrackingCard(Map<String, dynamic> rider) {
    final riderId = (rider['riderId'] ?? '').toString();
    final riderName = (rider['riderName'] ?? 'Rider').toString();
    final routeColor = _routeColorForRider(riderId);
    final locationLabel = _liveLocationLabelForRider(rider);
    final storeName = (rider['storeName'] ?? '').toString().trim();
    final orderNumber = (rider['orderNumber'] ?? '').toString().trim();
    final distanceKm = _distanceKmForRider(rider);
    final etaMinutes = _etaMinutesForRider(rider);
    final trailPoints = _liveRiderTrails[riderId]?.length ?? 1;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.98),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10),
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      riderName,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _formatLiveUpdatedLabel(rider['createdAt'] as DateTime?),
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: routeColor.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  _speedLabelForRider(rider) ?? 'Live',
                  style: TextStyle(
                    color: routeColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            locationLabel,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: Color(0xFF111827),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            storeName.isEmpty ? _tr('Location') : storeName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Color(0xFF6B7280),
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _buildTrackingMetricPill(
                icon: Icons.pin_outlined,
                label: orderNumber.isEmpty ? 'Order unassigned' : orderNumber,
              ),
              _buildTrackingMetricPill(
                icon: Icons.timeline_rounded,
                label: '${trailPoints.toString()} points',
              ),
              _buildTrackingMetricPill(
                icon: Icons.social_distance_rounded,
                label: _formatDistanceKm(distanceKm),
              ),
              _buildTrackingMetricPill(
                icon: Icons.schedule_rounded,
                label: _formatEtaMinutes(etaMinutes),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTrackingMetricPill({
    required IconData icon,
    required String label,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: const Color(0xFF475569)),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
              color: Color(0xFF1F2937),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteLegend(List<Map<String, dynamic>> riders) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 170),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD7E3F4)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _tr('Routes'),
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          ...riders.map((rider) {
            final riderId = (rider['riderId'] ?? '').toString();
            final riderName = (rider['riderName'] ?? 'Rider').toString();
            final routeColor = _routeColorForRider(riderId);
            return Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: () {
                  setState(() {
                    _selectedLiveRiderId = riderId;
                  });
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    _autoFollowSelectedRider();
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 4,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 14,
                        height: 4,
                        decoration: BoxDecoration(
                          color: routeColor,
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          riderName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            color: Colors.black87,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildMapMarker(
    Map<String, dynamic> rider, {
    bool isSelected = false,
    required Color accentColor,
  }) {
    final riderName = (rider['riderName'] ?? 'Rider').toString();
    final status = (rider['status'] ?? '').toString().replaceAll('_', ' ');
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 96),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: isSelected ? 32 : 28,
                height: isSelected ? 32 : 28,
                decoration: BoxDecoration(
                  color: isSelected
                      ? accentColor.withValues(alpha: 0.22)
                      : accentColor.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: accentColor.withValues(alpha: 0.26),
                      blurRadius: 12,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),
              Container(
                width: isSelected ? 18 : 16,
                height: isSelected ? 18 : 16,
                decoration: BoxDecoration(
                  color: isSelected ? accentColor : accentColor,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.delivery_dining,
                  size: 10,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            riderName,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: Colors.black87,
            ),
          ),
          Text(
            status.isEmpty ? 'Live' : status,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: accentColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWaypointMarker({
    required String label,
    required IconData icon,
    required Color color,
  }) {
    return Align(
      alignment: Alignment.topLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.28)),
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.12),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showLiveRiderDetails(Map<String, dynamic> rider) {
    final riderId = (rider['riderId'] ?? '').toString();
    final routeColor = _routeColorForRider(riderId);
    final riderName = (rider['riderName'] ?? 'Rider').toString();
    final orderNumber = (rider['orderNumber'] ?? '-').toString();
    final storeName = (rider['storeName'] ?? 'Unknown Store').toString();
    final status = (rider['status'] ?? '').toString().replaceAll('_', ' ');
    final livePoint = _displayPointForRider(rider);
    final liveLocation = _liveLocationLabelForRider(rider);
    final trailPoints = _liveRiderTrails[riderId]?.length ?? 1;
    final assignedOrder = orderNumber.isEmpty ? 'Not assigned' : orderNumber;
    final distanceKm = _distanceKmForRider(rider);
    final etaMinutes = _etaMinutesForRider(rider);

    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  riderName,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: routeColor,
                  ),
                ),
                const SizedBox(height: 10),
                _buildLiveDetailRow(
                  Icons.assignment_turned_in,
                  _tr('Assigned Order'),
                  assignedOrder,
                ),
                _buildLiveDetailRow(Icons.storefront, 'Store', storeName),
                _buildLiveDetailRow(
                  Icons.local_shipping,
                  _tr('Status'),
                  status.isEmpty ? 'Live' : status,
                ),
                _buildLiveDetailRow(
                  Icons.timeline,
                  _tr('Trail Points'),
                  trailPoints.toString(),
                ),
                _buildLiveDetailRow(
                  Icons.social_distance,
                  _tr('Distance'),
                  _formatDistanceKm(distanceKm),
                ),
                _buildLiveDetailRow(
                  Icons.schedule,
                  _tr('ETA'),
                  _formatEtaMinutes(etaMinutes),
                ),
                _buildLiveDetailRow(Icons.place, _tr('Location'), liveLocation),
                _buildLiveDetailRow(
                  Icons.explore,
                  _tr('Coordinates'),
                  _shortCoordinateLabel(livePoint),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildLiveDetailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: const Color(0xFFB45309)),
          const SizedBox(width: 10),
          Expanded(
            child: RichText(
              text: TextSpan(
                style: const TextStyle(color: Colors.black87, fontSize: 14),
                children: [
                  TextSpan(
                    text: '$label: ',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  TextSpan(text: value),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRiderInfoChip(Map<String, dynamic> rider) {
    final riderId = (rider['riderId'] ?? '').toString();
    final routeColor = _routeColorForRider(riderId);
    final riderName = (rider['riderName'] ?? 'Rider').toString();
    final orderNumber = (rider['orderNumber'] ?? '').toString();
    final storeName = (rider['storeName'] ?? '').toString();
    final locationLabel = _liveLocationLabelForRider(rider);
    final trailPoints = _liveRiderTrails[riderId]?.length ?? 1;
    final distanceKm = _distanceKmForRider(rider);
    final etaMinutes = _etaMinutesForRider(rider);
    final isSelected = riderId == _selectedLiveRiderId;

    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedLiveRiderId = riderId;
        });
        _showLiveRiderDetails(rider);
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        width: 170,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: isSelected
              ? routeColor.withValues(alpha: 0.10)
              : routeColor.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isSelected ? routeColor : routeColor.withValues(alpha: 0.32),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 30,
              height: 5,
              decoration: BoxDecoration(
                color: routeColor,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              riderName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
            ),
            if (orderNumber.isNotEmpty)
              Text(
                'Assigned: $orderNumber',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.black87,
                ),
              ),
            if (storeName.isNotEmpty)
              Text(
                storeName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: Colors.black54),
              ),
            const SizedBox(height: 4),
            Text(
              locationLabel,
              style: const TextStyle(
                fontSize: 10.5,
                color: Color(0xFF9A3412),
                fontWeight: FontWeight.w700,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Text(
              '$trailPoints route points',
              style: TextStyle(
                fontSize: 10.5,
                color: routeColor,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${_tr('Distance')}: ${_formatDistanceKm(distanceKm)}',
              style: const TextStyle(
                fontSize: 10.5,
                color: Colors.black87,
                fontWeight: FontWeight.w700,
              ),
            ),
            Text(
              '${_tr('ETA')}: ${_formatEtaMinutes(etaMinutes)}',
              style: const TextStyle(
                fontSize: 10.5,
                color: Colors.black54,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openStoreStatusMessageDialog() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final stores = await ApiService.getStoresForAdmin(
        token,
        includeInactive: true,
      );
      if (!mounted) return;
      if (stores.isEmpty) {
        Notifier.error(context, 'No stores found');
        return;
      }

      final normalizedStores = stores
          .map(
            (s) => {
              'id': int.tryParse((s['id'] ?? '').toString()),
              'name': (s['name'] ?? 'Store').toString(),
            },
          )
          .where((s) => s['id'] != null)
          .toList();
      if (normalizedStores.isEmpty) {
        Notifier.error(context, 'No valid stores found');
        return;
      }

      int selectedStoreId = normalizedStores.first['id'] as int;
      bool isClosed = false;
      bool websiteEnabled = false;
      bool websiteBlockOrdering = false;
      bool storeSaving = false;
      bool websiteSaving = false;
      final messageCtrl = TextEditingController();
      final searchCtrl = TextEditingController();
      final websiteTitleCtrl = TextEditingController();
      final websiteMessageCtrl = TextEditingController();
      final websiteStartCtrl = TextEditingController();
      final websiteEndCtrl = TextEditingController();
      List<Map<String, dynamic>> visibleStores =
          List<Map<String, dynamic>>.from(normalizedStores);

      bool toBool(dynamic value) {
        if (value is bool) return value;
        if (value is num) return value != 0;
        if (value is String) {
          final normalized = value.trim().toLowerCase();
          return normalized == 'true' ||
              normalized == '1' ||
              normalized == 'yes';
        }
        return false;
      }

      String toDateTimeLocalString(DateTime dateTime) {
        final d = dateTime.toLocal();
        final m = d.month.toString().padLeft(2, '0');
        final day = d.day.toString().padLeft(2, '0');
        final h = d.hour.toString().padLeft(2, '0');
        final min = d.minute.toString().padLeft(2, '0');
        return '${d.year}-$m-${day}T$h:$min';
      }

      String formatForDisplay(dynamic raw) {
        final parsed = DateTime.tryParse((raw ?? '').toString());
        if (parsed == null) return '';
        return toDateTimeLocalString(parsed);
      }

      Future<void> pickDateTime(
        TextEditingController ctrl,
        void Function(VoidCallback) setDialogState,
      ) async {
        final now = DateTime.now();
        final current = DateTime.tryParse(ctrl.text.trim())?.toLocal() ?? now;
        final pickedDate = await showDatePicker(
          context: context,
          initialDate: current,
          firstDate: DateTime(now.year - 1),
          lastDate: DateTime(now.year + 5),
        );
        if (pickedDate == null) return;
        if (!mounted) return;
        final pickedTime = await showTimePicker(
          context: context,
          initialTime: TimeOfDay.fromDateTime(current),
        );
        if (pickedTime == null) return;
        final merged = DateTime(
          pickedDate.year,
          pickedDate.month,
          pickedDate.day,
          pickedTime.hour,
          pickedTime.minute,
        );
        setDialogState(() => ctrl.text = toDateTimeLocalString(merged));
      }

      Future<void> loadStoreStatus(
        int storeId,
        void Function(VoidCallback) setDialogState,
      ) async {
        try {
          final status = await ApiService.getStoreStatusMessage(
            token,
            storeId: storeId,
          );
          setDialogState(() {
            isClosed = status['is_closed'] == true;
            messageCtrl.text = (status['status_message'] ?? '').toString();
          });
        } catch (_) {
          setDialogState(() {
            isClosed = false;
            messageCtrl.text = '';
          });
        }
      }

      try {
        final initial = await ApiService.getStoreStatusMessage(
          token,
          storeId: selectedStoreId,
        );
        isClosed = initial['is_closed'] == true;
        messageCtrl.text = (initial['status_message'] ?? '').toString();
      } catch (_) {}

      try {
        final data = await ApiService.getGlobalDeliveryStatus(token);
        final status = (data['status'] is Map<String, dynamic>)
            ? (data['status'] as Map<String, dynamic>)
            : (data['global_status'] is Map<String, dynamic>)
            ? (data['global_status'] as Map<String, dynamic>)
            : data;
        websiteEnabled = toBool(status['is_enabled']);
        websiteBlockOrdering = toBool(status['block_ordering']);
        websiteTitleCtrl.text = (status['title'] ?? '').toString();
        websiteMessageCtrl.text = (status['status_message'] ?? '').toString();
        websiteStartCtrl.text = formatForDisplay(status['start_at']);
        websiteEndCtrl.text = formatForDisplay(status['end_at']);
      } catch (_) {}

      if (websiteStartCtrl.text.trim().isEmpty) {
        websiteStartCtrl.text = toDateTimeLocalString(DateTime.now());
      }
      if (websiteEndCtrl.text.trim().isEmpty) {
        websiteEndCtrl.text = toDateTimeLocalString(DateTime.now());
      }

      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) {
          return StatefulBuilder(
            builder: (dialogContext, setDialogState) {
              return AlertDialog(
                title: const Text('Store Status'),
                content: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Per-Store Status',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: searchCtrl,
                        decoration: const InputDecoration(
                          prefixIcon: Icon(Icons.search),
                          labelText: 'Search Store',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (value) {
                          final q = value.trim().toLowerCase();
                          setDialogState(() {
                            visibleStores = normalizedStores.where((s) {
                              final name = (s['name'] ?? '')
                                  .toString()
                                  .toLowerCase();
                              final id = (s['id'] ?? '').toString();
                              return q.isEmpty ||
                                  name.contains(q) ||
                                  id.contains(q);
                            }).toList();
                            if (visibleStores.isNotEmpty &&
                                !visibleStores.any(
                                  (s) => s['id'] == selectedStoreId,
                                )) {
                              selectedStoreId =
                                  visibleStores.first['id'] as int;
                            }
                          });
                        },
                      ),
                      const SizedBox(height: 8),
                      if (visibleStores.isEmpty)
                        const Align(
                          alignment: Alignment.centerLeft,
                          child: Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: Text('No stores match your search'),
                          ),
                        )
                      else
                        DropdownButtonFormField<int>(
                          key: ValueKey('store-$selectedStoreId'),
                          isExpanded: true,
                          initialValue:
                              visibleStores.any(
                                (s) => s['id'] == selectedStoreId,
                              )
                              ? selectedStoreId
                              : (visibleStores.first['id'] as int),
                          decoration: const InputDecoration(
                            labelText: 'Select Store',
                            border: OutlineInputBorder(),
                          ),
                          items: visibleStores
                              .map(
                                (s) => DropdownMenuItem<int>(
                                  value: s['id'] as int,
                                  child: Text(
                                    (s['name'] ?? 'Store').toString(),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              )
                              .toList(),
                          selectedItemBuilder: (context) => visibleStores
                              .map(
                                (s) => Text(
                                  (s['name'] ?? 'Store').toString(),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              )
                              .toList(),
                          onChanged: (value) async {
                            if (value == null) return;
                            setDialogState(() => selectedStoreId = value);
                            await loadStoreStatus(value, setDialogState);
                          },
                        ),
                      const SizedBox(height: 10),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Mark as Closed'),
                        value: isClosed,
                        onChanged: (v) => setDialogState(() => isClosed = v),
                      ),
                      TextField(
                        controller: messageCtrl,
                        maxLines: 4,
                        maxLength: 500,
                        decoration: const InputDecoration(
                          labelText: 'Status Message',
                          hintText: 'Store is closed due to maintenance...',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerRight,
                        child: ElevatedButton.icon(
                          onPressed: storeSaving
                              ? null
                              : () async {
                                  setDialogState(() => storeSaving = true);
                                  try {
                                    await ApiService.setStoreStatusMessage(
                                      token,
                                      storeId: selectedStoreId,
                                      statusMessage: messageCtrl.text.trim(),
                                      isClosed: isClosed,
                                    );
                                    if (!mounted) return;
                                    Notifier.success(
                                      context,
                                      'Store message updated successfully',
                                    );
                                  } catch (e) {
                                    if (!mounted) return;
                                    Notifier.error(
                                      context,
                                      'Failed to save store status: $e',
                                    );
                                  } finally {
                                    if (ctx.mounted) {
                                      setDialogState(() => storeSaving = false);
                                    }
                                  }
                                },
                          icon: const Icon(Icons.save_outlined),
                          label: const Text('Save Store Status'),
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 10),
                        child: Divider(height: 1),
                      ),
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Website-Wide Delivery Status',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Enable Website-Wide Message'),
                        value: websiteEnabled,
                        onChanged: (v) =>
                            setDialogState(() => websiteEnabled = v),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Block Add to Cart / Place Order'),
                        subtitle: const Text(
                          'If enabled, ordering is blocked during active time window.',
                        ),
                        value: websiteBlockOrdering,
                        onChanged: (v) =>
                            setDialogState(() => websiteBlockOrdering = v),
                      ),
                      TextField(
                        controller: websiteTitleCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Title',
                          hintText: 'Delivery Unavailable',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: websiteMessageCtrl,
                        maxLines: 4,
                        maxLength: 500,
                        decoration: const InputDecoration(
                          labelText: 'Website Message',
                          hintText:
                              'Delivery will be unavailable from ... to ...',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: websiteStartCtrl,
                              readOnly: true,
                              decoration: const InputDecoration(
                                labelText: 'Start At',
                                hintText: 'YYYY-MM-DDTHH:mm',
                                border: OutlineInputBorder(),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            tooltip: 'Pick start time',
                            onPressed: () =>
                                pickDateTime(websiteStartCtrl, setDialogState),
                            icon: const Icon(Icons.schedule),
                          ),
                          IconButton(
                            tooltip: 'Clear start time',
                            onPressed: () =>
                                setDialogState(() => websiteStartCtrl.clear()),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: websiteEndCtrl,
                              readOnly: true,
                              decoration: const InputDecoration(
                                labelText: 'End At',
                                hintText: 'YYYY-MM-DDTHH:mm',
                                border: OutlineInputBorder(),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            tooltip: 'Pick end time',
                            onPressed: () =>
                                pickDateTime(websiteEndCtrl, setDialogState),
                            icon: const Icon(Icons.schedule),
                          ),
                          IconButton(
                            tooltip: 'Clear end time',
                            onPressed: () =>
                                setDialogState(() => websiteEndCtrl.clear()),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerRight,
                        child: ElevatedButton.icon(
                          onPressed: websiteSaving
                              ? null
                              : () async {
                                  setDialogState(() => websiteSaving = true);
                                  try {
                                    if (websiteStartCtrl.text.trim().isEmpty) {
                                      websiteStartCtrl.text =
                                          toDateTimeLocalString(DateTime.now());
                                    }
                                    if (websiteEndCtrl.text.trim().isEmpty) {
                                      websiteEndCtrl.text =
                                          toDateTimeLocalString(DateTime.now());
                                    }
                                    final startAt = websiteStartCtrl.text
                                        .trim();
                                    final endAt = websiteEndCtrl.text.trim();
                                    if (startAt.isNotEmpty &&
                                        endAt.isNotEmpty) {
                                      final start = DateTime.tryParse(startAt);
                                      final end = DateTime.tryParse(endAt);
                                      if (start == null ||
                                          end == null ||
                                          !end.isAfter(start)) {
                                        Notifier.error(
                                          context,
                                          'End time must be greater than start time.',
                                        );
                                        return;
                                      }
                                    }

                                    await ApiService.setGlobalDeliveryStatus(
                                      token,
                                      isEnabled: websiteEnabled,
                                      blockOrdering: websiteBlockOrdering,
                                      title: websiteTitleCtrl.text,
                                      statusMessage: websiteMessageCtrl.text
                                          .trim(),
                                      startAt: startAt,
                                      endAt: endAt,
                                    );
                                    if (!mounted) return;
                                    Notifier.success(
                                      context,
                                      'Website delivery status updated successfully',
                                    );
                                  } catch (e) {
                                    if (!mounted) return;
                                    Notifier.error(
                                      context,
                                      'Failed to save website status: $e',
                                    );
                                  } finally {
                                    if (ctx.mounted) {
                                      setDialogState(
                                        () => websiteSaving = false,
                                      );
                                    }
                                  }
                                },
                          icon: const Icon(Icons.save_outlined),
                          label: const Text('Save Website Status'),
                        ),
                      ),
                    ],
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    child: const Text('Close'),
                  ),
                ],
              );
            },
          );
        },
      );
      messageCtrl.dispose();
      searchCtrl.dispose();
      websiteTitleCtrl.dispose();
      websiteMessageCtrl.dispose();
      websiteStartCtrl.dispose();
      websiteEndCtrl.dispose();
    } catch (e) {
      if (!mounted) return;
      Notifier.error(context, 'Failed to open store message dialog: $e');
    }
  }

  Widget _buildQuickMenu(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white70),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _buildQuickMenuItem(
              context: context,
              icon: Icons.store,
              label: _tr('Stores'),
              route: '/manage-stores',
            ),
            const SizedBox(width: 10),
            _buildQuickMenuItem(
              context: context,
              icon: Icons.shopping_bag,
              label: _tr('Products'),
              route: '/manage-products',
            ),
            const SizedBox(width: 10),
            _buildQuickMenuItem(
              context: context,
              icon: Icons.receipt_long,
              label: _tr('Orders'),
              onTap: _openManageOrdersForAssignment,
            ),
            const SizedBox(width: 10),
            _buildQuickMenuItem(
              context: context,
              icon: Icons.inventory_2,
              label: _tr('Inventory'),
              route: '/inventory-report',
            ),
            const SizedBox(width: 10),
            _buildQuickMenuItem(
              context: context,
              icon: Icons.campaign,
              label: _tr('Status'),
              onTap: _openStoreStatusMessageDialog,
            ),
            const SizedBox(width: 10),
            _buildQuickMenuItem(
              context: context,
              icon: Icons.local_offer_outlined,
              label: _tr('Offers'),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => OfferCampaignsScreen(isAdmin: true),
                ),
              ),
            ),
            const SizedBox(width: 10),
            _buildQuickMenuItem(
              context: context,
              icon: Icons.view_carousel_outlined,
              label: _tr('Tile Demo'),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const CustomerTileDemoScreen(),
                ),
              ),
            ),
            const SizedBox(width: 4),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickMenuItem({
    required BuildContext context,
    required IconData icon,
    required String label,
    String? route,
    VoidCallback? onTap,
  }) {
    final VoidCallback handleTap =
        onTap ?? () => Navigator.of(context).pushNamed(route!);
    return InkWell(
      onTap: handleTap,
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: 56,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: Colors.indigo, size: 19),
            const SizedBox(height: 2),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 9.5,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVisitorsGrid() {
    return Row(
      children: [
        Expanded(
          child: _buildStatCard(
            title: 'Currently Login',
            value: _activeUsers.toString(),
            icon: Icons.person,
            color: Colors.purple,
            gradient: [Colors.purple.shade400, Colors.purple.shade700],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildStatCard(
            title: "Today's Logins",
            value: _todayLogins.toString(),
            icon: Icons.people_alt,
            color: Colors.teal,
            gradient: [Colors.teal.shade400, Colors.teal.shade700],
          ),
        ),
      ],
    );
  }

  Widget _buildStatCard({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
    required List<Color> gradient,
  }) {
    return Container(
      height: 59,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradient,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.3),
            blurRadius: 6,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Text(
                  value,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: Colors.white, size: 16),
              ),
            ],
          ),
          Text(
            title,
            style: const TextStyle(color: Colors.white70, fontSize: 11),
            overflow: TextOverflow.ellipsis,
            maxLines: 1,
          ),
        ],
      ),
    );
  }

  Widget _buildActivityFilter() {
    return Row(
      children: [
        _buildFilterChip('New Orders', 'orders'),
        const SizedBox(width: 8),
        _buildFilterChip('New Users', 'users'),
        const SizedBox(width: 8),
        _buildFilterChip('New Stores', 'stores'),
      ],
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _selectedActivityType == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (selected) {
        if (!selected) return;
        setState(() => _selectedActivityType = value);
      },
      selectedColor: Colors.indigo.withValues(alpha: 0.2),
      labelStyle: TextStyle(
        color: isSelected ? Colors.indigo : Colors.grey[700],
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: isSelected ? Colors.indigo : Colors.grey[300]!),
      ),
    );
  }

  Widget _buildRecentActivityList() {
    if (_selectedActivityType == 'orders') {
      return _buildNewOrdersList();
    }

    List<dynamic> list;
    switch (_selectedActivityType) {
      case 'users':
        list = _recentUsersList;
        break;
      case 'stores':
        list = _recentStoresList;
        break;
      default:
        list = _recentOrdersList;
        break;
    }

    if (list.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: Text('No recent activity'),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        children: [
          ...list.map((activity) {
            return Column(
              children: [
                InkWell(
                  onTap: () => _showActivityDetails(activity),
                  child: _buildActivityItem(
                    title: activity['title'] ?? '',
                    subtitle: activity['subtitle'] ?? '',
                    icon: _getIconData(activity['icon']),
                    color: _getColor(activity['color']),
                  ),
                ),
                if (activity != list.last) const Divider(height: 1),
              ],
            );
          }),
        ],
      ),
    );
  }

  Widget _buildNewOrdersList() {
    if (_assignableOrdersList.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: Text('No new orders to assign'),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        children: [
          ..._assignableOrdersList.map((raw) {
            if (raw is! Map) return const SizedBox.shrink();
            final order = raw.cast<String, dynamic>();
            final id = int.tryParse((order['id'] ?? '').toString()) ?? 0;
            final orderNo = (order['order_number'] ?? '#$id').toString();
            final status = (order['status'] ?? 'pending').toString();
            final riderId = int.tryParse((order['rider_id'] ?? '').toString());
            final total =
                double.tryParse((order['total_amount'] ?? '0').toString()) ?? 0;
            final subtitle =
                'PKR ${total.toStringAsFixed(0)} | ${riderId == null ? "Unassigned" : "Assigned"} | $status';

            return Column(
              children: [
                InkWell(
                  onTap: id > 0
                      ? () => _openOrderAssignmentDialog({
                          'type': 'order',
                          'order_id': id,
                        })
                      : null,
                  child: _buildActivityItem(
                    title: 'Order $orderNo',
                    subtitle: subtitle,
                    icon: Icons.receipt_long,
                    color: riderId == null ? Colors.orange : Colors.blue,
                  ),
                ),
                if (raw != _assignableOrdersList.last) const Divider(height: 1),
              ],
            );
          }),
        ],
      ),
    );
  }

  Widget _buildActivityItem({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
  }) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        child: Icon(icon, color: color),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: TextStyle(color: Colors.grey[600])),
      trailing: const Icon(Icons.chevron_right, color: Colors.grey),
    );
  }

  IconData _getIconData(String? iconName) {
    switch (iconName) {
      case 'shopping_bag':
        return Icons.shopping_bag;
      case 'person_add':
        return Icons.person_add;
      case 'store':
        return Icons.store;
      default:
        return Icons.notifications;
    }
  }

  Color _getColor(String? colorName) {
    switch (colorName) {
      case 'blue':
        return Colors.blue;
      case 'green':
        return Colors.green;
      case 'orange':
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  int? _extractOrderIdFromActivity(Map<String, dynamic> activity) {
    final direct = int.tryParse((activity['order_id'] ?? '').toString());
    if (direct != null && direct > 0) return direct;

    final details = activity['details'];
    if (details is Map<String, dynamic>) {
      final rawOrderId = (details['Order ID'] ?? details['order_id'] ?? '')
          .toString()
          .trim();
      final clean = rawOrderId.replaceAll(RegExp(r'[^0-9]'), '');
      final parsed = int.tryParse(clean);
      if (parsed != null && parsed > 0) return parsed;
    }

    final title = (activity['title'] ?? '').toString();
    final match = RegExp(r'#\s*(\d+)').firstMatch(title);
    if (match != null) {
      final parsed = int.tryParse(match.group(1) ?? '');
      if (parsed != null && parsed > 0) return parsed;
    }
    return null;
  }

  Future<void> _openOrderAssignmentDialog(Map<String, dynamic> activity) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null || token.trim().isEmpty) {
      Notifier.error(context, 'Session expired. Please login again.');
      return;
    }

    final orderId = _extractOrderIdFromActivity(activity);
    if (orderId == null) {
      Notifier.error(context, 'Order ID not found in activity.');
      return;
    }

    try {
      final results = await Future.wait<List<dynamic>>([
        ApiService.getOrders(
          token,
          includeItemsCount: false,
          includeStoreStatuses: false,
        ),
        ApiService.getAvailableRiders(token),
      ]);
      final orders = results[0];
      final riders = results[1];
      Map<String, dynamic>? order;
      for (final raw in orders) {
        if (raw is! Map) continue;
        final map = raw.cast<String, dynamic>();
        if (int.tryParse((map['id'] ?? '').toString()) == orderId) {
          order = map;
          break;
        }
      }
      if (!mounted) return;
      if (order == null) {
        Notifier.error(context, 'Order #$orderId not found.');
        return;
      }

      final orderNumber = (order['order_number'] ?? orderId).toString();
      final totalAmount =
          double.tryParse((order['total_amount'] ?? '0').toString()) ?? 0;
      final currentStatus = (order['status'] ?? 'pending').toString();
      final initialRiderId = int.tryParse((order['rider_id'] ?? '').toString());

      String selectedStatus = currentStatus;
      int? selectedRiderId = initialRiderId;
      bool isSaving = false;
      const statusOptions = <String>[
        'pending',
        'confirmed',
        'preparing',
        'ready',
        'ready_for_pickup',
        'out_for_delivery',
        'delivered',
        'cancelled',
      ];

      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) {
          return StatefulBuilder(
            builder: (ctx, setModalState) {
              return AlertDialog(
                title: Text('Order #$orderNumber Assignment'),
                content: SizedBox(
                  width: 420,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Total: PKR ${totalAmount.toStringAsFixed(2)}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<int?>(
                          key: ValueKey<int?>(selectedRiderId),
                          initialValue: selectedRiderId,
                          decoration: const InputDecoration(
                            labelText: 'Assign Rider',
                            border: OutlineInputBorder(),
                          ),
                          items: [
                            const DropdownMenuItem<int?>(
                              value: null,
                              child: Text('Unassigned'),
                            ),
                            ...riders.map((r) {
                              final id = int.tryParse(
                                (r['id'] ?? '').toString(),
                              );
                              if (id == null) {
                                return const DropdownMenuItem<int?>(
                                  value: null,
                                  child: Text('Invalid Rider'),
                                );
                              }
                              final name =
                                  '${r['first_name'] ?? ''} ${r['last_name'] ?? ''}'
                                      .trim();
                              return DropdownMenuItem<int?>(
                                value: id,
                                child: Text(name.isEmpty ? 'Rider #$id' : name),
                              );
                            }),
                          ],
                          onChanged: isSaving
                              ? null
                              : (v) => setModalState(() => selectedRiderId = v),
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          key: ValueKey<String>(selectedStatus),
                          initialValue: selectedStatus,
                          decoration: const InputDecoration(
                            labelText: 'Order Status',
                            border: OutlineInputBorder(),
                          ),
                          items: statusOptions
                              .map(
                                (s) => DropdownMenuItem<String>(
                                  value: s,
                                  child: Text(s),
                                ),
                              )
                              .toList(),
                          onChanged: isSaving
                              ? null
                              : (v) {
                                  if (v != null) {
                                    setModalState(() => selectedStatus = v);
                                  }
                                },
                        ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: isSaving ? null : () => Navigator.of(ctx).pop(),
                    child: const Text('Cancel'),
                  ),
                  ElevatedButton(
                    onPressed: isSaving
                        ? null
                        : () async {
                            setModalState(() => isSaving = true);
                            try {
                              bool changed = false;
                              if (selectedRiderId != null &&
                                  selectedRiderId != initialRiderId) {
                                await ApiService.assignOrderRider(
                                  token,
                                  orderId,
                                  selectedRiderId!,
                                );
                                changed = true;
                              }
                              if (selectedStatus != currentStatus) {
                                await ApiService.updateOrderStatus(
                                  token,
                                  orderId,
                                  selectedStatus,
                                );
                                changed = true;
                              }
                              if (ctx.mounted) Navigator.of(ctx).pop();
                              if (!mounted) return;
                              if (changed) {
                                Notifier.success(
                                  context,
                                  'Order #$orderNumber updated successfully.',
                                );
                                _loadStats();
                              } else {
                                Notifier.info(context, 'No changes applied.');
                              }
                            } catch (e) {
                              if (mounted) {
                                Notifier.error(
                                  context,
                                  'Failed to update order: $e',
                                );
                              }
                            } finally {
                              if (ctx.mounted) {
                                setModalState(() => isSaving = false);
                              }
                            }
                          },
                    child: isSaving
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Save'),
                  ),
                ],
              );
            },
          );
        },
      );
    } catch (e) {
      if (!mounted) return;
      Notifier.error(context, 'Failed to load assignment data: $e');
    }
  }

  Future<void> _openManageOrdersForAssignment() async {
    await _loadStats();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return SafeArea(
          child: Container(
            height: MediaQuery.of(ctx).size.height * 0.86,
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 10, 8),
                  child: Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Manage Orders (Assign Riders)',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.of(ctx).pop(),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: _assignableOrdersList.isEmpty
                      ? const Center(
                          child: Text('No new orders pending assignment'),
                        )
                      : ListView.separated(
                          itemCount: _assignableOrdersList.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, index) {
                            final raw = _assignableOrdersList[index];
                            if (raw is! Map) return const SizedBox.shrink();
                            final order = raw.cast<String, dynamic>();
                            final id =
                                int.tryParse((order['id'] ?? '').toString()) ??
                                0;
                            final orderNo = (order['order_number'] ?? '#$id')
                                .toString();
                            final status = (order['status'] ?? 'pending')
                                .toString();
                            final total =
                                double.tryParse(
                                  (order['total_amount'] ?? '0').toString(),
                                ) ??
                                0;
                            return ListTile(
                              leading: const CircleAvatar(
                                backgroundColor: Color(0x1AF57C00),
                                child: Icon(
                                  Icons.receipt_long,
                                  color: Colors.orange,
                                ),
                              ),
                              title: Text(
                                'Order $orderNo',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: Text(
                                'PKR ${total.toStringAsFixed(0)} | $status',
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: id <= 0
                                  ? null
                                  : () {
                                      Navigator.of(ctx).pop();
                                      _openOrderAssignmentDialog({
                                        'type': 'order',
                                        'order_id': id,
                                      });
                                    },
                            );
                          },
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showActivityDetails(Map<String, dynamic> activity) {
    final type = (activity['type'] ?? '').toString().toLowerCase();
    if (type == 'order') {
      _openOrderAssignmentDialog(activity);
      return;
    }
    String detailsStr = '';
    if (activity['details'] != null) {
      detailsStr = (activity['details'] as Map<String, dynamic>).entries
          .map((e) => '${e.key}: ${e.value ?? "N/A"}')
          .join('\n');
    }

    Notifier.info(
      context,
      '${activity['title'] ?? "Activity Details"}\n$detailsStr',
      duration: const Duration(seconds: 5),
    );
  }
}

class _SimpleTrendPainter extends CustomPainter {
  _SimpleTrendPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final fillPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [color.withValues(alpha: 0.24), color.withValues(alpha: 0.02)],
      ).createShader(Offset.zero & size);

    final strokePaint = Paint()
      ..color = color
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final points = <Offset>[
      Offset(size.width * 0.05, size.height * 0.72),
      Offset(size.width * 0.26, size.height * 0.44),
      Offset(size.width * 0.46, size.height * 0.56),
      Offset(size.width * 0.66, size.height * 0.74),
      Offset(size.width * 0.84, size.height * 0.48),
      Offset(size.width * 0.95, size.height * 0.18),
    ];

    final linePath = Path()..moveTo(points.first.dx, points.first.dy);
    for (var i = 1; i < points.length; i++) {
      linePath.lineTo(points[i].dx, points[i].dy);
    }

    final fillPath = Path.from(linePath)
      ..lineTo(points.last.dx, size.height)
      ..lineTo(points.first.dx, size.height)
      ..close();

    canvas.drawPath(fillPath, fillPaint);
    canvas.drawPath(linePath, strokePaint);

    final pointPaint = Paint()..color = color;
    for (final point in points) {
      canvas.drawCircle(point, 3.5, pointPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _SimpleTrendPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}
