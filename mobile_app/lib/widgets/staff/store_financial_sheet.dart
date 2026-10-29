import 'package:flutter/material.dart';

import '../../services/api_service.dart';
import 'staff_ui.dart';

/// Store-owner financial history as a single sheet: it opens straight away on
/// the last 7 days (the old default) and the range is changed with chips or
/// one date-range picker, instead of two date pickers in a row before any data
/// appears. Uses the same `getStoreOwnerFinancialHistory` call as before.
class StoreFinancialSheet extends StatefulWidget {
  final String token;

  const StoreFinancialSheet({super.key, required this.token});

  static Future<void> show(BuildContext context, String token) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => StoreFinancialSheet(token: token),
    );
  }

  @override
  State<StoreFinancialSheet> createState() => _StoreFinancialSheetState();
}

enum _Range { today, week, month, custom }

class _StoreFinancialSheetState extends State<StoreFinancialSheet> {
  _Range _range = _Range.week;
  late DateTime _from;
  late DateTime _to;
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _summary = const {};
  List<dynamic> _entries = const [];

  @override
  void initState() {
    super.initState();
    final today = _day(DateTime.now());
    _from = today.subtract(const Duration(days: 6));
    _to = today;
    _load();
  }

  static DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

  static String _dateOnly(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiService.getStoreOwnerFinancialHistory(
        widget.token,
        from: _dateOnly(_from),
        to: _dateOnly(_to),
      );
      if (!mounted) return;
      setState(() {
        _summary = (data['summary'] as Map<String, dynamic>?) ?? {};
        _entries = (data['entries'] as List?) ?? const [];
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load financial history.';
      });
    }
  }

  Future<void> _select(_Range range) async {
    final today = _day(DateTime.now());
    switch (range) {
      case _Range.today:
        _from = today;
        _to = today;
        break;
      case _Range.week:
        _from = today.subtract(const Duration(days: 6));
        _to = today;
        break;
      case _Range.month:
        _from = today.subtract(const Duration(days: 29));
        _to = today;
        break;
      case _Range.custom:
        final now = DateTime.now();
        final picked = await showDateRangePicker(
          context: context,
          firstDate: DateTime(now.year - 2),
          lastDate: DateTime(now.year + 1),
          initialDateRange: DateTimeRange(start: _from, end: _to),
          helpText: 'Select dates',
        );
        if (picked == null || !mounted) return;
        _from = _day(picked.start);
        _to = _day(picked.end);
        break;
    }
    setState(() => _range = range);
    _load();
  }

  String get _rangeLabel {
    if (_from == _to) return StaffDates.full(_from);
    return '${StaffDates.full(_from)} – ${StaffDates.full(_to)}';
  }

  @override
  Widget build(BuildContext context) {
    Widget chip(_Range r, String label) => ChoiceChip(
      label: Text(label),
      selected: _range == r,
      onSelected: (_) => _select(r),
    );

    final Widget body;
    if (_loading) {
      body = const Shimmer(
        child: Column(
          children: [
            SkeletonBox(height: 72, radius: AppRadius.control),
            SizedBox(height: AppSpace.md),
            SkeletonBox(height: 84, radius: AppRadius.control),
            SizedBox(height: AppSpace.sm),
            SkeletonBox(height: 84, radius: AppRadius.control),
          ],
        ),
      );
    } else if (_error != null) {
      body = EmptyState(
        icon: Icons.cloud_off_rounded,
        title: _error!,
        actionLabel: 'Retry',
        onAction: _load,
        isError: true,
        compact: true,
      );
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StaffStatGrid(
            children: [
              StaffStat(
                label: 'Gross amount',
                value: Fmt.money(_summary['gross_store_amount']),
                icon: Icons.payments_outlined,
                tone: StaffTone.primary,
              ),
              StaffStat(
                label: 'Paid by riders',
                value: Fmt.money(_summary['rider_store_payment']),
                icon: Icons.delivery_dining_outlined,
              ),
            ],
          ),
          const SizedBox(height: AppSpace.lg),
          Row(
            children: [
              Expanded(child: Text('Orders', style: AppText.title)),
              Text(Fmt.count(_entries.length, 'order'), style: AppText.caption),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          if (_entries.isEmpty)
            const EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'No orders in this period',
              message: 'Try a longer date range.',
              compact: true,
            )
          else
            for (final raw in _entries) ...[
              _EntryCard(entry: (raw as Map?)?.cast<String, dynamic>() ?? {}),
              const SizedBox(height: AppSpace.sm),
            ],
        ],
      );
    }

    return StaffSheet(
      title: 'Financial history',
      subtitle: _rangeLabel,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
        children: [
          Wrap(
            spacing: AppSpace.sm,
            runSpacing: AppSpace.sm,
            children: [
              chip(_Range.today, 'Today'),
              chip(_Range.week, 'Last 7 days'),
              chip(_Range.month, 'Last 30 days'),
              ChoiceChip(
                avatar: const Icon(Icons.date_range_rounded, size: 18),
                label: const Text('Custom'),
                selected: _range == _Range.custom,
                onSelected: (_) => _select(_Range.custom),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.lg),
          body,
        ],
      ),
    );
  }
}

class _EntryCard extends StatelessWidget {
  final Map<String, dynamic> entry;

  const _EntryCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final storeName = (entry['store_name'] ?? '').toString();
    return AppCard(
      padding: const EdgeInsets.all(AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  Fmt.orderNumber(entry['order_number'], fallbackId: entry['order_id']),
                  style: AppText.bodyStrong,
                ),
              ),
              StatusPill(status: entry['order_status'], dense: true),
            ],
          ),
          Text(
            [
              StaffDates.dateOnly(entry['order_date']),
              if (storeName.isNotEmpty) storeName,
            ].where((s) => s.isNotEmpty).join(' · '),
            style: AppText.caption,
          ),
          const SizedBox(height: AppSpace.sm),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Gross', style: AppText.caption),
                    PriceText(entry['gross_store_amount']),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Paid by rider', style: AppText.caption),
                  PriceText(
                    entry['rider_store_payment'],
                    style: const TextStyle(color: AppColors.text2),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}
