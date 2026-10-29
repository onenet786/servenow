/// Start-up work that does not need to block the first frame.
///
/// `main()` used to await Firebase initialisation and the local-notification
/// plugin before `runApp`, so the native splash stayed up for that time on
/// every cold start. That work now runs once, right after the first frame
/// (see `main.dart`), through [ensureStarted].
///
/// Anything that depends on it awaits [ensureStarted] first, so the order is
/// exactly what it was before: Firebase + background-notification setup,
/// then `NotificationProvider`'s own plugin initialisation (which installs
/// the notification-tap handler and must therefore run last).
class AppBootstrap {
  AppBootstrap._();

  /// Set by `main()` before `runApp`. Null in tests: nothing to start.
  static Future<void> Function()? starter;

  static Future<void>? _started;

  /// Runs [starter] once; later calls return the same future.
  static Future<void> ensureStarted() {
    return _started ??= () async {
      final run = starter;
      if (run == null) return;
      try {
        await run();
      } catch (_) {}
    }();
  }
}
