import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

import 'package:servenow/utils/formatters.dart';
import 'package:servenow/widgets/tracking/tracking_math.dart';

void main() {
  const origin = LatLng(30.4700, 70.9600);

  group('TrackingMath', () {
    test('bearing points north, east, south, west', () {
      expect(
        TrackingMath.bearing(origin, const LatLng(30.48, 70.96)),
        closeTo(0, 0.5),
      );
      expect(
        TrackingMath.bearing(origin, const LatLng(30.47, 70.97)),
        closeTo(90, 0.5),
      );
      expect(
        TrackingMath.bearing(origin, const LatLng(30.46, 70.96)),
        closeTo(180, 0.5),
      );
      expect(
        TrackingMath.bearing(origin, const LatLng(30.47, 70.95)),
        closeTo(270, 0.5),
      );
    });

    test('shortest turn goes through north instead of all the way round', () {
      expect(TrackingMath.shortestTurn(350, 10), 20);
      expect(TrackingMath.shortestTurn(10, 350), -20);
      expect(TrackingMath.shortestTurn(90, 270), 180);
    });

    test('heading: device heading while moving, bearing when unknown, '
        'last heading when parked', () {
      final moving = RiderFix(position: origin, heading: 45, speedMps: 6);
      expect(TrackingMath.resolveHeading(next: moving), 45);

      final noHeading = RiderFix(
        position: const LatLng(30.4710, 70.9600),
        speedMps: 6,
      );
      expect(
        TrackingMath.resolveHeading(next: noHeading, previous: origin),
        closeTo(0, 0.5),
      );

      final parked = RiderFix(position: origin, heading: 0, speedMps: 0);
      expect(
        TrackingMath.resolveHeading(
          next: parked,
          previous: origin,
          lastHeading: 120,
        ),
        120,
      );
    });

    test('ETA uses a 15 km/h floor and gives a window', () {
      // 2 km straight line, rider stopped at a light -> floor speed.
      final eta = TrackingMath.etaWindowMinutes(
        straightLineMeters: 2000,
        speedMps: 0,
      );
      expect(eta, isNotNull);
      // 2 km * 1.3 road factor at 15 km/h = 10.4 min.
      expect(eta!.low, 8);
      expect(eta.high, 14);
      expect(eta.low < eta.high, isTrue);
    });

    test('ETA is "arriving now" when the rider is basically there', () {
      expect(
        TrackingMath.etaWindowMinutes(straightLineMeters: 80, speedMps: 5),
        isNull,
      );
    });

    test('stale after two minutes', () {
      final now = DateTime(2026, 10, 29, 12);
      expect(
        TrackingMath.isStale(now.subtract(const Duration(seconds: 119)), now),
        isFalse,
      );
      expect(
        TrackingMath.isStale(now.subtract(const Duration(minutes: 5)), now),
        isTrue,
      );
    });
  });

  group('RiderFix.fromPayload', () {
    test('reads the socket payload and ignores bad motion values', () {
      final fix = RiderFix.fromPayload({
        'latitude': '30.47',
        'longitude': 70.96,
        'heading': -1,
        'speed': 4.5,
        'updated_at': '2026-10-29T12:00:00.000Z',
      });
      expect(fix, isNotNull);
      expect(fix!.position, const LatLng(30.47, 70.96));
      expect(fix.heading, isNull);
      expect(fix.speedMps, 4.5);
      expect(fix.updatedAt!.toUtc(), DateTime.utc(2026, 10, 29, 12));
    });

    test('no coordinates, no fix', () {
      expect(RiderFix.fromPayload({'latitude': null, 'longitude': 1}), isNull);
      expect(RiderFix.fromPayload({'latitude': 0, 'longitude': 0}), isNull);
    });
  });

  group('TrackingText', () {
    final now = DateTime(2026, 10, 29, 12);
    final text = TrackingText((s) => s);

    test('ticking labels', () {
      expect(
        text.updatedAgo(now.subtract(const Duration(seconds: 12)), now),
        'Updated 12 s ago',
      );
      expect(
        text.updatedAgo(now.subtract(const Duration(minutes: 5)), now),
        'Last seen 5 min ago',
      );
      expect(text.updatedAgo(now, now), 'Updated just now');
    });

    test('eta window and distance', () {
      expect(text.eta((low: 8, high: 12)), 'Arriving in about 8–12 min');
      expect(text.eta(null), 'Arriving now');
      expect(text.distance(2140), '2.1 km away');
      expect(text.distance(434), '430 m away');
    });

    test('Urdu keeps the range as one isolated run', () {
      final ur = TrackingText(
        (s) => s == 'Arriving in about {range} min'
            ? 'تقریباً {range} منٹ میں پہنچے گا'
            : s,
        isUrdu: true,
      );
      expect(
        ur.eta((low: 8, high: 12)),
        'تقریباً ${Fmt.isolate('8–12')} منٹ میں پہنچے گا',
      );
    });
  });
}
