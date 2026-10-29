import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';

/// Canonical order status with the same labels and colours as the website.
class OrderStatusStyle {
  final String key;
  final String label;
  final String urduLabel;
  final Color foreground;
  final Color background;
  final IconData icon;

  const OrderStatusStyle({
    required this.key,
    required this.label,
    required this.urduLabel,
    required this.foreground,
    required this.background,
    required this.icon,
  });

  /// Ordered steps of a normal delivery, for steppers.
  static const List<String> flow = [
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'picked_up',
    'out_for_delivery',
    'delivered',
  ];

  static String normalize(dynamic raw) {
    final value = (raw ?? '')
        .toString()
        .trim()
        .toLowerCase()
        .replaceAll('-', '_')
        .replaceAll(' ', '_');
    switch (value) {
      case 'processing':
      case 'placed':
      case 'new':
        return 'pending';
      case 'accepted':
      case 'assigned':
        return 'confirmed';
      case 'ready_for_pickup':
        return 'ready';
      case 'pickedup':
      case 'picked':
        return 'picked_up';
      case 'on_the_way':
      case 'outfordelivery':
      case 'dispatched':
        return 'out_for_delivery';
      case 'completed':
        return 'delivered';
      case 'canceled':
      case 'rejected':
        return 'cancelled';
      default:
        return value;
    }
  }

  static OrderStatusStyle of(dynamic raw) {
    final key = normalize(raw);
    switch (key) {
      case 'pending':
        return const OrderStatusStyle(
          key: 'pending',
          label: 'Pending',
          urduLabel: 'زیر التوا',
          foreground: AppColors.warning,
          background: AppColors.warningBg,
          icon: Icons.schedule_rounded,
        );
      case 'confirmed':
        return const OrderStatusStyle(
          key: 'confirmed',
          label: 'Confirmed',
          urduLabel: 'تصدیق شدہ',
          foreground: AppColors.info,
          background: AppColors.infoBg,
          icon: Icons.thumb_up_alt_outlined,
        );
      case 'preparing':
        return const OrderStatusStyle(
          key: 'preparing',
          label: 'Preparing',
          urduLabel: 'تیار ہو رہا ہے',
          foreground: AppColors.preparing,
          background: AppColors.preparingBg,
          icon: Icons.soup_kitchen_outlined,
        );
      case 'ready':
        return const OrderStatusStyle(
          key: 'ready',
          label: 'Ready',
          urduLabel: 'تیار',
          foreground: AppColors.ready,
          background: AppColors.readyBg,
          icon: Icons.inventory_2_outlined,
        );
      case 'picked_up':
        return const OrderStatusStyle(
          key: 'picked_up',
          label: 'Picked up',
          urduLabel: 'اٹھا لیا گیا',
          foreground: AppColors.pickedUp,
          background: AppColors.pickedUpBg,
          icon: Icons.shopping_bag_outlined,
        );
      case 'out_for_delivery':
        return const OrderStatusStyle(
          key: 'out_for_delivery',
          label: 'Out for delivery',
          urduLabel: 'راستے میں',
          foreground: AppColors.outForDelivery,
          background: AppColors.outForDeliveryBg,
          icon: Icons.delivery_dining_outlined,
        );
      case 'delivered':
        return const OrderStatusStyle(
          key: 'delivered',
          label: 'Delivered',
          urduLabel: 'پہنچا دیا گیا',
          foreground: AppColors.success,
          background: AppColors.successBg,
          icon: Icons.check_circle_outline_rounded,
        );
      case 'cancelled':
        return const OrderStatusStyle(
          key: 'cancelled',
          label: 'Cancelled',
          urduLabel: 'منسوخ',
          foreground: AppColors.danger,
          background: AppColors.dangerBg,
          icon: Icons.cancel_outlined,
        );
      default:
        final label = key.isEmpty
            ? 'Unknown'
            : key
                  .split('_')
                  .where((w) => w.isNotEmpty)
                  .map((w) => w[0].toUpperCase() + w.substring(1))
                  .join(' ');
        return OrderStatusStyle(
          key: key,
          label: label,
          urduLabel: label,
          foreground: AppColors.neutralStrong,
          background: AppColors.surface3,
          icon: Icons.info_outline_rounded,
        );
    }
  }

  bool get isActive =>
      key != 'delivered' && key != 'cancelled' && key != 'unknown';

  int get flowIndex => flow.indexOf(key);
}

/// Pill showing an order status. Identical everywhere in the app.
class StatusPill extends StatelessWidget {
  final dynamic status;
  final bool urdu;
  final bool dense;

  const StatusPill({
    super.key,
    required this.status,
    this.urdu = false,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    final style = OrderStatusStyle.of(status);
    return _Pill(
      label: urdu ? style.urduLabel : style.label,
      foreground: style.foreground,
      background: style.background,
      dense: dense,
    );
  }
}

/// Store open / closed badge (solid green / dark grey like the website).
class OpenBadge extends StatelessWidget {
  final bool isOpen;
  final String? openLabel;
  final String? closedLabel;

  const OpenBadge({
    super.key,
    required this.isOpen,
    this.openLabel,
    this.closedLabel,
  });

  @override
  Widget build(BuildContext context) {
    return _Pill(
      label: isOpen ? (openLabel ?? 'Open') : (closedLabel ?? 'Closed'),
      foreground: Colors.white,
      background: isOpen ? AppColors.primary : AppColors.neutralStrong,
      dense: true,
    );
  }
}

/// Generic tone pill (info / warning / success / danger / neutral).
class TonePill extends StatelessWidget {
  final String label;
  final Color foreground;
  final Color background;
  final IconData? icon;

  const TonePill({
    super.key,
    required this.label,
    required this.foreground,
    required this.background,
    this.icon,
  });

  const TonePill.success(this.label, {super.key, this.icon})
    : foreground = AppColors.success,
      background = AppColors.successBg;
  const TonePill.warning(this.label, {super.key, this.icon})
    : foreground = AppColors.warning,
      background = AppColors.warningBg;
  const TonePill.danger(this.label, {super.key, this.icon})
    : foreground = AppColors.danger,
      background = AppColors.dangerBg;
  const TonePill.info(this.label, {super.key, this.icon})
    : foreground = AppColors.info,
      background = AppColors.infoBg;
  const TonePill.neutral(this.label, {super.key, this.icon})
    : foreground = AppColors.neutralStrong,
      background = AppColors.surface3;

  @override
  Widget build(BuildContext context) {
    return _Pill(
      label: label,
      foreground: foreground,
      background: background,
      icon: icon,
      showDot: icon == null,
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final Color foreground;
  final Color background;
  final bool dense;
  final IconData? icon;
  final bool showDot;

  const _Pill({
    required this.label,
    required this.foreground,
    required this.background,
    this.dense = false,
    this.icon,
    this.showDot = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 8 : 10,
        vertical: dense ? 3 : 4,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null)
            Icon(icon, size: 13, color: foreground)
          else if (showDot)
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: foreground,
                shape: BoxShape.circle,
              ),
            ),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: foreground,
                fontSize: dense ? 11.5 : 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
