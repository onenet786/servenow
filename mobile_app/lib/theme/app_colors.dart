import 'package:flutter/material.dart';

/// ServeNow colour tokens ("fresh market, calm and fast").
///
/// Mirrors the website design system in `css/servenow-ui.css` so the app and
/// the site read as one brand. Every screen should take colours from here (or
/// from `Theme.of(context).colorScheme`, which is built from these values).
class AppColors {
  AppColors._();

  // Brand green. 600 is the primary action colour (white text 5.0:1).
  static const Color primary = Color(0xFF15803D);
  static const Color primaryPressed = Color(0xFF166534);
  static const Color primaryDeep = Color(0xFF14532D);
  static const Color primaryBright = Color(0xFF22C55E);
  static const Color tint50 = Color(0xFFF0FDF4);
  static const Color tint100 = Color(0xFFDCFCE7);
  static const Color tint200 = Color(0xFFBBF7D0);

  // Neutrals.
  static const Color background = Color(0xFFF6F7F9);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surface2 = Color(0xFFF9FAFB);
  static const Color surface3 = Color(0xFFF3F4F6);
  static const Color border = Color(0xFFE5E7EB);
  static const Color borderStrong = Color(0xFFD1D5DB);
  static const Color text = Color(0xFF111827);
  static const Color text2 = Color(0xFF4B5563);
  static const Color muted = Color(0xFF6B7280);
  static const Color neutralStrong = Color(0xFF374151);

  // Status.
  static const Color warning = Color(0xFFB45309);
  static const Color warningBg = Color(0xFFFEF3C7);
  static const Color danger = Color(0xFFB91C1C);
  static const Color dangerBg = Color(0xFFFEE2E2);
  static const Color info = Color(0xFF1D4ED8);
  static const Color infoBg = Color(0xFFDBEAFE);
  static const Color success = Color(0xFF166534);
  static const Color successBg = Color(0xFFDCFCE7);

  // Order-status pill pairs (identical to the website).
  static const Color preparing = Color(0xFF9A3412);
  static const Color preparingBg = Color(0xFFFFEDD5);
  static const Color ready = Color(0xFF0F766E);
  static const Color readyBg = Color(0xFFCCFBF1);
  static const Color pickedUp = Color(0xFF0369A1);
  static const Color pickedUpBg = Color(0xFFE0F2FE);
  static const Color outForDelivery = Color(0xFF0E7490);
  static const Color outForDeliveryBg = Color(0xFFCFFAFE);

  /// Rating star.
  static const Color star = Color(0xFFF59E0B);

  /// Soft shadow for floating elements only (cart bar, sheets).
  static const List<BoxShadow> floatingShadow = [
    BoxShadow(color: Color(0x1F111827), blurRadius: 30, offset: Offset(0, 10)),
  ];

  /// Very light lift for cards that sit on the grey background.
  static const List<BoxShadow> cardShadow = [
    BoxShadow(color: Color(0x0D111827), blurRadius: 2, offset: Offset(0, 1)),
  ];
}
