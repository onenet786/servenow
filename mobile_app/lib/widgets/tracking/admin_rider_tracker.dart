import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../../config/support_contact.dart';
import '../ui/ui.dart';
import 'live_rider_map.dart';
import 'tracking_math.dart';

/// One order a tracked rider is carrying.
class TrackedOrder {
  const TrackedOrder({
    required this.id,
    required this.number,
    required this.status,
    this.storeName = '',
  });

  final String id;
  final String number;
  final String status;
  final String storeName;
}

/// A rider on the road, grouped from the per-order live rows.
class TrackedRider {
  const TrackedRider({
    required this.id,
    required this.name,
    required this.orders,
    this.phone = '',
    this.fix,
    this.trail = const <LatLng>[],
  });

  final String id;
  final String name;
  final String phone;
  final List<TrackedOrder> orders;
  final RiderFix? fix;
  final List<LatLng> trail;

  DateTime? get updatedAt => fix?.updatedAt;

  /// The status that best describes the rider: the most advanced order.
  String get leadStatus {
    if (orders.isEmpty) return '';
    var best = orders.first.status;
    var bestIndex = -1;
    for (final order in orders) {
      final index = OrderStatusStyle.flow.indexOf(
        OrderStatusStyle.normalize(order.status),
      );
      if (index > bestIndex) {
        bestIndex = index;
        best = order.status;
      }
    }
    return best;
  }
}

/// Admin live tracker: rider selector (chips + searchable sheet), a map that
/// shows ONLY the selected rider, and an info card with contact actions.
class AdminRiderTracker extends StatelessWidget {
  const AdminRiderTracker({
    super.key,
    required this.riders,
    required this.selectedId,
    required this.onSelect,
    required this.onOpenOrder,
    this.onFullMap,
    this.mapHeight = 300,
    this.fullscreen = false,
    this.showInfoCard = true,
    this.fallbackCenter = const LatLng(30.4686, 70.9661),
  });

  final List<TrackedRider> riders;
  final String? selectedId;
  final ValueChanged<String> onSelect;
  final ValueChanged<TrackedOrder> onOpenOrder;
  final VoidCallback? onFullMap;
  final double mapHeight;

  /// Full-screen page: the map fills the space and the card floats on it.
  final bool fullscreen;

  /// The compact dashboard card leaves the info card to the full map.
  final bool showInfoCard;
  final LatLng fallbackCenter;

  static final TrackingText _text = TrackingText((s) => s);

  TrackedRider? get _selected {
    for (final rider in riders) {
      if (rider.id == selectedId) return rider;
    }
    return riders.isEmpty ? null : riders.first;
  }

  @override
  Widget build(BuildContext context) {
    if (riders.isEmpty) {
      return Container(
        decoration: BoxDecoration(
          color: AppColors.surface2,
          borderRadius: AppRadius.cardAll,
          border: Border.all(color: AppColors.border),
        ),
        child: const EmptyState(
          compact: true,
          icon: Icons.two_wheeler_rounded,
          title: 'No riders on a delivery right now',
          message: 'Riders appear here while they carry an order.',
        ),
      );
    }

    final selected = _selected!;
    final map = LiveRiderMap(
      // A new rider gets a fresh map (camera + animation start at the rider).
      key: ValueKey('admin-live-map-${selected.id}'),
      fix: selected.fix,
      trail: selected.trail,
      text: _text,
      fallbackCenter: fallbackCenter,
      scrollWheelZoom: fullscreen,
      semanticLabel: 'Live map for ${selected.name}',
      actions: [
        if (onFullMap != null)
          MapPillButton(
            icon: Icons.open_in_full_rounded,
            label: 'Full map',
            onTap: onFullMap!,
          ),
      ],
    );

    final selector = _RiderSelector(
      riders: riders,
      selectedId: selected.id,
      onSelect: onSelect,
    );

    if (fullscreen) {
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.sm),
            child: selector,
          ),
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(child: map),
                PositionedDirectional(
                  start: AppSpace.md,
                  end: AppSpace.md,
                  bottom: AppSpace.xl,
                  child: SafeArea(
                    top: false,
                    child: _RiderInfoCard(
                      rider: selected,
                      onOpenOrder: onOpenOrder,
                      floating: true,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        selector,
        const SizedBox(height: AppSpace.md),
        ClipRRect(
          borderRadius: AppRadius.cardAll,
          child: Container(
            height: mapHeight,
            decoration: BoxDecoration(
              color: AppColors.surface3,
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.cardAll,
            ),
            child: map,
          ),
        ),
        if (showInfoCard) ...[
          const SizedBox(height: AppSpace.md),
          _RiderInfoCard(rider: selected, onOpenOrder: onOpenOrder),
        ],
      ],
    );
  }
}

class _RiderSelector extends StatelessWidget {
  const _RiderSelector({
    required this.riders,
    required this.selectedId,
    required this.onSelect,
  });

  final List<TrackedRider> riders;
  final String selectedId;
  final ValueChanged<String> onSelect;

  Future<void> _openSheet(BuildContext context) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _RiderSearchSheet(riders: riders, selectedId: selectedId),
    );
    if (picked != null) onSelect(picked);
  }

  @override
  Widget build(BuildContext context) {
    return AgoTicker(
      builder: (context, now) => SizedBox(
        height: 64,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 2),
          itemCount: riders.length + 1,
          separatorBuilder: (_, _) => const SizedBox(width: AppSpace.sm),
          itemBuilder: (context, index) {
            if (index == 0) {
              return _SelectorButton(
                count: riders.length,
                onTap: () => _openSheet(context),
              );
            }
            final rider = riders[index - 1];
            return _RiderChip(
              rider: rider,
              selected: rider.id == selectedId,
              now: now,
              onTap: () => onSelect(rider.id),
            );
          },
        ),
      ),
    );
  }
}

class _SelectorButton extends StatelessWidget {
  const _SelectorButton({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Find a rider, $count on the road',
      excludeSemantics: true,
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.controlAll,
          side: const BorderSide(color: AppColors.border),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.controlAll,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.md),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.search_rounded,
                  size: 20,
                  color: AppColors.primary,
                ),
                const SizedBox(height: 2),
                Text(
                  '$count on road',
                  style: AppText.caption.copyWith(
                    color: AppColors.text,
                    fontWeight: FontWeight.w700,
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

class _RiderChip extends StatelessWidget {
  const _RiderChip({
    required this.rider,
    required this.selected,
    required this.now,
    required this.onTap,
  });

  final TrackedRider rider;
  final bool selected;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final stale = TrackingMath.isStale(rider.updatedAt, now);
    final status = rider.leadStatus;
    final ago = AdminRiderTracker._text.shortAgo(rider.updatedAt, now);
    return Semantics(
      button: true,
      selected: selected,
      label:
          '${rider.name}, ${status.isEmpty ? 'no order' : OrderStatusStyle.of(status).label}, updated $ago',
      excludeSemantics: true,
      child: AnimatedContainer(
        duration: AppMotion.fast,
        constraints: const BoxConstraints(minWidth: 150, maxWidth: 210),
        decoration: BoxDecoration(
          color: selected ? AppColors.tint50 : AppColors.surface,
          borderRadius: AppRadius.controlAll,
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.border,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: onTap,
            borderRadius: AppRadius.controlAll,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpace.md,
                vertical: AppSpace.sm,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: rider.fix == null || stale
                              ? AppColors.borderStrong
                              : AppColors.primaryBright,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          rider.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.bodyStrong.copyWith(fontSize: 13.5),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    [
                      if (status.isNotEmpty) OrderStatusStyle.of(status).label,
                      if (rider.orders.length > 1)
                        AdminRiderTracker._text.orders(rider.orders.length),
                      ago,
                    ].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption.copyWith(
                      color: stale ? AppColors.warning : AppColors.text2,
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

class _RiderSearchSheet extends StatefulWidget {
  const _RiderSearchSheet({required this.riders, required this.selectedId});

  final List<TrackedRider> riders;
  final String selectedId;

  @override
  State<_RiderSearchSheet> createState() => _RiderSearchSheetState();
}

class _RiderSearchSheetState extends State<_RiderSearchSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final matches = widget.riders
        .where((rider) {
          if (q.isEmpty) return true;
          if (rider.name.toLowerCase().contains(q)) return true;
          if (rider.phone.contains(q)) return true;
          return rider.orders.any((o) => o.number.toLowerCase().contains(q));
        })
        .toList(growable: false);
    final height = MediaQuery.sizeOf(context).height * 0.7;
    return SizedBox(
      height: height,
      child: Padding(
        padding: EdgeInsets.only(
          left: AppSpace.gutter,
          right: AppSpace.gutter,
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Riders on the road', style: AppText.h2),
            const SizedBox(height: AppSpace.md),
            TextField(
              autofocus: false,
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                hintText: 'Search name, phone or order number',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
            const SizedBox(height: AppSpace.sm),
            Expanded(
              child: matches.isEmpty
                  ? const EmptyState(
                      compact: true,
                      icon: Icons.search_off_rounded,
                      title: 'No rider matches',
                    )
                  : AgoTicker(
                      builder: (context, now) => ListView.separated(
                        itemCount: matches.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final rider = matches[index];
                          final status = rider.leadStatus;
                          final selected = rider.id == widget.selectedId;
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            minTileHeight: 64,
                            selected: selected,
                            leading: CircleAvatar(
                              backgroundColor: selected
                                  ? AppColors.primary
                                  : AppColors.tint100,
                              child: Icon(
                                Icons.two_wheeler_rounded,
                                color: selected
                                    ? Colors.white
                                    : AppColors.primaryPressed,
                              ),
                            ),
                            title: Text(
                              rider.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.bodyStrong,
                            ),
                            subtitle: Text(
                              [
                                if (rider.orders.length == 1)
                                  Fmt.orderNumber(
                                    rider.orders.first.number,
                                    fallbackId: rider.orders.first.id,
                                  )
                                else
                                  AdminRiderTracker._text.orders(
                                    rider.orders.length,
                                  ),
                                AdminRiderTracker._text.updatedAgo(
                                  rider.updatedAt,
                                  now,
                                ),
                              ].join(' · '),
                              style: AppText.caption,
                            ),
                            trailing: status.isEmpty
                                ? null
                                : StatusPill(status: status, dense: true),
                            onTap: () => Navigator.of(context).pop(rider.id),
                          );
                        },
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RiderInfoCard extends StatelessWidget {
  const _RiderInfoCard({
    required this.rider,
    required this.onOpenOrder,
    this.floating = false,
  });

  final TrackedRider rider;
  final ValueChanged<TrackedOrder> onOpenOrder;
  final bool floating;

  @override
  Widget build(BuildContext context) {
    final text = AdminRiderTracker._text;
    final phone = rider.phone.trim();
    return Container(
      padding: const EdgeInsets.all(AppSpace.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
        boxShadow: floating ? AppColors.floatingShadow : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: AppColors.tint100,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.two_wheeler_rounded,
                  color: AppColors.primaryPressed,
                ),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      rider.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                    AgoTicker(
                      builder: (context, now) {
                        final stale = TrackingMath.isStale(
                          rider.updatedAt,
                          now,
                        );
                        return Text(
                          rider.fix == null
                              ? 'Location not shared yet'
                              : '${text.updatedAgo(rider.updatedAt, now)} · ${text.speed(TrackingMath.speedKmh(rider.fix))}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.small.copyWith(
                            color: stale ? AppColors.warning : AppColors.text2,
                            fontWeight: stale ? FontWeight.w700 : null,
                            fontFeatures: AppText.tabular,
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (rider.orders.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            for (final order in rider.orders.take(3))
              _OrderRow(order: order, onTap: () => onOpenOrder(order)),
            if (rider.orders.length > 3)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  '+${rider.orders.length - 3} more',
                  style: AppText.caption,
                ),
              ),
          ] else ...[
            const SizedBox(height: AppSpace.sm),
            Text('No active order', style: AppText.small),
          ],
          const SizedBox(height: AppSpace.md),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: phone.isEmpty
                      ? null
                      : () => SupportContact.dial(phone),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                  icon: const Icon(Icons.call_rounded, size: 18),
                  label: const Text('Call', maxLines: 1, softWrap: false),
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: phone.isEmpty
                      ? null
                      : () => SupportContact.openWhatsApp(phone),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                  icon: const Icon(Icons.chat_outlined, size: 18),
                  label: const FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text('WhatsApp', maxLines: 1, softWrap: false),
                  ),
                ),
              ),
              if (rider.orders.isNotEmpty) ...[
                const SizedBox(width: AppSpace.sm),
                // Icon-only so Call / WhatsApp keep one-line labels at 360 dp.
                SizedBox(
                  width: 48,
                  height: 48,
                  child: IconButton.outlined(
                    tooltip: 'Open order',
                    onPressed: () => onOpenOrder(rider.orders.first),
                    icon: const Icon(Icons.receipt_long_rounded, size: 20),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.order, required this.onTap});

  final TrackedOrder order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final number = Fmt.orderNumber(order.number, fallbackId: order.id);
    return Semantics(
      button: true,
      label: 'Open order $number',
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.smallAll,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              const Icon(
                Icons.receipt_long_outlined,
                size: 18,
                color: AppColors.muted,
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: Text(
                  order.storeName.isEmpty
                      ? number
                      : '$number · ${order.storeName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong.copyWith(
                    fontFeatures: AppText.tabular,
                  ),
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              StatusPill(status: order.status, dense: true),
              const Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: AppColors.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
