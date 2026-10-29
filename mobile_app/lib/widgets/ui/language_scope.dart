import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../utils/customer_language.dart';

/// Wraps a customer screen in the right text direction and, for Urdu, the
/// tall-line-height theme Nastaliq needs. Dialogs and sheets opened from
/// inside inherit both (they capture the surrounding theme).
class LanguageScope extends StatelessWidget {
  final bool isUrdu;
  final Widget child;

  const LanguageScope({super.key, required this.isUrdu, required this.child});

  static final ThemeData _urduTheme = AppTheme.urdu();

  @override
  Widget build(BuildContext context) {
    final directed = Directionality(
      textDirection: CustomerLanguage.textDirection(isUrdu),
      child: child,
    );
    if (!isUrdu) return directed;
    return Theme(data: _urduTheme, child: directed);
  }
}
