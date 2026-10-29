import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Typography tokens.
///
/// Latin text uses the bundled Plus Jakarta Sans; Urdu glyphs fall back to the
/// bundled Noto Nastaliq Urdu (see `pubspec.yaml`). Nothing is downloaded at
/// runtime.
class AppText {
  AppText._();

  static const String latinFamily = 'PlusJakartaSans';
  static const String urduFamily = 'NotoNastaliqUrdu';
  static const List<String> fallback = [urduFamily];

  /// Nastaliq needs tall lines or ascenders/descenders clip.
  static const double urduLineHeight = 1.85;

  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];

  static const TextStyle display = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.4,
    color: AppColors.text,
  );
  static const TextStyle h1 = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.2,
    color: AppColors.text,
  );
  static const TextStyle h2 = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    color: AppColors.text,
  );
  static const TextStyle title = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w700,
    color: AppColors.text,
  );
  static const TextStyle bodyStrong = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    color: AppColors.text,
  );
  static const TextStyle body = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.text,
  );
  static const TextStyle bodySecondary = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.text2,
  );
  static const TextStyle small = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    color: AppColors.text2,
  );
  static const TextStyle caption = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w500,
    color: AppColors.muted,
  );
  static const TextStyle label = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w700,
    color: AppColors.text2,
  );
  static const TextStyle price = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w800,
    color: AppColors.text,
    fontFeatures: tabular,
  );
}
