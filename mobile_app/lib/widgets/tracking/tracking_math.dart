import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

import '../../utils/formatters.dart';

/// One position report from a rider, as sent by the server
/// (`rider_location_update` socket event or `GET /orders/:id/rider-location`).
class RiderFix {
  const RiderFix({
    required this.position,
    this.heading,
    this.speedMps,
    this.accuracyM,
    this.updatedAt,
  });

  final LatLng position;

  /// Degrees clockwise from north (0-360), when the device knows it.
  final double? heading;

  /// Metres per second.
  final double? speedMps;

  /// Horizontal accuracy radius in metres.
  final double? accuracyM;
  final DateTime? updatedAt;

  /// Builds a fix from a server payload. Returns null without coordinates.
  static RiderFix? fromPayload(Map<String, dynamic> data, {DateTime? now}) {
    final lat = _toDouble(data['latitude'] ?? data['lat']);
    final lng = _toDouble(data['longitude'] ?? data['lng']);
    if (lat == null || lng == null) return null;
    if (lat.abs() > 90 || lng.abs() > 180) return null;
    if (lat == 0 && lng == 0) return null;
    return RiderFix(
      position: LatLng(lat, lng),
      heading: _nonNegative(data['heading']),
      speedMps: _nonNegative(data['speed'] ?? data['speed_mps']),
      accuracyM: _nonNegative(data['accuracy']),
      updatedAt:
          Fmt.parseDate(data['updated_at'] ?? data['updatedAt']) ??
          now ??
          DateTime.now(),
    );
  }

  static double? _toDouble(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.isFinite ? value.toDouble() : null;
    final parsed = double.tryParse(value.toString().trim());
    return parsed != null && parsed.isFinite ? parsed : null;
  }

  static double? _nonNegative(dynamic value) {
    final parsed = _toDouble(value);
    return parsed != null && parsed >= 0 ? parsed : null;
  }
}

/// Pure helpers shared by the admin tracker and customer tracking.
class TrackingMath {
  TrackingMath._();

  /// No update for this long: show the rider as "last seen" (grey marker).
  static const Duration staleAfter = Duration(minutes: 2);

  /// Below this speed the rider counts as stopped (no pulse, keep heading).
  static const double movingSpeedMps = 1.0;

  /// City traffic floor for ETAs: never assume slower than 15 km/h.
  static const double etaFloorMps = 15 / 3.6;

  /// Ignore bursts: never assume faster than 40 km/h in town.
  static const double etaCeilingMps = 40 / 3.6;

  /// Straight-line distance x this ~ road distance in a small town grid.
  static const double roadFactor = 1.3;

  static const Distance _distance = Distance();

  static double distanceMeters(LatLng a, LatLng b) => _distance(a, b);

  /// Initial bearing from [a] to [b], degrees clockwise from north (0-360).
  static double bearing(LatLng a, LatLng b) {
    final lat1 = a.latitudeInRad;
    final lat2 = b.latitudeInRad;
    final dLng = b.longitudeInRad - a.longitudeInRad;
    final y = math.sin(dLng) * math.cos(lat2);
    final x =
        math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
    final deg = math.atan2(y, x) * 180 / math.pi;
    return (deg + 360) % 360;
  }

  /// Heading to draw for a new fix: the device heading while moving,
  /// otherwise the bearing of the movement, otherwise the last heading
  /// (a parked rider keeps pointing where they were going).
  static double? resolveHeading({
    required RiderFix next,
    LatLng? previous,
    double? lastHeading,
  }) {
    final speed = next.speedMps;
    final heading = next.heading;
    final moving = speed == null || speed >= movingSpeedMps;
    if (heading != null && moving && !(heading == 0 && speed == null)) {
      return heading % 360;
    }
    if (previous != null && distanceMeters(previous, next.position) >= 4) {
      return bearing(previous, next.position);
    }
    return lastHeading;
  }

  /// Shortest signed rotation from [from] to [to] in degrees (-180..180].
  static double shortestTurn(double from, double to) {
    var delta = (to - from) % 360;
    if (delta > 180) delta -= 360;
    if (delta <= -180) delta += 360;
    return delta;
  }

  static LatLng lerp(LatLng a, LatLng b, double t) => LatLng(
    a.latitude + (b.latitude - a.latitude) * t,
    a.longitude + (b.longitude - a.longitude) * t,
  );

  static bool isStale(DateTime? updatedAt, DateTime now) {
    if (updatedAt == null) return false;
    return now.difference(updatedAt) > staleAfter;
  }

  static bool isMoving(RiderFix? fix) {
    final speed = fix?.speedMps;
    return speed != null && speed >= movingSpeedMps;
  }

  static double? speedKmh(RiderFix? fix) {
    final speed = fix?.speedMps;
    if (speed == null) return null;
    return speed * 3.6;
  }

  /// Approximate arrival window in whole minutes, or null when the rider is
  /// effectively there. `(8, 12)` -> "about 8-12 min".
  static ({int low, int high})? etaWindowMinutes({
    required double straightLineMeters,
    double? speedMps,
  }) {
    if (!straightLineMeters.isFinite || straightLineMeters < 0) return null;
    final roadMeters = straightLineMeters * roadFactor;
    if (roadMeters < 150) return null;
    final speed = (speedMps ?? 0).clamp(etaFloorMps, etaCeilingMps).toDouble();
    final minutes = roadMeters / speed / 60;
    final low = math.max(1, (minutes * 0.85).floor());
    final high = math.max(low + 2, (minutes * 1.25).ceil() + 1);
    return (low: low, high: high);
  }
}

/// Strings for the trackers. [tr] is the screen's translator (English key
/// in, English or Urdu out); numbers are isolated so they stay intact in RTL.
class TrackingText {
  TrackingText(this.tr, {this.isUrdu = false});

  final String Function(String) tr;
  final bool isUrdu;

  String _n(int value) => isUrdu ? Fmt.isolate('$value') : '$value';

  String _fill(String key, Map<String, String> values) {
    var text = tr(key);
    values.forEach((name, value) => text = text.replaceAll('{$name}', value));
    return text;
  }

  /// "Updated just now" / "Updated 12 s ago" / "Last seen 5 min ago".
  String updatedAgo(DateTime? updatedAt, DateTime now) {
    if (updatedAt == null) return tr('Waiting for the first update');
    final seconds = math.max(0, now.difference(updatedAt).inSeconds);
    final stale = TrackingMath.isStale(updatedAt, now);
    if (seconds < 5) return tr('Updated just now');
    if (seconds < 60) {
      return _fill('Updated {n} s ago', {'n': _n(seconds)});
    }
    final minutes = seconds ~/ 60;
    if (minutes < 60) {
      return _fill(stale ? 'Last seen {n} min ago' : 'Updated {n} min ago', {
        'n': _n(minutes),
      });
    }
    final hours = minutes ~/ 60;
    return _fill(stale ? 'Last seen {n} h ago' : 'Updated {n} h ago', {
      'n': _n(hours),
    });
  }

  /// Short form for chips: "12 s", "5 min", "2 h".
  String shortAgo(DateTime? updatedAt, DateTime now) {
    if (updatedAt == null) return '—';
    final seconds = math.max(0, now.difference(updatedAt).inSeconds);
    if (seconds < 5) return tr('just now');
    if (seconds < 60) return _fill('{n} s ago', {'n': _n(seconds)});
    final minutes = seconds ~/ 60;
    if (minutes < 60) return _fill('{n} min ago', {'n': _n(minutes)});
    return _fill('{n} h ago', {'n': _n(minutes ~/ 60)});
  }

  String speed(double? kmh) {
    if (kmh == null) return '—';
    if (kmh < 3) return tr('Stopped');
    return _fill('{n} km/h', {'n': _n(kmh.round())});
  }

  String distance(double meters) {
    if (meters < 1000) {
      final rounded = (meters / 10).round() * 10;
      return _fill('{n} m away', {'n': _n(rounded)});
    }
    final km = (meters / 1000).toStringAsFixed(meters < 10000 ? 1 : 0);
    return _fill('{n} km away', {'n': isUrdu ? Fmt.isolate(km) : km});
  }

  String eta(({int low, int high})? window) {
    if (window == null) return tr('Arriving now');
    // The range is one LTR run so "8–12" never flips to "12–8" in Urdu.
    final range = '${window.low}–${window.high}';
    return _fill('Arriving in about {range} min', {
      'range': isUrdu ? Fmt.isolate(range) : range,
    });
  }

  String orders(int count) =>
      count == 1 ? tr('1 order') : _fill('{n} orders', {'n': _n(count)});
}
