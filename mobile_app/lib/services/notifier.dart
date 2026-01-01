import 'package:flutter/material.dart';

class Notifier {
  Notifier._();

  static void _show(
    BuildContext context, {
    required String message,
    required IconData icon,
    required ColorScheme colorScheme,
    Color? bg,
    Color? fg,
    Duration? duration,
  }) {
    final snackBar = SnackBar(
      content: Row(
        children: [
          Icon(icon, color: fg ?? colorScheme.onPrimary, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      backgroundColor: bg,
      duration: duration ?? const Duration(seconds: 3),
    );
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(snackBar);
  }

  static void success(BuildContext context, String message, {Duration? duration}) {
    final scheme = Theme.of(context).colorScheme;
    _show(
      context,
      message: message,
      icon: Icons.check_circle_rounded,
      colorScheme: scheme,
      bg: scheme.secondaryContainer,
      fg: scheme.onSecondaryContainer,
      duration: duration ?? const Duration(seconds: 2),
    );
  }

  static void error(BuildContext context, String message, {Duration? duration}) {
    final scheme = Theme.of(context).colorScheme;
    _show(
      context,
      message: message,
      icon: Icons.error_rounded,
      colorScheme: scheme,
      bg: scheme.errorContainer,
      fg: scheme.onErrorContainer,
      duration: duration ?? const Duration(seconds: 4),
    );
  }

  static void info(BuildContext context, String message, {Duration? duration}) {
    final scheme = Theme.of(context).colorScheme;
    _show(
      context,
      message: message,
      icon: Icons.info_rounded,
      colorScheme: scheme,
      bg: scheme.primaryContainer,
      fg: scheme.onPrimaryContainer,
      duration: duration ?? const Duration(seconds: 3),
    );
  }
}
