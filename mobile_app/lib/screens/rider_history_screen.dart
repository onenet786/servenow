import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as latlng;
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/customer_palette.dart';

class _RiderHistoryPoint {
  const _RiderHistoryPoint({
    required this.point,
    required this.timestamp,
    required this.locationLabel,
    required this.orderId,
  });

  final latlng.LatLng point;
  final DateTime? timestamp;
  final String locationLabel;
  final String? orderId;
}

class _RiderOrderRoute {
  const _RiderOrderRoute({
    required this.orderId,
    required this.orderNumber,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.points,
  });

  final String orderId;
  final String orderNumber;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<_RiderHistoryPoint> points;
}

class _RiderHistoryResult {
  const _RiderHistoryResult({
    required this.riderId,
    required this.riderName,
    required this.email,
    required this.rideCount,
    required this.routes,
    required this.points,
  });

  final String riderId;
  final String riderName;
  final String email;
  final int rideCount;
  final List<_RiderOrderRoute> routes;
  final List<_RiderHistoryPoint> points;
}

class RiderHistoryScreen extends StatefulWidget {
  const RiderHistoryScreen({super.key});

  @override
  State<RiderHistoryScreen> createState() => _RiderHistoryScreenState();
}

class _RiderHistoryScreenState extends State<RiderHistoryScreen> {
  static const latlng.LatLng _defaultCenter = latlng.LatLng(31.5204, 74.3587);

  final MapController _mapController = MapController();
  bool _isLoadingRiders = true;
  bool _isLoadingHistory = false;
  String? _error;
  DateTime _selectedDate = DateTime.now();
  List<dynamic> _riders = [];
  List<_RiderHistoryResult> _results = const [];
  String? _selectedRiderId;
  String? _selectedOrderId;

  @override
  void initState() {
    super.initState();
    _loadRiders();
  }

  Future<void> _loadRiders() async {
    try {
      final token = context.read<AuthProvider>().token;
      if (token == null) {
        setState(() {
          _isLoadingRiders = false;
          _error = 'Admin session expired. Please login again.';
        });
        return;
      }

      final riders = await ApiService.getRiders(token);
      if (!mounted) return;
      setState(() {
        _riders = riders;
        _isLoadingRiders = false;
      });
      await _loadHistoryForDate();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingRiders = false;
        _error = 'Failed to load riders: $e';
      });
    }
  }

  DateTime _startOfDay(DateTime value) {
    return DateTime(value.year, value.month, value.day);
  }

  DateTime _endOfDay(DateTime value) {
    return DateTime(value.year, value.month, value.day, 23, 59, 59, 999);
  }

  DateTime? _parseTime(dynamic value) {
    if (value == null) return null;
    try {
      return DateTime.parse(value.toString()).toLocal();
    } catch (_) {
      return null;
    }
  }

  String _riderName(dynamic rider) {
    final first = (rider['first_name'] ?? '').toString().trim();
    final last = (rider['last_name'] ?? '').toString().trim();
    final full = '$first $last'.trim();
    if (full.isNotEmpty) return full;
    return (rider['email'] ?? 'Rider').toString();
  }

  _RiderHistoryResult? _resultByRiderId(String? riderId) {
    if (riderId == null || riderId.isEmpty) return null;
    for (final result in _results) {
      if (result.riderId == riderId) return result;
    }
    return null;
  }

  DateTime? _normalizeOrderEndTime({
    required DateTime? createdAt,
    required DateTime? updatedAt,
    required DateTime endOfDay,
  }) {
    if (updatedAt == null) return null;
    if (createdAt != null && updatedAt.isBefore(createdAt)) return null;
    if (updatedAt.isAfter(endOfDay)) return endOfDay;
    return updatedAt;
  }

  Future<void> _loadHistoryForDate() async {
    final token = context.read<AuthProvider>().token;
    if (token == null || _riders.isEmpty) return;

    final start = _startOfDay(_selectedDate);
    final end = _endOfDay(_selectedDate);
    final now = DateTime.now();

    if (start.isAfter(now)) {
      setState(() {
        _results = const [];
        _selectedRiderId = null;
        _selectedOrderId = null;
        _error = 'Selected date is in the future.';
      });
      return;
    }

    final riderIds = _riders
        .map((rider) => (rider['id'] ?? '').toString().trim())
        .where((id) => id.isNotEmpty)
        .toList(growable: false);

    if (riderIds.isEmpty) {
      setState(() {
        _results = const [];
        _selectedRiderId = null;
        _selectedOrderId = null;
        _error = 'No riders available.';
      });
      return;
    }

    final hours = now.difference(start).inHours + 2;

    setState(() {
      _isLoadingHistory = true;
      _error = null;
    });

    try {
      final orders = await ApiService.getOrders(
        token,
        includeItemsCount: false,
        includeStoreStatuses: false,
        startDate: start.toIso8601String(),
        endDate: end.toIso8601String(),
      );
      final response = await ApiService.getRiderLocationHistory(
        token,
        riderIds: riderIds,
        hours: hours.clamp(24, 24 * 45),
        limit: 2500,
      );

      final ordersByRiderId = <String, List<Map<String, dynamic>>>{};
      for (final raw in orders) {
        if (raw is! Map) continue;
        final order = raw.cast<String, dynamic>();
        final riderId = (order['rider_id'] ?? '').toString().trim();
        if (riderId.isEmpty) continue;
        final orderId = (order['id'] ?? '').toString().trim();
        if (orderId.isEmpty) continue;
        final createdAt = _parseTime(order['created_at']);
        final updatedAt = _parseTime(order['updated_at']);
        ordersByRiderId.putIfAbsent(riderId, () => <Map<String, dynamic>>[]).add({
          'id': orderId,
          'order_number': (order['order_number'] ?? orderId).toString().trim(),
          'status': (order['status'] ?? '').toString().trim(),
          'created_at': createdAt,
          'updated_at': updatedAt,
        });
      }

      final rawHistories =
          (response['histories'] as Map?)?.cast<String, dynamic>() ??
          const <String, dynamic>{};
      final results = <_RiderHistoryResult>[];

      for (final rider in _riders) {
        final riderId = (rider['id'] ?? '').toString().trim();
        if (riderId.isEmpty) continue;
        final riderOrders =
            ordersByRiderId[riderId]?.toList(growable: false) ??
            const <Map<String, dynamic>>[];
        if (riderOrders.isEmpty) continue;
        final entries = rawHistories[riderId];
        final points = <_RiderHistoryPoint>[];
        if (entries is List) {
          for (final raw in entries) {
            if (raw is! Map) continue;
            final entry = raw.cast<String, dynamic>();
            final latitude = double.tryParse((entry['latitude'] ?? '').toString());
            final longitude = double.tryParse((entry['longitude'] ?? '').toString());
            if (latitude == null || longitude == null) continue;
            final timestamp = _parseTime(entry['created_at']);
            if (timestamp == null) continue;
            if (timestamp.isBefore(start) || timestamp.isAfter(end)) continue;
            final locationLabel = (entry['location_label'] ?? '')
                .toString()
                .trim();
            final orderId = (entry['order_id'] ?? '').toString().trim();
            points.add(
              _RiderHistoryPoint(
                point: latlng.LatLng(latitude, longitude),
                timestamp: timestamp,
                locationLabel: locationLabel,
                orderId: orderId.isEmpty ? null : orderId,
              ),
            );
          }
        }

        points.sort((a, b) {
          final aTime = a.timestamp ?? DateTime.fromMillisecondsSinceEpoch(0);
          final bTime = b.timestamp ?? DateTime.fromMillisecondsSinceEpoch(0);
          return aTime.compareTo(bTime);
        });

        riderOrders.sort((a, b) {
          final aTime =
              (a['updated_at'] as DateTime?) ?? (a['created_at'] as DateTime?);
          final bTime =
              (b['updated_at'] as DateTime?) ?? (b['created_at'] as DateTime?);
          if (aTime == null && bTime == null) return 0;
          if (aTime == null) return 1;
          if (bTime == null) return -1;
          return aTime.compareTo(bTime);
        });

        final routes = <_RiderOrderRoute>[];
        DateTime? previousRouteEnd;
        for (var i = 0; i < riderOrders.length; i++) {
          final order = riderOrders[i];
          final createdAt = order['created_at'] as DateTime?;
          final updatedAt = _normalizeOrderEndTime(
            createdAt: createdAt,
            updatedAt: order['updated_at'] as DateTime?,
            endOfDay: end,
          );

          DateTime? routeStart = previousRouteEnd == null
              ? createdAt
              : previousRouteEnd.add(const Duration(seconds: 1));
          if (routeStart == null) {
            routeStart = start;
          }
          if (createdAt != null && createdAt.isAfter(routeStart)) {
            routeStart = createdAt;
          }

          DateTime? routeEnd = updatedAt;
          if (routeEnd == null) {
            routeEnd = i + 1 < riderOrders.length
                ? ((riderOrders[i + 1]['updated_at'] as DateTime?) ??
                      (riderOrders[i + 1]['created_at'] as DateTime?))
                    ?.subtract(const Duration(seconds: 1))
                : end;
          }
          if (routeEnd != null && routeEnd.isBefore(routeStart)) {
            routeEnd = routeStart.add(const Duration(minutes: 90));
          }

          var routePoints = points
              .where((entry) => entry.orderId == (order['id'] ?? '').toString())
              .toList(growable: false);

          if (routePoints.isEmpty) {
            routePoints = points.where((entry) {
              final timestamp = entry.timestamp;
              if (timestamp == null) return false;
              if (timestamp.isBefore(routeStart!)) return false;
              if (routeEnd != null && timestamp.isAfter(routeEnd)) return false;
              return true;
            }).toList(growable: false);
          }

          if (routeEnd != null) {
            previousRouteEnd = routeEnd;
          }

          routes.add(
            _RiderOrderRoute(
              orderId: (order['id'] ?? '').toString(),
              orderNumber: (order['order_number'] ?? order['id'] ?? '').toString(),
              status: (order['status'] ?? '').toString(),
              createdAt: createdAt,
              updatedAt: updatedAt,
              points: routePoints,
            ),
          );
        }

        results.add(
          _RiderHistoryResult(
            riderId: riderId,
            riderName: _riderName(rider),
            email: (rider['email'] ?? '').toString(),
            rideCount: riderOrders.length,
            routes: routes,
            points: points,
          ),
        );
      }

      results.sort((a, b) => b.rideCount.compareTo(a.rideCount));

      String? selectedId = _selectedRiderId;
      final stillExists = results.any((item) => item.riderId == selectedId);
      if (!stillExists) {
        selectedId = results.isEmpty ? null : results.first.riderId;
      }
      String? selectedOrderId = _selectedOrderId;
      _RiderHistoryResult? selectedResult;
      for (final item in results) {
        if (item.riderId == selectedId) {
          selectedResult = item;
          break;
        }
      }
      final orderStillExists = selectedResult?.routes.any(
            (route) => route.orderId == selectedOrderId,
          ) ??
          false;
      if (!orderStillExists) {
        selectedOrderId =
            selectedResult?.routes.isEmpty ?? true
                ? null
                : selectedResult!.routes.first.orderId;
      }

      if (!mounted) return;
      setState(() {
        _results = results;
        _selectedRiderId = selectedId;
        _selectedOrderId = selectedOrderId;
        _isLoadingHistory = false;
        if (results.isEmpty) {
          _error = 'No rider movement found for the selected date.';
        }
      });

      _fitSelectedRoute();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingHistory = false;
        _results = const [];
        _selectedRiderId = null;
        _selectedOrderId = null;
        _error = 'Failed to load ride history: $e';
      });
    }
  }

  _RiderHistoryResult? _selectedResult() {
    for (final result in _results) {
      if (result.riderId == _selectedRiderId) return result;
    }
    return null;
  }

  _RiderOrderRoute? _selectedRoute() {
    final result = _selectedResult();
    if (result == null) return null;
    for (final route in result.routes) {
      if (route.orderId == _selectedOrderId) return route;
    }
    return result.routes.isEmpty ? null : result.routes.first;
  }

  void _fitSelectedRoute() {
    final selected = _selectedRoute();
    if (selected == null || selected.points.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _mapController.fitCamera(
        CameraFit.coordinates(
          coordinates: selected.points.map((e) => e.point).toList(growable: false),
          padding: const EdgeInsets.all(48),
          maxZoom: 16,
        ),
      );
    });
  }

  String _formatDate(DateTime value) {
    final day = value.day.toString().padLeft(2, '0');
    final month = value.month.toString().padLeft(2, '0');
    return '$day/$month/${value.year}';
  }

  String _formatMoment(DateTime? value) {
    if (value == null) return '-';
    final hour = value.hour % 12 == 0 ? 12 : value.hour % 12;
    final minute = value.minute.toString().padLeft(2, '0');
    final suffix = value.hour >= 12 ? 'pm' : 'am';
    return '${value.day}/${value.month} $hour:$minute $suffix';
  }

  String _riderDropdownLabel(_RiderHistoryResult result) {
    return '${result.riderName} (${result.rideCount})';
  }

  String _orderDropdownLabel(_RiderOrderRoute route) {
    return '${route.orderNumber}  ${_formatMoment(route.createdAt)}';
  }

  double _distanceKmForPoints(List<_RiderHistoryPoint> points) {
    if (points.length < 2) return 0;
    final distance = latlng.Distance();
    var meters = 0.0;
    for (var i = 1; i < points.length; i++) {
      meters += distance(points[i - 1].point, points[i].point);
    }
    return meters / 1000;
  }

  Widget _summaryChip({
    required IconData icon,
    required String label,
    required String value,
    required Color tint,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: tint.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: tint),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: CustomerPalette.textMuted,
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: tint,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate.isAfter(now) ? now : _selectedDate,
      firstDate: now.subtract(const Duration(days: 45)),
      lastDate: now,
    );
    if (picked == null) return;
    setState(() {
      _selectedDate = picked;
    });
    await _loadHistoryForDate();
  }

  Widget _markerTag({
    required IconData icon,
    required String label,
    required Color color,
  }) {
    return Align(
      alignment: Alignment.topLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
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

  @override
  Widget build(BuildContext context) {
    final selected = _selectedResult();
    final selectedRoute = _selectedRoute();
    final selectedPoints =
        selectedRoute?.points.map((entry) => entry.point).toList(growable: false) ??
        const <latlng.LatLng>[];
    final selectedDistance =
        selectedRoute == null ? 0.0 : _distanceKmForPoints(selectedRoute.points);
    final startedAt = selectedRoute?.createdAt;
    final endedAt =
        selectedRoute?.points.isNotEmpty == true
            ? selectedRoute!.points.last.timestamp
            : selectedRoute?.updatedAt;

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FC),
      appBar: AppBar(
        title: const Text('Ride History'),
        backgroundColor: Colors.white,
        foregroundColor: CustomerPalette.textDark,
        elevation: 0,
      ),
      body: _isLoadingRiders
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadHistoryForDate,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: CustomerPalette.border),
                      boxShadow: [
                        BoxShadow(
                          color: CustomerPalette.primaryDark.withValues(alpha: 0.08),
                          blurRadius: 18,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Rider History By Date',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            color: CustomerPalette.textDark,
                          ),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Pick a date to list all riders who moved that day. Tap any rider to show that rider route on the map.',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: CustomerPalette.textMuted,
                          ),
                        ),
                        const SizedBox(height: 14),
                        InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: _pickDate,
                          child: Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 14,
                            ),
                            decoration: BoxDecoration(
                              color: CustomerPalette.background,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: CustomerPalette.border),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.calendar_month_rounded,
                                  color: CustomerPalette.primaryDark,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    _formatDate(_selectedDate),
                                    style: const TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w800,
                                      color: CustomerPalette.textDark,
                                    ),
                                  ),
                                ),
                                const Icon(
                                  Icons.expand_more_rounded,
                                  color: CustomerPalette.textMuted,
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            _summaryChip(
                              icon: Icons.two_wheeler,
                              label: 'Riders',
                              value: _results.length.toString(),
                              tint: CustomerPalette.secondaryDark,
                            ),
                            _summaryChip(
                              icon: Icons.assignment_turned_in_outlined,
                              label: 'Selected Rider Rides',
                              value: selected?.rideCount.toString() ?? '0',
                              tint: CustomerPalette.primaryDark,
                            ),
                            _summaryChip(
                              icon: Icons.route_rounded,
                              label: 'Selected Ride Points',
                              value: selectedRoute?.points.length.toString() ?? '0',
                              tint: const Color(0xFF0F766E),
                            ),
                            _summaryChip(
                              icon: Icons.social_distance_rounded,
                              label: 'Selected Distance',
                              value:
                                  '${selectedDistance.toStringAsFixed(selectedDistance >= 10 ? 0 : 1)} km',
                              tint: const Color(0xFF92400E),
                            ),
                            _summaryChip(
                              icon: Icons.update_rounded,
                              label: 'Last Update',
                              value: _formatMoment(endedAt),
                              tint: const Color(0xFF1D4ED8),
                            ),
                          ],
                        ),
                        if (!_isLoadingHistory && _results.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          DropdownButtonFormField<String>(
                            initialValue: _selectedRiderId,
                            decoration: const InputDecoration(
                              labelText: 'Select Rider With Rides',
                              border: OutlineInputBorder(),
                            ),
                            isExpanded: true,
                            items: _results.map((result) {
                              return DropdownMenuItem<String>(
                                value: result.riderId,
                                child: Text(
                                  _riderDropdownLabel(result),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              );
                            }).toList(growable: false),
                            onChanged: (value) {
                              if (value == null) return;
                              final rider = _resultByRiderId(value);
                              setState(() {
                                _selectedRiderId = value;
                                _selectedOrderId =
                                    rider?.routes.isEmpty ?? true
                                        ? null
                                        : rider!.routes.first.orderId;
                              });
                              _fitSelectedRoute();
                            },
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<String>(
                            initialValue: _selectedOrderId,
                            decoration: const InputDecoration(
                              labelText: 'Select Ride / Order',
                              border: OutlineInputBorder(),
                            ),
                            isExpanded: true,
                            items:
                                (selected?.routes ?? const <_RiderOrderRoute>[])
                                    .map((route) {
                                      return DropdownMenuItem<String>(
                                        value: route.orderId,
                                        child: Text(
                                          _orderDropdownLabel(route),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      );
                                    })
                                    .toList(growable: false),
                            onChanged: (value) {
                              if (value == null) return;
                              setState(() {
                                _selectedOrderId = value;
                              });
                              _fitSelectedRoute();
                            },
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    height: 340,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: CustomerPalette.border),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: _isLoadingHistory
                        ? const Center(child: CircularProgressIndicator())
                        : _error != null && _results.isEmpty
                        ? Center(child: Text(_error!))
                        : selected == null
                        ? const Center(
                            child: Text(
                              'Select a date, rider, and ride to view the route map.',
                            ),
                          )
                        : selectedRoute == null
                        ? const Center(
                            child: Text(
                              'No ride is selected for this rider yet.',
                            ),
                          )
                        : selectedPoints.isEmpty
                        ? const Center(
                            child: Text(
                              'This ride has no recorded tracking route points in its delivery window.',
                            ),
                          )
                        : FlutterMap(
                            mapController: _mapController,
                            options: MapOptions(
                              initialCenter: selectedPoints.isEmpty
                                  ? _defaultCenter
                                  : selectedPoints.last,
                              initialZoom: 14,
                            ),
                            children: [
                              TileLayer(
                                urlTemplate:
                                    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                                userAgentPackageName: 'com.onenetsol.servenow',
                              ),
                              PolylineLayer(
                                polylines: [
                                  Polyline(
                                    points: selectedPoints,
                                    color: CustomerPalette.secondary,
                                    strokeWidth: 5,
                                  ),
                                ],
                              ),
                              MarkerLayer(
                                markers: [
                                  Marker(
                                    point: selectedPoints.first,
                                    width: 90,
                                    height: 44,
                                    child: _markerTag(
                                      icon: Icons.play_arrow_rounded,
                                      label: 'Start',
                                      color: const Color(0xFF166534),
                                    ),
                                  ),
                                  Marker(
                                    point: selectedPoints.last,
                                    width: 110,
                                    height: 78,
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Container(
                                          width: 40,
                                          height: 40,
                                          decoration: BoxDecoration(
                                            color: CustomerPalette.primary,
                                            shape: BoxShape.circle,
                                            boxShadow: [
                                              BoxShadow(
                                                color: CustomerPalette.primaryDark
                                                    .withValues(alpha: 0.24),
                                                blurRadius: 12,
                                              ),
                                            ],
                                          ),
                                          child: const Icon(
                                            Icons.two_wheeler,
                                            color: Colors.white,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          selectedRoute.orderNumber,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w800,
                                            color: CustomerPalette.textDark,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: CustomerPalette.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Riders On Selected Date',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                            color: CustomerPalette.textDark,
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (_isLoadingHistory)
                          const Center(child: CircularProgressIndicator())
                        else if (_results.isEmpty)
                          Text(
                            _error ?? 'No riders found for the selected date.',
                            style: const TextStyle(color: CustomerPalette.textMuted),
                          )
                        else
                          ..._results.map((result) {
                            final isSelected = result.riderId == _selectedRiderId;
                            final distanceKm = _distanceKmForPoints(result.points);
                            final started =
                                result.points.isEmpty ? null : result.points.first.timestamp;
                            final updated =
                                result.points.isEmpty ? null : result.points.last.timestamp;
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(18),
                                onTap: () {
                                  setState(() {
                                    _selectedRiderId = result.riderId;
                                    _selectedOrderId =
                                        result.routes.isEmpty
                                            ? null
                                            : result.routes.first.orderId;
                                  });
                                  _fitSelectedRoute();
                                },
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 180),
                                  padding: const EdgeInsets.all(14),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? CustomerPalette.secondary.withValues(alpha: 0.08)
                                        : Colors.white,
                                    borderRadius: BorderRadius.circular(18),
                                    border: Border.all(
                                      color: isSelected
                                          ? CustomerPalette.secondary
                                          : CustomerPalette.border,
                                    ),
                                  ),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        width: 40,
                                        height: 40,
                                        decoration: BoxDecoration(
                                          color: isSelected
                                              ? CustomerPalette.primary
                                              : CustomerPalette.primary.withValues(
                                                  alpha: 0.12,
                                                ),
                                          borderRadius: BorderRadius.circular(14),
                                        ),
                                        child: Icon(
                                          Icons.two_wheeler,
                                          color: isSelected
                                              ? Colors.white
                                              : CustomerPalette.primaryDark,
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              result.riderName,
                                              style: const TextStyle(
                                                fontSize: 14,
                                                fontWeight: FontWeight.w900,
                                                color: CustomerPalette.textDark,
                                              ),
                                            ),
                                            if (result.email.isNotEmpty)
                                              Padding(
                                                padding: const EdgeInsets.only(top: 2),
                                                child: Text(
                                                  result.email,
                                                  style: const TextStyle(
                                                    fontSize: 11.5,
                                                    color: CustomerPalette.textMuted,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                ),
                                              ),
                                            const SizedBox(height: 6),
                                            Wrap(
                                              spacing: 8,
                                              runSpacing: 6,
                                              children: [
                                                _summaryChip(
                                                  icon: Icons.assignment_turned_in_outlined,
                                                  label: 'Rides',
                                                  value: result.rideCount.toString(),
                                                  tint: CustomerPalette.primaryDark,
                                                ),
                                                _summaryChip(
                                                  icon: Icons.route_rounded,
                                                  label: 'Points',
                                                  value: result.points.length.toString(),
                                                  tint: CustomerPalette.secondaryDark,
                                                ),
                                                _summaryChip(
                                                  icon: Icons.social_distance_rounded,
                                                  label: 'Distance',
                                                  value:
                                                      '${distanceKm.toStringAsFixed(distanceKm >= 10 ? 0 : 1)} km',
                                                  tint: CustomerPalette.primaryDark,
                                                ),
                                                _summaryChip(
                                                  icon: Icons.play_circle_outline_rounded,
                                                  label: 'Started',
                                                  value: _formatMoment(started),
                                                  tint: const Color(0xFF92400E),
                                                ),
                                                _summaryChip(
                                                  icon: Icons.update_rounded,
                                                  label: 'Updated',
                                                  value: _formatMoment(updated),
                                                  tint: const Color(0xFF1D4ED8),
                                                ),
                                              ],
                                            ),
                                          ],
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
                  ),
                  const SizedBox(height: 16),
                  if (selected != null)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: CustomerPalette.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Selected Ride Movement Log',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                              color: CustomerPalette.textDark,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _summaryChip(
                                icon: Icons.assignment_turned_in_outlined,
                                label: 'Rider Rides',
                                value: selected.rideCount.toString(),
                                tint: CustomerPalette.primaryDark,
                              ),
                              if (selectedRoute != null)
                                _summaryChip(
                                  icon: Icons.receipt_long_rounded,
                                  label: 'Selected Order',
                                  value: selectedRoute.orderNumber,
                                  tint: CustomerPalette.secondaryDark,
                                ),
                              if (selectedRoute != null)
                                _summaryChip(
                                  icon: Icons.flag_circle_rounded,
                                  label: 'Status',
                                  value: selectedRoute.status.isEmpty
                                      ? '-'
                                      : selectedRoute.status,
                                  tint: const Color(0xFF1D4ED8),
                                ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          ...?selectedRoute?.points.reversed.take(25).map((entry) {
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    margin: const EdgeInsets.only(top: 2),
                                    width: 28,
                                    height: 28,
                                    decoration: BoxDecoration(
                                      color: CustomerPalette.secondary.withValues(
                                        alpha: 0.1,
                                      ),
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: const Icon(
                                      Icons.place_outlined,
                                      size: 15,
                                      color: CustomerPalette.secondaryDark,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          _formatMoment(entry.timestamp),
                                          style: const TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.w800,
                                            color: CustomerPalette.textDark,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          entry.locationLabel.isNotEmpty
                                              ? entry.locationLabel
                                              : '${entry.point.latitude.toStringAsFixed(5)}, ${entry.point.longitude.toStringAsFixed(5)}',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            color: CustomerPalette.textMuted,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
