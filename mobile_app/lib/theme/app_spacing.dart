import 'package:flutter/material.dart';

/// 4-point spacing scale.
class AppSpace {
  AppSpace._();

  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  /// Horizontal page gutter.
  static const double gutter = 16;

  /// Minimum interactive size (Material / Android accessibility).
  static const double tapTarget = 48;
}

/// Corner radii: cards 16, controls 12, chips pill.
class AppRadius {
  AppRadius._();

  static const double card = 16;
  static const double control = 12;
  static const double small = 8;
  static const double pill = 999;

  static const BorderRadius cardAll = BorderRadius.all(Radius.circular(card));
  static const BorderRadius controlAll = BorderRadius.all(
    Radius.circular(control),
  );
  static const BorderRadius smallAll = BorderRadius.all(Radius.circular(small));
  static const BorderRadius pillAll = BorderRadius.all(Radius.circular(pill));
}

/// Motion: short, standard easing, nothing gratuitous.
class AppMotion {
  AppMotion._();

  static const Duration fast = Duration(milliseconds: 150);
  static const Duration medium = Duration(milliseconds: 220);
  static const Curve curve = Curves.easeOutCubic;
}
