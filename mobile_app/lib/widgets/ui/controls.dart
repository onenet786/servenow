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
      return SizedBox(
        height: height,
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
            textStyle: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w700),
          ),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: Text(addLabel!),
        ),
      );
    }

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
          radius: 22,
          child: SizedBox(
            width: compact ? 34 : 42,
            height: height,
            child: Icon(
              icon,
              size: 20,
              color: onTap == null ? AppColors.borderStrong : Colors.white,
            ),
          ),
        ),
      );
    }

    return Container(
      height: height,
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: AppRadius.controlAll,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          button(
            quantity <= 1 ? Icons.delete_outline_rounded : Icons.remove_rounded,
            onDecrement,
            decrementTooltip,
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 22),
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

/// Swipe-to-confirm track for irreversible one-handed actions (rider).
class SwipeToConfirm extends StatefulWidget {
  final String label;
  final Future<void> Function() onConfirmed;
  final Color color;
  final bool enabled;

  const SwipeToConfirm({
    super.key,
    required this.label,
    required this.onConfirmed,
    this.color = AppColors.primary,
    this.enabled = true,
  });

  @override
  State<SwipeToConfirm> createState() => _SwipeToConfirmState();
}

class _SwipeToConfirmState extends State<SwipeToConfirm> {
  double _drag = 0;
  bool _busy = false;
  static const double _knob = 52;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final max = (constraints.maxWidth - _knob - 8).clamp(0.0, 2000.0);
        final progress = max == 0 ? 0.0 : (_drag / max).clamp(0.0, 1.0);
        return Semantics(
          button: true,
          label: widget.label,
          onTap: widget.enabled && !_busy ? _confirm : null,
          child: Container(
            height: 60,
            decoration: BoxDecoration(
              color: widget.enabled ? widget.color : AppColors.surface3,
              borderRadius: BorderRadius.circular(30),
            ),
            child: Stack(
              alignment: Alignment.centerLeft,
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
                Positioned(
                  left: 4 + _drag.clamp(0.0, max),
                  child: GestureDetector(
                    onHorizontalDragUpdate: !widget.enabled || _busy
                        ? null
                        : (d) => setState(() {
                            _drag = (_drag + d.delta.dx).clamp(0.0, max);
                          }),
                    onHorizontalDragEnd: !widget.enabled || _busy
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

/// Sticky green "View cart · n items · Rs total" bar.
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
