import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_text.dart';
import '../../utils/formatters.dart';

/// Formatted money: `Rs 1,160`, tabular figures. Shows a struck-through
/// original price when [original] is higher than [amount].
class PriceText extends StatelessWidget {
  final dynamic amount;
  final dynamic original;
  final TextStyle? style;
  final bool urdu;
  final String? prefix;

  const PriceText(
    this.amount, {
    super.key,
    this.original,
    this.style,
    this.urdu = false,
    this.prefix,
  });

  @override
  Widget build(BuildContext context) {
    final base = AppText.price.merge(style);
    final value = Fmt.toDouble(amount);
    final orig = original == null ? null : Fmt.toDouble(original);
    final text = '${prefix ?? ''}${Fmt.money(value, urdu: urdu)}';
    if (orig == null || orig <= value) {
      return Text(text, style: base, maxLines: 1);
    }
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: text),
          const TextSpan(text: '  '),
          TextSpan(
            text: Fmt.money(orig, urdu: urdu),
            style: base.copyWith(
              fontSize: (base.fontSize ?? 15) - 2,
              fontWeight: FontWeight.w500,
              color: AppColors.muted,
              decoration: TextDecoration.lineThrough,
            ),
          ),
        ],
      ),
      style: base,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// Compact − n + stepper. Collapses to an "Add" button when [quantity] is 0
/// and [addLabel] is given.
class QuantityStepper extends StatelessWidget {
  final int quantity;
  final VoidCallback? onIncrement;
  final VoidCallback? onDecrement;
  final String? addLabel;
  final bool compact;
  final String incrementTooltip;
  final String decrementTooltip;

  const QuantityStepper({
    super.key,
    required this.quantity,
    this.onIncrement,
    this.onDecrement,
    this.addLabel,
    this.compact = false,
    this.incrementTooltip = 'Increase quantity',
    this.decrementTooltip = 'Decrease quantity',
  });

  @override
  Widget build(BuildContext context) {
    final height = compact ? 36.0 : 44.0;
    if (quantity <= 0 && addLabel != null) {
      // 48 tall so the padded tap target fits; the button itself draws at
      // [height].
      return SizedBox(
        height: AppSpace.tapTarget,
        child: Center(
          widthFactor: 1,
          child: FilledButton.icon(
            onPressed: onIncrement == null
                ? null
                : () {
                    HapticFeedback.lightImpact();
                    onIncrement!();
                  },
            style: FilledButton.styleFrom(
              minimumSize: Size(compact ? 72 : 96, height),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              tapTargetSize: MaterialTapTargetSize.padded,
              textStyle: AppText.bodyStrong.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            icon: const Icon(Icons.add_rounded, size: 18),
            label: Text(addLabel!),
          ),
        ),
      );
    }

    // Visual pill stays 44 (36 compact) tall; every button's hit area is a
    // full 48x48 so the most-tapped control in the app meets the tap-target
    // guideline.
    Widget button(IconData icon, VoidCallback? onTap, String tooltip) {
      return Semantics(
        button: true,
        label: tooltip,
        child: InkResponse(
          onTap: onTap == null
              ? null
              : () {
                  HapticFeedback.selectionClick();
                  onTap();
                },
          radius: 24,
          child: SizedBox(
            width: AppSpace.tapTarget,
            height: AppSpace.tapTarget,
            child: Icon(
              icon,
              size: 20,
              color: onTap == null ? AppColors.borderStrong : Colors.white,
            ),
          ),
        ),
      );
    }

    return SizedBox(
      height: AppSpace.tapTarget,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned.fill(
            child: Center(
              child: Container(
                height: height,
                decoration: const BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: AppRadius.controlAll,
                ),
              ),
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              button(
                quantity <= 1
                    ? Icons.delete_outline_rounded
                    : Icons.remove_rounded,
                onDecrement,
                decrementTooltip,
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 20),
                child: Text(
                  '$quantity',
                  textAlign: TextAlign.center,
                  style: AppText.title.copyWith(
                    color: Colors.white,
                    fontFeatures: AppText.tabular,
                    height: 1.1,
                  ),
                ),
              ),
              button(Icons.add_rounded, onIncrement, incrementTooltip),
            ],
          ),
        ],
      ),
    );
  }
}

/// Full-width primary action with a built-in loading state.
class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  final Color? color;
  final Widget? trailing;

  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.icon,
    this.color,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: FilledButton(
        onPressed: loading ? null : onPressed,
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          backgroundColor: color ?? AppColors.primary,
          disabledBackgroundColor: loading
              ? (color ?? AppColors.primary).withValues(alpha: 0.7)
              : AppColors.surface3,
          disabledForegroundColor: loading ? Colors.white : AppColors.muted,
        ),
        child: loading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.4,
                  color: Colors.white,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: 20),
                    const SizedBox(width: AppSpace.sm),
                  ],
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (trailing != null) ...[
                    const SizedBox(width: AppSpace.sm),
                    trailing!,
                  ],
                ],
              ),
      ),
    );
  }
}

//// Swipe-to-confirm track for irreversible one-handed actions (rider).
///
/// * The knob starts on the reading-start side and is dragged towards the
///   end: left-to-right in English, right-to-left in Urdu.
/// * Screen-reader users cannot swipe, so the semantics tap opens an explicit
///   confirmation dialog instead of confirming on a single double-tap.
class SwipeToConfirm extends StatefulWidget {
  final String label;
  final Future<void> Function() onConfirmed;
  final Color color;
  final bool enabled;

  /// Dialog copy for the accessibility path.
  final String confirmTitle;
  final String confirmLabel;
  final String cancelLabel;

  const SwipeToConfirm({
    super.key,
    required this.label,
    required this.onConfirmed,
    this.color = AppColors.primary,
    this.enabled = true,
    this.confirmTitle = 'Are you sure?',
    this.confirmLabel = 'Confirm',
    this.cancelLabel = 'Cancel',
  });

  @override
  State<SwipeToConfirm> createState() => _SwipeToConfirmState();
}

class _SwipeToConfirmState extends State<SwipeToConfirm> {
  double _drag = 0;
  bool _busy = false;
  static const double _knob = 52;

  bool get _active => widget.enabled && !_busy;

  @override
  Widget build(BuildContext context) {
    final rtl = Directionality.of(context) == TextDirection.rtl;
    return LayoutBuilder(
      builder: (context, constraints) {
        final max = (constraints.maxWidth - _knob - 8).clamp(0.0, 2000.0);
        final progress = max == 0 ? 0.0 : (_drag / max).clamp(0.0, 1.0);
        return Semantics(
          button: true,
          enabled: _active,
          label: widget.label,
          hint: widget.confirmTitle,
          onTap: _active ? _confirmViaDialog : null,
          excludeSemantics: true,
          child: Container(
            height: 60,
            decoration: BoxDecoration(
              color: widget.enabled ? widget.color : AppColors.surface3,
              borderRadius: BorderRadius.circular(30),
            ),
            child: Stack(
              alignment: AlignmentDirectional.centerStart,
              children: [
                Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 64),
                    child: Text(
                      widget.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title.copyWith(
                        color: (widget.enabled ? Colors.white : AppColors.muted)
                            .withValues(alpha: 1 - progress * 0.7),
                      ),
                    ),
                  ),
                ),
                PositionedDirectional(
                  start: 4 + _drag.clamp(0.0, max),
                  child: GestureDetector(
                    onHorizontalDragUpdate: !_active
                        ? null
                        : (d) => setState(() {
                            final dx = rtl ? -d.delta.dx : d.delta.dx;
                            _drag = (_drag + dx).clamp(0.0, max);
                          }),
                    onHorizontalDragEnd: !_active
                        ? null
                        : (_) {
                            if (progress > 0.85) {
                              _confirm();
                            } else {
                              setState(() => _drag = 0);
                            }
                          },
                    child: Container(
                      width: _knob,
                      height: _knob,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: _busy
                          ? Padding(
                              padding: const EdgeInsets.all(14),
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: widget.color,
                              ),
                            )
                          // arrow_forward mirrors itself in RTL.
                          : Icon(
                              Icons.arrow_forward_rounded,
                              color: widget.enabled
                                  ? widget.color
                                  : AppColors.muted,
                            ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmViaDialog() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(widget.confirmTitle),
        content: Text(widget.label),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(widget.cancelLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(widget.confirmLabel),
          ),
        ],
      ),
    );
    if (ok == true && mounted && _active) await _confirm();
  }

  Future<void> _confirm() async {
    HapticFeedback.mediumImpact();
    setState(() => _busy = true);
    try {
      await widget.onConfirmed();
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _drag = 0;
        });
      }
    }
  }
}

/// Small count bubble pinned to the reading-end top corner of an icon.
/// Unlike Material's [Badge], the bubble grows outwards in both text
/// directions, so in Urdu it never covers the icon.
class CountBadge extends StatelessWidget {
  final int count;
  final Widget child;

  const CountBadge({super.key, required this.count, required this.child});

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return child;
    final text = count > 99 ? '99+' : '$count';
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        PositionedDirectional(
          top: -6,
          end: -9,
          child: IgnorePointer(
            child: Container(
              constraints: const BoxConstraints(minWidth: 18),
              height: 18,
              padding: const EdgeInsets.symmetric(horizontal: 5),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.danger,
                borderRadius: AppRadius.pillAll,
                border: Border.all(color: AppColors.surface, width: 1.5),
              ),
              child: Text(
                text,
                textDirection: TextDirection.ltr,
                style: const TextStyle(
                  fontFamily: AppText.latinFamily,
                  color: Colors.white,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  height: 1.1,
                  fontFeatures: AppText.tabular,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// AppBar / header cart button with a direction-aware count badge. Used by
/// Home, Store and Product so the badge is fixed in one place.
class CartIconButton extends StatelessWidget {
  final int count;
  final VoidCallback onPressed;
  final String tooltip;

  const CartIconButton({
    super.key,
    required this.count,
    required this.onPressed,
    this.tooltip = 'Open cart',
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Room for the badge to sit outside the icon without touching the
      // screen edge.
      padding: const EdgeInsetsDirectional.only(end: AppSpace.xs),
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        icon: CountBadge(
          count: count,
          child: const Icon(Icons.shopping_cart_outlined),
        ),
      ),
    );
  }
}

// Sticky green "View cart · n items · Rs total" bar.
class CartBar extends StatelessWidget {
  final int itemCount;
  final double total;
  final VoidCallback onTap;
  final String label;
  final String itemsLabel;
  final bool urdu;

  const CartBar({
    super.key,
    required this.itemCount,
    required this.total,
    required this.onTap,
    this.label = 'View cart',
    this.itemsLabel = '',
    this.urdu = false,
  });

  @override
  Widget build(BuildContext context) {
    final countText = itemsLabel.isNotEmpty
        ? itemsLabel
        : Fmt.count(itemCount, 'item');
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        0,
        AppSpace.gutter,
        AppSpace.md,
      ),
      child: Semantics(
        button: true,
        label: '$label, $countText, ${Fmt.money(total)}',
        excludeSemantics: true,
        child: Material(
          color: AppColors.primary,
          borderRadius: AppRadius.cardAll,
          elevation: 0,
          child: InkWell(
            borderRadius: AppRadius.cardAll,
            onTap: onTap,
            child: Container(
              height: 58,
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.lg),
              decoration: const BoxDecoration(
                borderRadius: AppRadius.cardAll,
                boxShadow: AppColors.floatingShadow,
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.primaryDeep,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '$itemCount',
                      style: AppText.bodyStrong.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontFeatures: AppText.tabular,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpace.md),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.title.copyWith(
                            color: Colors.white,
                            height: urdu ? 1.5 : 1.2,
                          ),
                        ),
                        if (!urdu)
                          Text(
                            countText,
                            maxLines: 1,
                            style: AppText.caption.copyWith(
                              color: AppColors.tint100,
                              height: 1.2,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Text(
                    Fmt.money(total, urdu: urdu),
                    style: AppText.title.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontFeatures: AppText.tabular,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Compact EN / اردو segmented switch, shared by Login and Register so the
/// language control looks and works the same on both. One tap switches.
class LanguageToggle extends StatelessWidget {
  final bool isUrdu;
  final ValueChanged<bool> onChanged;

  const LanguageToggle({
    super.key,
    required this.isUrdu,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    Widget seg(String label, String semantics, bool urdu) {
      final selected = isUrdu == urdu;
      return Semantics(
        button: true,
        selected: selected,
        label: semantics,
        excludeSemantics: true,
        child: InkWell(
          borderRadius: AppRadius.pillAll,
          onTap: selected ? null : () => onChanged(urdu),
          child: Container(
            constraints: const BoxConstraints(minWidth: 48, minHeight: 44),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: selected ? AppColors.tint100 : Colors.transparent,
              borderRadius: AppRadius.pillAll,
            ),
            child: Text(
              label,
              style: AppText.label.copyWith(
                color: selected ? AppColors.primaryDeep : AppColors.text2,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: AppRadius.pillAll,
      ),
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [seg('EN', 'English', false), seg('اردو', 'Urdu', true)],
        ),
      ),
    );
  }
}
