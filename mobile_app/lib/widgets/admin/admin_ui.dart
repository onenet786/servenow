import 'package:flutter/material.dart';

import '../ui/ui.dart';

/// Shared building blocks for the in-app admin screens (phase C).
///
/// Presentation only: every widget takes plain values, none of them fetch
/// data or change state outside themselves.

/// Human label for a raw order status (`out_for_delivery` -> `Out for delivery`).
String adminStatusLabel(dynamic raw) => OrderStatusStyle.of(raw).label;

/// Read a "truthy" flag from API JSON (`1`, `true`, `"1"`, `"true"`).
bool adminFlag(dynamic value, {bool fallback = false}) {
  if (value == null) return fallback;
  if (value is bool) return value;
  if (value is num) return value != 0;
  final text = value.toString().trim().toLowerCase();
  if (text.isEmpty) return fallback;
  return text == '1' || text == 'true' || text == 'yes' || text == 'active';
}

/// Title-case a raw enum value (`store_owner` -> `Store owner`).
String adminHumanize(dynamic raw, {String fallback = '-'}) {
  final text = (raw ?? '').toString().trim().replaceAll('_', ' ');
  if (text.isEmpty) return fallback;
  return text[0].toUpperCase() + text.substring(1).toLowerCase();
}

/// Compact stat: small label above a large tabular value.
class AdminStatTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData? icon;
  final Color? valueColor;
  final String? caption;

  const AdminStatTile({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.valueColor,
    this.caption,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.md,
        vertical: AppSpace.md - 2,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 15, color: AppColors.muted),
                const SizedBox(width: AppSpace.xs + 2),
              ],
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.xs),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              value,
              maxLines: 1,
              style: AppText.title.copyWith(
                fontSize: 17,
                color: valueColor ?? AppColors.text,
                fontFeatures: AppText.tabular,
              ),
            ),
          ),
          if (caption != null && caption!.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              caption!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption.copyWith(fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}

/// Lays [children] out in rows of [columns] equal-width cells.
class AdminTileGrid extends StatelessWidget {
  final List<Widget> children;
  final int columns;
  final double spacing;

  const AdminTileGrid({
    super.key,
    required this.children,
    this.columns = 2,
    this.spacing = AppSpace.sm + 2,
  });

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += columns) {
      final cells = <Widget>[];
      for (var c = 0; c < columns; c++) {
        if (c > 0) cells.add(SizedBox(width: spacing));
        final index = i + c;
        cells.add(
          Expanded(
            child: index < children.length
                ? children[index]
                : const SizedBox.shrink(),
          ),
        );
      }
      if (rows.isNotEmpty) rows.add(SizedBox(height: spacing));
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: cells,
          ),
        ),
      );
    }
    return Column(mainAxisSize: MainAxisSize.min, children: rows);
  }
}

/// One segment of an [AdminBreakdownBar].
class AdminBreakdownSegment {
  final String label;
  final int value;
  final Color color;

  const AdminBreakdownSegment(this.label, this.value, this.color);
}

/// A real proportion bar (no invented trend lines): the segments are drawn
/// in proportion to their values. With nothing to show it says so.
class AdminBreakdownBar extends StatelessWidget {
  final List<AdminBreakdownSegment> segments;
  final String emptyLabel;

  const AdminBreakdownBar({
    super.key,
    required this.segments,
    this.emptyLabel = 'No orders yet',
  });

  @override
  Widget build(BuildContext context) {
    final total = segments.fold<int>(
      0,
      (sum, s) => sum + (s.value > 0 ? s.value : 0),
    );
    if (total <= 0) {
      return Row(
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 15,
            color: AppColors.muted,
          ),
          const SizedBox(width: AppSpace.xs + 2),
          Expanded(child: Text(emptyLabel, style: AppText.caption)),
        ],
      );
    }
    final visible = segments.where((s) => s.value > 0).toList();
    return Semantics(
      label: visible.map((s) => '${s.label} ${s.value}').join(', '),
      child: ClipRRect(
        borderRadius: AppRadius.pillAll,
        child: SizedBox(
          height: 8,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < visible.length; i++) ...[
                if (i > 0) const SizedBox(width: 2),
                Expanded(
                  flex: (visible[i].value * 1000 ~/ total).clamp(1, 1000),
                  child: ColoredBox(color: visible[i].color),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Tappable count chip used inside the order metric cards
/// ("12 Delivered", "3 Out for delivery"). Never truncates the label to
/// "Out Delive...": the value and label sit on two lines and the label wraps.
class AdminCountChip extends StatelessWidget {
  final String label;
  final int value;
  final Color foreground;
  final Color background;
  final VoidCallback? onTap;

  const AdminCountChip({
    super.key,
    required this.label,
    required this.value,
    required this.foreground,
    required this.background,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.sm + 2,
        vertical: AppSpace.sm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  Fmt.number(value),
                  style: AppText.title.copyWith(
                    color: foreground,
                    fontSize: 16,
                    height: 1.1,
                    fontFeatures: AppText.tabular,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 2,
                  style: AppText.caption.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w600,
                    fontSize: 11.5,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
          if (onTap != null)
            Icon(Icons.chevron_right_rounded, size: 18, color: foreground),
        ],
      ),
    );
    return Material(
      color: background,
      borderRadius: AppRadius.controlAll,
      child: onTap == null
          ? content
          : InkWell(
              borderRadius: AppRadius.controlAll,
              onTap: onTap,
              child: content,
            ),
    );
  }
}

/// Item of the admin bottom quick menu.
class AdminQuickMenuEntry {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const AdminQuickMenuEntry({
    required this.icon,
    required this.label,
    required this.onTap,
  });
}

/// Bottom quick menu: every entry visible at once (no hidden horizontal
/// scroll), readable 11 px labels, 52 dp tall targets.
class AdminQuickMenuBar extends StatelessWidget {
  final List<AdminQuickMenuEntry> entries;

  const AdminQuickMenuBar({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 58,
          child: Row(
            children: entries
                .map(
                  (entry) => Expanded(
                    child: Semantics(
                      button: true,
                      label: entry.label,
                      excludeSemantics: true,
                      child: InkWell(
                        onTap: entry.onTap,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 2),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                entry.icon,
                                size: 22,
                                color: AppColors.primary,
                              ),
                              const SizedBox(height: 3),
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  entry.label,
                                  maxLines: 1,
                                  style: AppText.caption.copyWith(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.text2,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ),
      ),
    );
  }
}

/// Plain white section card used on the admin dashboard (16 radius, 1px
/// border, no glass / glow).
class AdminPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const AdminPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpace.lg),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

/// Small rounded icon badge (tint background, green icon).
class AdminIconBadge extends StatelessWidget {
  final IconData icon;
  final Color color;
  final Color background;
  final double size;

  const AdminIconBadge({
    super.key,
    required this.icon,
    this.color = AppColors.primary,
    this.background = AppColors.tint50,
    this.size = 40,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: background,
        borderRadius: AppRadius.controlAll,
      ),
      child: Icon(icon, color: color, size: size * 0.52),
    );
  }
}

/// Friendly "not available for your account" dialog (instead of a raw
/// "Permission denied: ..." server message).
Future<void> showAdminAccessNotice(
  BuildContext context, {
  required String title,
  required String message,
}) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.lock_outline_rounded, color: AppColors.primary),
      title: Text(title, textAlign: TextAlign.center),
      content: Text(message, style: AppText.bodySecondary),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}

/// True when an error from the API is the server's permission refusal.
bool adminIsPermissionError(Object error) {
  final text = error.toString().toLowerCase();
  return text.contains('permission denied') ||
      text.contains('access denied') ||
      text.contains('403') ||
      text.contains('forbidden');
}
