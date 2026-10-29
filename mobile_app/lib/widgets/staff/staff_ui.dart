/// Shared building blocks for the staff screens (rider, store owner and the
/// rider-related admin screens). Built only from the design-system tokens in
/// `lib/theme` and the widgets in `lib/widgets/ui`.
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../ui/ui.dart';

export '../ui/ui.dart';

/// Colour role for stats, amounts and callouts. Only the brand green and the
/// status pairs are used (no rainbow cards).
enum StaffTone { neutral, primary, warning, danger, info }

extension StaffToneColors on StaffTone {
  Color get foreground {
    switch (this) {
      case StaffTone.neutral:
        return AppColors.text;
      case StaffTone.primary:
        return AppColors.primaryPressed;
      case StaffTone.warning:
        return AppColors.warning;
      case StaffTone.danger:
        return AppColors.danger;
      case StaffTone.info:
        return AppColors.info;
    }
  }

  Color get background {
    switch (this) {
      case StaffTone.neutral:
        return AppColors.surface3;
      case StaffTone.primary:
        return AppColors.tint100;
      case StaffTone.warning:
        return AppColors.warningBg;
      case StaffTone.danger:
        return AppColors.dangerBg;
      case StaffTone.info:
        return AppColors.infoBg;
    }
  }
}

/// Date helpers for staff screens.
class StaffDates {
  StaffDates._();

  static DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

  /// `Today`, `Yesterday`, or `Wed, 28 Oct` (`Wed, 28 Oct 2025` for other
  /// years).
  static String dayLabel(DateTime date) {
    final now = DateTime.now();
    final today = _day(now);
    final target = _day(date);
    if (target == today) return 'Today';
    if (target == today.subtract(const Duration(days: 1))) return 'Yesterday';
    final pattern = target.year == now.year ? 'EEE, d MMM' : 'EEE, d MMM yyyy';
    return DateFormat(pattern, 'en_US').format(target);
  }

  /// `28 Oct 2026`.
  static String full(DateTime date) =>
      DateFormat('d MMM yyyy', 'en_US').format(date);

  /// A calendar date from the API (`2026-10-28`, or a DATE column serialised
  /// as an ISO timestamp at local midnight) rendered as `28 Oct 2026`.
  /// Never shows a time: DATE values have none.
  static String dateOnly(dynamic raw, {String fallback = ''}) {
    final text = (raw ?? '').toString().trim();
    if (text.isEmpty) return fallback;
    final plain = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
    if (plain != null) {
      return full(
        DateTime(
          int.parse(plain.group(1)!),
          int.parse(plain.group(2)!),
          int.parse(plain.group(3)!),
        ),
      );
    }
    final parsed = Fmt.parseDate(text);
    return parsed == null ? text : full(parsed);
  }
}

/// Compact stat: big value, small label, optional icon. Neutral card with a
/// coloured value only (calm, readable outdoors).
class StaffStat extends StatelessWidget {
  final String label;
  final String value;
  final IconData? icon;
  final StaffTone tone;
  final VoidCallback? onTap;
  final String? hint;

  const StaffStat({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.tone = StaffTone.neutral,
    this.onTap,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(
                  icon,
                  size: 16,
                  color: tone == StaffTone.neutral
                      ? AppColors.muted
                      : tone.foreground,
                ),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ),
              if (onTap != null)
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 16,
                  color: AppColors.muted,
                ),
            ],
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              value,
              maxLines: 1,
              style: AppText.price.copyWith(
                fontSize: 17,
                color: tone.foreground,
              ),
            ),
          ),
          if (hint != null) ...[
            const SizedBox(height: 2),
            Text(
              hint!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption.copyWith(fontSize: 11),
            ),
          ],
        ],
      ),
    );
    return Material(
      color: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: AppRadius.controlAll,
        side: BorderSide(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );
  }
}

/// Two stats per row, equal width.
class StaffStatGrid extends StatelessWidget {
  final List<Widget> children;
  final double spacing;

  const StaffStatGrid({super.key, required this.children, this.spacing = 8});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += 2) {
      final hasSecond = i + 1 < children.length;
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: children[i]),
              SizedBox(width: spacing),
              Expanded(
                child: hasSecond ? children[i + 1] : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
      if (i + 2 < children.length) rows.add(SizedBox(height: spacing));
    }
    return Column(children: rows);
  }
}

/// Label on the start side, formatted amount on the end side.
class MoneyRow extends StatelessWidget {
  final String label;
  final dynamic amount;
  final StaffTone tone;
  final bool strong;

  /// `'+'` or `'-'` shown before the amount; empty for none.
  final String sign;
  final String? note;

  const MoneyRow({
    super.key,
    required this.label,
    required this.amount,
    this.tone = StaffTone.neutral,
    this.strong = false,
    this.sign = '',
    this.note,
  });

  @override
  Widget build(BuildContext context) {
    final signText = sign == '-' ? '− ' : (sign == '+' ? '+ ' : '');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: strong ? AppText.bodyStrong : AppText.bodySecondary,
                ),
                if (note != null && note!.isNotEmpty)
                  Text(note!, style: AppText.caption),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.md),
          Text(
            '$signText${Fmt.money(amount)}',
            style: AppText.price.copyWith(
              fontSize: strong ? 16 : 14,
              fontWeight: strong ? FontWeight.w800 : FontWeight.w700,
              color: tone.foreground,
            ),
          ),
        ],
      ),
    );
  }
}

/// A bordered card with a title row and content. Optionally collapsible.
class StaffSection extends StatefulWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final List<Widget> children;
  final bool collapsible;
  final bool initiallyExpanded;
  final EdgeInsetsGeometry padding;

  const StaffSection({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.trailing,
    this.collapsible = false,
    this.initiallyExpanded = true,
    this.padding = const EdgeInsets.all(AppSpace.lg),
  });

  @override
  State<StaffSection> createState() => _StaffSectionState();
}

class _StaffSectionState extends State<StaffSection> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final header = Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.title, style: AppText.title),
              if (widget.subtitle != null && widget.subtitle!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(widget.subtitle!, style: AppText.caption),
                ),
            ],
          ),
        ),
        if (widget.trailing != null) ...[
          const SizedBox(width: AppSpace.sm),
          widget.trailing!,
        ],
        if (widget.collapsible) ...[
          const SizedBox(width: AppSpace.xs),
          Icon(
            _expanded
                ? Icons.keyboard_arrow_up_rounded
                : Icons.keyboard_arrow_down_rounded,
            color: AppColors.muted,
          ),
        ],
      ],
    );
    return AppCard(
      padding: widget.padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.collapsible)
            InkWell(
              borderRadius: AppRadius.smallAll,
              onTap: () => setState(() => _expanded = !_expanded),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 40),
                child: header,
              ),
            )
          else
            header,
          if (!widget.collapsible || _expanded) ...[
            const SizedBox(height: AppSpace.md),
            ...widget.children,
          ],
        ],
      ),
    );
  }
}

/// `‹  [Today · 28 Oct 2026]  ›` day switcher.
class DayStepper extends StatelessWidget {
  final DateTime date;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;
  final VoidCallback? onPick;

  const DayStepper({
    super.key,
    required this.date,
    this.onPrevious,
    this.onNext,
    this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    final label = StaffDates.dayLabel(date);
    final full = StaffDates.full(date);
    return Container(
      height: 52,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onPrevious,
            tooltip: 'Previous day',
            icon: const Icon(Icons.chevron_left_rounded),
            color: AppColors.text,
          ),
          Expanded(
            child: InkWell(
              onTap: onPick,
              borderRadius: AppRadius.smallAll,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.calendar_today_rounded,
                    size: 16,
                    color: AppColors.primary,
                  ),
                  const SizedBox(width: AppSpace.sm),
                  Flexible(
                    child: Text(
                      label == full ? full : '$label · $full',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.bodyStrong,
                    ),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            onPressed: onNext,
            tooltip: 'Next day',
            icon: const Icon(Icons.chevron_right_rounded),
            color: AppColors.text,
            disabledColor: AppColors.borderStrong,
          ),
        ],
      ),
    );
  }
}

/// Big, one-handed contact button (Call / WhatsApp / Maps).
class ContactButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color color;

  const ContactButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = AppColors.primaryPressed,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: AppColors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: AppRadius.controlAll,
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 56,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 22,
                  color: onTap == null ? AppColors.muted : color,
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.label.copyWith(
                    color: onTap == null ? AppColors.muted : AppColors.text,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// What the rider has to do about money for one order.
enum CashState { collect, collected, prepaid }

/// Large cash display on the rider card: "Collect cash: Rs 1,160" (amber),
/// "Cash collected" (green) or "PAID — do not collect" (green).
class CashCallout extends StatelessWidget {
  final CashState state;
  final dynamic amount;
  final String? methodLabel;
  final String Function(String) tr;

  const CashCallout({
    super.key,
    required this.state,
    required this.amount,
    this.methodLabel,
    this.tr = _identity,
  });

  static String _identity(String s) => s;

  @override
  Widget build(BuildContext context) {
    final collect = state == CashState.collect;
    final fg = collect ? AppColors.warning : AppColors.success;
    final bg = collect ? AppColors.warningBg : AppColors.successBg;
    final String title;
    final String sub;
    switch (state) {
      case CashState.collect:
        title = tr('Collect cash');
        sub = tr('Cash on delivery');
        break;
      case CashState.collected:
        title = tr('Cash collected');
        sub = tr('Now mark the order delivered');
        break;
      case CashState.prepaid:
        title = tr('PAID — do not collect');
        sub = methodLabel == null || methodLabel!.isEmpty
            ? tr('Paid online')
            : '${tr('Paid by')} ${tr(methodLabel!)}';
        break;
    }
    return Semantics(
      container: true,
      label: '$title ${Fmt.money(amount)}',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: AppRadius.controlAll,
        ),
        child: Row(
          children: [
            Icon(
              collect ? Icons.payments_rounded : Icons.verified_rounded,
              color: fg,
              size: 28,
            ),
            const SizedBox(width: AppSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppText.bodyStrong.copyWith(
                      color: fg,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(sub, style: AppText.caption.copyWith(color: fg)),
                ],
              ),
            ),
            const SizedBox(width: AppSpace.sm),
            Text(
              Fmt.money(amount),
              style: AppText.price.copyWith(
                fontSize: collect ? 24 : 18,
                color: collect ? AppColors.text : fg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Frame for staff bottom sheets: drag handle, title row, scrollable body.
class StaffSheet extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;
  final double maxHeightFactor;
  final bool showClose;

  const StaffSheet({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.trailing,
    this.maxHeightFactor = 0.9,
    this.showClose = true,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * maxHeightFactor,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // The theme's bottom sheets already draw the drag handle.
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(20, 0, 8, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: AppText.h2),
                        if (subtitle != null && subtitle!.isNotEmpty)
                          Text(subtitle!, style: AppText.caption),
                      ],
                    ),
                  ),
                  ?trailing,
                  if (showClose)
                    IconButton(
                      tooltip: 'Close',
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                ],
              ),
            ),
            Flexible(child: child),
          ],
        ),
      ),
    );
  }
}

/// One entry of the "More" sheet.
class StaffMoreItem {
  final IconData icon;
  final String label;
  final String? subtitle;
  final VoidCallback onTap;
  final bool destructive;

  const StaffMoreItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.subtitle,
    this.destructive = false,
  });
}

/// Opens the "More" sheet used by staff bottom bars to keep the bar at five
/// items or fewer. The sheet closes before the item's action runs.
Future<void> showStaffMoreSheet(
  BuildContext context, {
  required String title,
  required List<StaffMoreItem> items,
  Widget? footer,
}) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: false,
    isScrollControlled: true,
    builder: (ctx) {
      return StaffSheet(
        title: title,
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
          children: [
            for (final item in items)
              ListTile(
                minTileHeight: 56,
                leading: Icon(
                  item.icon,
                  color: item.destructive ? AppColors.danger : AppColors.text2,
                ),
                title: Text(
                  item.label,
                  style: AppText.bodyStrong.copyWith(
                    color: item.destructive ? AppColors.danger : AppColors.text,
                  ),
                ),
                subtitle: item.subtitle == null
                    ? null
                    : Text(item.subtitle!, style: AppText.caption),
                shape: const RoundedRectangleBorder(
                  borderRadius: AppRadius.controlAll,
                ),
                onTap: () {
                  Navigator.of(ctx).pop();
                  item.onTap();
                },
              ),
            if (footer != null)
              Padding(
                padding: const EdgeInsets.only(top: AppSpace.sm),
                child: footer,
              ),
          ],
        ),
      );
    },
  );
}

/// Skeleton for staff order lists (while the first load runs).
class StaffListSkeleton extends StatelessWidget {
  final int count;
  final bool showHeader;

  const StaffListSkeleton({super.key, this.count = 3, this.showHeader = true});

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpace.lg),
        children: [
          if (showHeader) ...[
            const SkeletonBox(height: 72, radius: AppRadius.card),
            const SizedBox(height: AppSpace.lg),
          ],
          for (var i = 0; i < count; i++) ...[
            Container(
              padding: const EdgeInsets.all(AppSpace.lg),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: AppRadius.cardAll,
                border: Border.all(color: AppColors.border),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SkeletonBox(width: 140, height: 16),
                      Spacer(),
                      SkeletonBox(width: 80, height: 22, radius: 999),
                    ],
                  ),
                  SizedBox(height: AppSpace.md),
                  SkeletonBox(height: 12),
                  SizedBox(height: AppSpace.sm),
                  SkeletonBox(width: 200, height: 12),
                  SizedBox(height: AppSpace.lg),
                  SkeletonBox(height: 52, radius: AppRadius.control),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.md),
          ],
        ],
      ),
    );
  }
}
