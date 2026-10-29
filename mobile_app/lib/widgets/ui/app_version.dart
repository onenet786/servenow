import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../theme/app_text.dart';

/// "ServeNow v1.2.2 (42)" - shown in Account / About and drawer footers
/// (it used to float over the bottom navigation on every screen).
class AppVersionText extends StatefulWidget {
  final TextStyle? style;
  final TextAlign textAlign;

  const AppVersionText({super.key, this.style, this.textAlign = TextAlign.center});

  @override
  State<AppVersionText> createState() => _AppVersionTextState();
}

class _AppVersionTextState extends State<AppVersionText> {
  static const String _envTag = String.fromEnvironment(
    'APP_VERSION_TAG',
    defaultValue: '',
  );
  static String? _cached;
  String _tag = _cached ?? _envTag;

  @override
  void initState() {
    super.initState();
    if (_cached == null) _load();
  }

  Future<void> _load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final version = info.version.trim();
      final build = info.buildNumber.trim();
      if (version.isEmpty) return;
      _cached = build.isNotEmpty ? 'v$version ($build)' : 'v$version';
      if (mounted) setState(() => _tag = _cached!);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_tag.trim().isEmpty) return const SizedBox.shrink();
    return Text(
      'ServeNow $_tag',
      textAlign: widget.textAlign,
      textDirection: TextDirection.ltr,
      style: AppText.caption.merge(widget.style),
    );
  }
}
