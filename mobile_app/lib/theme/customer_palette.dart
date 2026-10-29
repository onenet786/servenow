import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Legacy palette, kept as a thin alias so screens that still reference it
/// (admin, rider history, ...) pick up the unified green design system.
/// New code should use [AppColors] or `Theme.of(context).colorScheme`.
class CustomerPalette {
  CustomerPalette._();

  static const Color primary = AppColors.primary;
  static const Color primaryDark = AppColors.primaryPressed;
  static const Color accent = AppColors.tint200;
  static const Color secondary = AppColors.primary;
  static const Color secondaryDark = AppColors.primaryDeep;
  static const Color highlight = AppColors.danger;
  static const Color background = AppColors.background;
  static const Color card = AppColors.surface;
  static const Color textDark = AppColors.text;
  static const Color textMuted = AppColors.text2;
  static const Color border = AppColors.border;
}
