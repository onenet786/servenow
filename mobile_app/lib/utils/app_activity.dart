import 'package:flutter/widgets.dart';

/// Is the app in the foreground, and is a given screen the one on top?
///
/// Used to pause polling timers (home global-status poll, banner rotation,
/// admin live tiles) while the app is in the background or another route
/// (a pushed screen, a sheet or a dialog) covers the screen. Nothing that is
/// fetched changes; ticks are only skipped while nobody can see the result,
/// and screens refresh immediately when they become visible again.
class AppActivity with WidgetsBindingObserver {
  AppActivity._();

  static final AppActivity instance = AppActivity._();

  /// Route observer registered on the root navigator (see `main.dart`), so
  /// screens can mix in [RouteAware] and refresh in `didPopNext`.
  static final RouteObserver<ModalRoute<void>> routeObserver =
      RouteObserver<ModalRoute<void>>();

  final ValueNotifier<bool> foreground = ValueNotifier<bool>(true);
  bool _attached = false;

  void ensureAttached() {
    if (_attached) return;
    _attached = true;
    final binding = WidgetsBinding.instance;
    binding.addObserver(this);
    final state = binding.lifecycleState;
    if (state != null) foreground.value = _isForeground(state);
  }

  static bool _isForeground(AppLifecycleState state) =>
      state == AppLifecycleState.resumed ||
      // Still visible (e.g. notification shade pulled down).
      state == AppLifecycleState.inactive;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground.value = _isForeground(state);
  }

  /// True when the app is in the foreground and [context]'s route is the
  /// top-most one.
  static bool shouldPoll(BuildContext context) {
    instance.ensureAttached();
    if (!instance.foreground.value) return false;
    final route = ModalRoute.of(context);
    return route == null || route.isCurrent;
  }
}
