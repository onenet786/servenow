import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

import '../theme/app_colors.dart';

/// One place for the map tile source used by every map in the app
/// (admin live tracker, customer order tracking, rider history).
///
/// The default is the public OpenStreetMap tile server. Its usage policy
/// (https://operations.osmfoundation.org/policies/tiles/) asks for a real
/// User-Agent (set through [userAgentPackageName]), visible attribution and
/// modest traffic. For heavy production use switch [tileUrlTemplate] to a
/// keyed provider (MapTiler, Stadia Maps, Carto...) and update
/// [attribution]; no other code needs to change.
class MapConfig {
  MapConfig._();

  static const String tileUrlTemplate =
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  /// Sent as the tile request User-Agent (OSM tile usage policy).
  static const String userAgentPackageName = 'com.onenetsol.servenow';

  static const double maxZoom = 19;

  static const String attribution = '© OpenStreetMap contributors';

  /// The tile layer every map should use.
  static TileLayer tileLayer() => TileLayer(
    urlTemplate: tileUrlTemplate,
    userAgentPackageName: userAgentPackageName,
    maxZoom: maxZoom,
  );
}

/// Small, always-visible attribution label for map corners.
class MapAttribution extends StatelessWidget {
  const MapAttribution({super.key});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: 0.82),
            borderRadius: const BorderRadius.all(Radius.circular(6)),
          ),
          child: const Text(
            MapConfig.attribution,
            style: TextStyle(
              fontSize: 9.5,
              height: 1.2,
              color: AppColors.text2,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}
