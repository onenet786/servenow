import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../config/map_config.dart';
import '../ui/ui.dart';
import 'tracking_math.dart';

/// Rebuilds [builder] every [interval] so "updated 12 s ago" keeps ticking.
/// One timer per widget; it stops when the widget is disposed.
class AgoTicker extends StatefulWidget {
  const AgoTicker({
    super.key,
    required this.builder,
    this.interval = const Duration(seconds: 1),
  });

  final Widget Function(BuildContext context, DateTime now) builder;
  final Duration interval;

  @override
  State<AgoTicker> createState() => _AgoTickerState();
}

class _AgoTickerState extends State<AgoTicker> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(widget.interval, (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, DateTime.now());
}

/// A map that shows ONE rider and moves the marker smoothly between updates.
///
/// - The marker glides from the old to the new position over [motionDuration]
///   (ease-out), and turns the shortest way to the new heading.
/// - Heading comes from the fix, else the bearing of the last move; a parked
///   rider keeps the last heading.
/// - Accuracy halo when the fix is coarse, pulse ring while moving, grey
///   marker and "Last seen ..." when there was no update for 2 minutes.
/// - Follow camera: pans with the rider (and keeps [destination] in view when
///   given). Dragging the map turns follow off; "Recentre" turns it back on.
class LiveRiderMap extends StatefulWidget {
  const LiveRiderMap({
    super.key,
    required this.fix,
    required this.text,
    this.trail = const <LatLng>[],
    this.destination,
    this.fallbackCenter = const LatLng(30.4686, 70.9661),
    this.followZoom = 16,
    this.motionDuration = const Duration(milliseconds: 1300),
    this.showStatusChip = true,
    this.scrollWheelZoom = false,
    this.actions = const <Widget>[],
    this.semanticLabel,
  });

  final RiderFix? fix;
  final TrackingText text;
  final List<LatLng> trail;
  final LatLng? destination;
  final LatLng fallbackCenter;
  final double followZoom;
  final Duration motionDuration;
  final bool showStatusChip;

  /// Mouse-wheel zoom (web/desktop). Off for maps inside scrolling pages so
  /// the wheel scrolls the page instead of zooming the map.
  final bool scrollWheelZoom;

  /// Extra pill buttons shown under "Recentre" (e.g. "Full map").
  final List<Widget> actions;
  final String? semanticLabel;

  @override
  State<LiveRiderMap> createState() => _LiveRiderMapState();
}

class _LiveRiderMapState extends State<LiveRiderMap>
    with TickerProviderStateMixin {
  final MapController _map = MapController();
  late final AnimationController _motion;
  late final AnimationController _pulse;
  Timer? _staleTimer;

  LatLng? _from;
  LatLng? _to;
  LatLng? _shown;
  double? _headingFrom;
  double? _headingTo;
  double? _headingShown;
  bool _follow = true;
  bool _mapReady = false;
  bool _stale = false;

  @override
  void initState() {
    super.initState();
    _motion = AnimationController(vsync: this, duration: widget.motionDuration)
      ..addListener(_onMotionTick);
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1700),
    );
    final fix = widget.fix;
    if (fix != null) {
      _from = _to = _shown = fix.position;
      _headingFrom = _headingTo = _headingShown = TrackingMath.resolveHeading(
        next: fix,
        previous: _trailPointBefore(fix.position),
      );
    }
    _stale = TrackingMath.isStale(fix?.updatedAt, DateTime.now());
    _syncPulse();
    _staleTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      final stale = TrackingMath.isStale(widget.fix?.updatedAt, DateTime.now());
      if (stale != _stale && mounted) {
        setState(() => _stale = stale);
        _syncPulse();
      }
    });
  }

  @override
  void didUpdateWidget(covariant LiveRiderMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = widget.fix;
    final prev = oldWidget.fix;
    if (next == null) {
      if (prev != null) {
        _motion.stop();
        _from = _to = _shown = null;
      }
    } else if (prev == null || _shown == null) {
      _motion.stop();
      _from = _to = _shown = next.position;
      _headingFrom = _headingTo = _headingShown = TrackingMath.resolveHeading(
        next: next,
        previous: _trailPointBefore(next.position),
        lastHeading: _headingShown,
      );
      _moveCamera(force: true);
    } else if (next.position != prev.position || next.heading != prev.heading) {
      final start = _shown ?? prev.position;
      final jump = TrackingMath.distanceMeters(start, next.position);
      final heading = TrackingMath.resolveHeading(
        next: next,
        previous: _to ?? prev.position,
        lastHeading: _headingTo ?? _headingShown,
      );
      if (jump > 3000) {
        // Teleport (e.g. first fix after a long gap): don't slide across town.
        _motion.stop();
        _from = _to = _shown = next.position;
        _headingFrom = _headingTo = _headingShown = heading;
        _moveCamera(force: true);
      } else {
        _from = start;
        _to = next.position;
        _headingFrom = _headingShown ?? heading;
        _headingTo = heading;
        _motion.forward(from: 0);
      }
    }
    if (widget.destination != oldWidget.destination) _moveCamera();
    _stale = TrackingMath.isStale(next?.updatedAt, DateTime.now());
    _syncPulse();
  }

  /// The last trail point at least a few metres away from [position], so a
  /// first fix without a device heading still points along the path.
  LatLng? _trailPointBefore(LatLng position) {
    final trail = widget.trail;
    for (var i = trail.length - 1; i >= 0; i--) {
      if (TrackingMath.distanceMeters(trail[i], position) >= 4) return trail[i];
    }
    return null;
  }

  void _syncPulse() {
    final shouldPulse =
        widget.fix != null && !_stale && TrackingMath.isMoving(widget.fix);
    if (shouldPulse && !_pulse.isAnimating) {
      _pulse.repeat();
    } else if (!shouldPulse && _pulse.isAnimating) {
      _pulse.stop();
      _pulse.value = 0;
    }
  }

  void _onMotionTick() {
    final from = _from;
    final to = _to;
    if (from == null || to == null) return;
    final t = Curves.easeOutCubic.transform(_motion.value);
    final hFrom = _headingFrom;
    final hTo = _headingTo;
    setState(() {
      _shown = TrackingMath.lerp(from, to, t);
      if (hFrom != null && hTo != null) {
        _headingShown =
            (hFrom + TrackingMath.shortestTurn(hFrom, hTo) * t + 360) % 360;
      } else {
        _headingShown = hTo ?? hFrom;
      }
    });
    _moveCamera();
  }

  void _moveCamera({bool force = false}) {
    if (!_mapReady || (!_follow && !force)) return;
    final rider = _shown;
    try {
      final destination = widget.destination;
      if (rider != null && destination != null) {
        _map.fitCamera(
          CameraFit.coordinates(
            coordinates: [rider, destination],
            padding: const EdgeInsets.fromLTRB(56, 72, 56, 56),
            maxZoom: widget.followZoom + 1,
          ),
        );
      } else if (rider != null) {
        final zoom = force ? widget.followZoom : _map.camera.zoom;
        _map.move(rider, zoom);
      }
    } catch (_) {
      // Controller not attached yet (first frame); the next tick will move.
    }
  }

  void _recentre() {
    setState(() => _follow = true);
    _moveCamera(force: true);
  }

  @override
  void dispose() {
    _staleTimer?.cancel();
    _motion
      ..removeListener(_onMotionTick)
      ..dispose();
    _pulse.dispose();
    _map.dispose();
    super.dispose();
  }

  List<LatLng> _trailWithMarker() {
    final shown = _shown;
    final points = List<LatLng>.from(widget.trail);
    if (shown != null) {
      // Join the path to the gliding marker so the line never lags behind.
      if (points.isNotEmpty && points.last == _to) points.removeLast();
      points.add(shown);
    }
    return points;
  }

  @override
  Widget build(BuildContext context) {
    final rider = _shown;
    final destination = widget.destination;
    final fix = widget.fix;
    final accuracy = fix?.accuracyM;
    final trail = _trailWithMarker();
    final initialPoints = [?rider, ?destination];

    final map = FlutterMap(
      mapController: _map,
      options: MapOptions(
        initialCenter: rider ?? destination ?? widget.fallbackCenter,
        initialZoom: rider != null ? widget.followZoom : 13,
        initialCameraFit: initialPoints.length > 1
            ? CameraFit.coordinates(
                coordinates: initialPoints,
                padding: const EdgeInsets.fromLTRB(56, 72, 56, 56),
                maxZoom: widget.followZoom + 1,
              )
            : null,
        minZoom: 4,
        maxZoom: MapConfig.maxZoom,
        interactionOptions: InteractionOptions(
          flags: scrollWheelZoomFlags(widget.scrollWheelZoom),
        ),
        onMapReady: () {
          _mapReady = true;
          _moveCamera(force: true);
        },
        onPositionChanged: (camera, hasGesture) {
          if (hasGesture && _follow) setState(() => _follow = false);
        },
      ),
      children: [
        MapConfig.tileLayer(),
        if (trail.length >= 2)
          PolylineLayer(
            polylines: [
              Polyline(
                points: trail,
                strokeWidth: 5,
                color: (_stale ? AppColors.muted : AppColors.primary)
                    .withValues(alpha: 0.55),
                borderStrokeWidth: 1.5,
                borderColor: Colors.white.withValues(alpha: 0.9),
              ),
            ],
          ),
        if (rider != null && accuracy != null && accuracy > 25)
          CircleLayer(
            circles: [
              CircleMarker(
                point: rider,
                radius: accuracy.clamp(25, 600).toDouble(),
                useRadiusInMeter: true,
                color: AppColors.primary.withValues(alpha: 0.10),
                borderColor: AppColors.primary.withValues(alpha: 0.35),
                borderStrokeWidth: 1,
              ),
            ],
          ),
        MarkerLayer(
          markers: [
            if (destination != null)
              Marker(
                point: destination,
                width: 44,
                height: 52,
                alignment: Alignment.topCenter,
                child: const _DestinationPin(),
              ),
            if (rider != null)
              Marker(
                point: rider,
                width: 76,
                height: 76,
                child: _RiderMarker(
                  heading: _headingShown,
                  stale: _stale,
                  pulse: _pulse,
                ),
              ),
          ],
        ),
      ],
    );

    return ClipRect(
      child: Stack(
        children: [
          // Tiles and markers are not mirrored in Urdu; overlays are.
          // The map is its own semantics node so the overlay buttons
          // ("Recentre", "Full map") stay separately focusable.
          Positioned.fill(
            child: Semantics(
              container: true,
              label: widget.semanticLabel,
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: map,
              ),
            ),
          ),
          if (fix == null)
            Positioned.fill(
              child: IgnorePointer(
                child: Center(
                  child: _MapNotice(
                    icon: Icons.location_searching_rounded,
                    text: widget.text.tr("Waiting for the rider's location"),
                  ),
                ),
              ),
            ),
          if (widget.showStatusChip && fix != null)
            PositionedDirectional(
              top: AppSpace.md,
              start: AppSpace.md,
              end: 120,
              child: Align(
                alignment: AlignmentDirectional.centerStart,
                child: AgoTicker(
                  builder: (context, now) => _LiveChip(
                    stale: TrackingMath.isStale(fix.updatedAt, now),
                    label: widget.text.updatedAgo(fix.updatedAt, now),
                    liveLabel: widget.text.tr('Live'),
                  ),
                ),
              ),
            ),
          PositionedDirectional(
            top: AppSpace.md,
            end: AppSpace.md,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                AnimatedSwitcher(
                  duration: AppMotion.medium,
                  child: (!_follow && rider != null)
                      ? MapPillButton(
                          key: const ValueKey('recentre'),
                          icon: Icons.my_location_rounded,
                          label: widget.text.tr('Recentre'),
                          onTap: _recentre,
                        )
                      : const SizedBox.shrink(),
                ),
                for (final action in widget.actions) ...[
                  const SizedBox(height: AppSpace.sm),
                  action,
                ],
              ],
            ),
          ),
          const PositionedDirectional(
            bottom: 4,
            end: 4,
            child: MapAttribution(),
          ),
        ],
      ),
    );
  }
}

/// White pill button for map overlays ("Recentre", "Full map").
class MapPillButton extends StatelessWidget {
  const MapPillButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: AppColors.surface,
        elevation: 2,
        shadowColor: Colors.black26,
        shape: const StadiumBorder(side: BorderSide(color: AppColors.border)),
        child: InkWell(
          onTap: onTap,
          customBorder: const StadiumBorder(),
          child: Container(
            constraints: const BoxConstraints(minHeight: 40),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, color: AppColors.primary, size: 18),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: AppText.label.copyWith(color: AppColors.text),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LiveChip extends StatelessWidget {
  const _LiveChip({
    required this.stale,
    required this.label,
    required this.liveLabel,
  });

  final bool stale;
  final String label;
  final String liveLabel;

  @override
  Widget build(BuildContext context) {
    final dot = stale ? AppColors.muted : AppColors.primaryBright;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.border),
        boxShadow: AppColors.cardShadow,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          if (!stale) ...[
            Text(
              liveLabel,
              style: AppText.label.copyWith(color: AppColors.primaryDeep),
            ),
            const Text(' · ', style: AppText.label),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.label.copyWith(
                color: stale ? AppColors.text2 : AppColors.text,
                fontFeatures: AppText.tabular,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MapNotice extends StatelessWidget {
  const _MapNotice({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 32),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.95),
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: AppColors.muted),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              text,
              style: AppText.small.copyWith(color: AppColors.text2),
            ),
          ),
        ],
      ),
    );
  }
}

/// The rider marker: green disc with a motorbike, a heading arrow that
/// orbits the disc, a pulse ring while moving, grey when stale.
class _RiderMarker extends StatelessWidget {
  const _RiderMarker({
    required this.heading,
    required this.stale,
    required this.pulse,
  });

  final double? heading;
  final bool stale;
  final Animation<double> pulse;

  @override
  Widget build(BuildContext context) {
    final fill = stale ? AppColors.muted : AppColors.primary;
    final heading = this.heading;
    return RepaintBoundary(
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (!stale)
            AnimatedBuilder(
              animation: pulse,
              builder: (context, _) {
                final t = pulse.value;
                if (t == 0) return const SizedBox.shrink();
                return Container(
                  width: 40 + 34 * t,
                  height: 40 + 34 * t,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.primary.withValues(alpha: 0.28 * (1 - t)),
                  ),
                );
              },
            ),
          if (heading != null)
            Transform.rotate(
              angle: heading * math.pi / 180,
              child: SizedBox(
                width: 64,
                height: 64,
                child: Align(
                  alignment: Alignment.topCenter,
                  child: Icon(
                    Icons.navigation_rounded,
                    size: 20,
                    color: stale ? AppColors.muted : AppColors.primaryDeep,
                    shadows: const [Shadow(color: Colors.white, blurRadius: 3)],
                  ),
                ),
              ),
            ),
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: fill,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 3),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x40000000),
                  blurRadius: 8,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            child: const Icon(
              Icons.two_wheeler_rounded,
              color: Colors.white,
              size: 20,
            ),
          ),
        ],
      ),
    );
  }
}

class _DestinationPin extends StatelessWidget {
  const _DestinationPin();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: AppColors.text,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [
              BoxShadow(
                color: Color(0x40000000),
                blurRadius: 6,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: const Icon(Icons.home_rounded, color: Colors.white, size: 18),
        ),
        Container(width: 3, height: 12, color: AppColors.text),
      ],
    );
  }
}

/// Map gestures without rotation; mouse-wheel zoom only when [wheel].
int scrollWheelZoomFlags(bool wheel) {
  const base = InteractiveFlag.all & ~InteractiveFlag.rotate;
  return wheel ? base : base & ~InteractiveFlag.scrollWheelZoom;
}
