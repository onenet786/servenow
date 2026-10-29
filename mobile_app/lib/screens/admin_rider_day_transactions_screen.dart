import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/staff/staff_ui.dart';

class AdminRiderDayTransactionsScreen extends StatefulWidget {
  const AdminRiderDayTransactionsScreen({
    super.key,
    required this.riders,
    required this.initialRider,
    required this.initialDate,
  });

  final List<dynamic> riders;
  final Map<String, dynamic> initialRider;
  final DateTime initialDate;

  @override
  State<AdminRiderDayTransactionsScreen> createState() =>
      _AdminRiderDayTransactionsScreenState();
}

class _AdminRiderDayTransactionsScreenState
    extends State<AdminRiderDayTransactionsScreen> {
  late int? _selectedRiderId;
  late DateTime _selectedDate;
  bool _isLoading = false;
  String? _error;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _selectedRiderId = int.tryParse('${widget.initialRider['id']}');
    _selectedDate = DateTime(
      widget.initialDate.year,
      widget.initialDate.month,
      widget.initialDate.day,
    );
    _loadTransactions();
  }

  String _riderDisplayName(Map<String, dynamic> rider) {
    final fullName = (rider['full_name'] ?? '').toString().trim();
    if (fullName.isNotEmpty) return fullName;
    final first = (rider['first_name'] ?? '').toString().trim();
    final last = (rider['last_name'] ?? '').toString().trim();
    final name = '$first $last'.trim();
    if (name.isNotEmpty) return name;
    return 'Rider #${rider['id'] ?? '-'}';
  }

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value.trim()) ?? 0;
    return 0;
  }

  String _dateKey(DateTime value) {
    final local = DateTime(value.year, value.month, value.day);
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '${local.year}-$month-$day';
  }

  Future<void> _loadTransactions() async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    final riderId = _selectedRiderId;
    if (token == null || riderId == null) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final data = await ApiService.getRiderFinancialHistory(
        token,
        from: _dateKey(_selectedDate),
        to: _dateKey(_selectedDate),
        riderId: riderId,
      );
      if (!mounted) return;
      setState(() {
        _data = data;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = _friendlyError(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _changeDate(int dayOffset) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final next = _selectedDate.add(Duration(days: dayOffset));
    if (next.isAfter(today)) return;
    setState(() => _selectedDate = next);
    await _loadTransactions();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate.isAfter(now) ? now : _selectedDate,
      firstDate: DateTime(now.year - 3),
      lastDate: now,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _selectedDate = DateTime(picked.year, picked.month, picked.day);
    });
    await _loadTransactions();
  }

  // ---------------------------------------------------------------------------
  // UI (phase B redesign). Loading and date logic are above.
  // ---------------------------------------------------------------------------

  String _friendlyError(Object e) {
    final text = e.toString().toLowerCase();
    if (text.contains('permission') ||
        text.contains('forbidden') ||
        text.contains('403')) {
      return 'You do not have access to rider day transactions.';
    }
    return 'Could not load rider day transactions.';
  }

  String _movementLabel(String type) {
    final t = type.toLowerCase();
    if (t.contains('cash_collection')) return 'Cash collected';
    if (t.contains('store_payment')) return 'Store payment';
    if (t.contains('fuel')) return 'Fuel expense';
    if (t.contains('advance')) return 'Office advance';
    if (t.contains('cash_submission')) return 'Cash submitted';
    if (t.contains('settlement')) return 'Settlement';
    final clean = type.replaceAll('_', ' ').trim();
    if (clean.isEmpty) return 'Movement';
    return clean[0].toUpperCase() + clean.substring(1);
  }

  StaffTone _movementTone(String type) {
    final t = type.toLowerCase();
    if (t.contains('cash_collection') || t.contains('advance')) {
      return StaffTone.primary;
    }
    return StaffTone.neutral;
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final stores = (order['stores'] as List?) ?? const [];
    final effect = _toDouble(order['expected_rider_cash_effect']);
    return Container(
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Fmt.orderNumber(
                        order['order_number'],
                        fallbackId: order['order_id'],
                      ),
                      style: AppText.bodyStrong,
                    ),
                    Text(
                      Fmt.dateTime(order['created_at'], fallback: '-'),
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Cash effect', style: AppText.caption),
                  Text(
                    '${effect >= 0 ? '+' : '−'} ${Fmt.money(effect.abs())}',
                    style: AppText.price.copyWith(
                      fontSize: 14,
                      color: effect >= 0
                          ? AppColors.primaryPressed
                          : AppColors.danger,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpace.xs),
          MoneyRow(
            label: 'Customer cash collected',
            amount: order['customer_cash_collected'],
          ),
          MoneyRow(
            label: 'Store paid by rider',
            amount: order['rider_store_paid'],
          ),
          MoneyRow(
            label: 'Store payable later',
            amount: order['store_payable_later'],
          ),
          if (stores.isNotEmpty) ...[
            const SizedBox(height: AppSpace.xs),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final rawStore in stores)
                  Builder(
                    builder: (_) {
                      final store =
                          (rawStore as Map?)?.cast<String, dynamic>() ?? {};
                      final term = (store['payment_term'] ?? '').toString();
                      return TonePill.neutral(
                        [
                          (store['store_name'] ?? 'Store').toString(),
                          if (term.isNotEmpty) term,
                        ].join(' · '),
                        icon: Icons.storefront_outlined,
                      );
                    },
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildControls() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final canGoNext = _selectedDate.isBefore(today);

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        children: [
          DropdownButtonFormField<int>(
            initialValue: _selectedRiderId,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Rider',
              prefixIcon: Icon(Icons.two_wheeler_rounded),
            ),
            items: widget.riders.map((raw) {
              final rider = (raw as Map).cast<String, dynamic>();
              final id = int.tryParse('${rider['id']}') ?? 0;
              return DropdownMenuItem<int>(
                value: id,
                child: Text(
                  _riderDisplayName(rider),
                  overflow: TextOverflow.ellipsis,
                ),
              );
            }).toList(),
            onChanged: (value) {
              if (value == null || value == _selectedRiderId) return;
              setState(() => _selectedRiderId = value);
              _loadTransactions();
            },
          ),
          const SizedBox(height: AppSpace.sm),
          DayStepper(
            date: _selectedDate,
            onPrevious: _isLoading ? null : () => _changeDate(-1),
            onNext: _isLoading || !canGoNext ? null : () => _changeDate(1),
            onPick: _isLoading ? null : _pickDate,
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    final data = _data;
    if (_isLoading && data == null) {
      return const Shimmer(
        child: Padding(
          padding: EdgeInsets.all(AppSpace.lg),
          child: Column(
            children: [
              SkeletonBox(height: 96, radius: AppRadius.card),
              SizedBox(height: AppSpace.md),
              SkeletonBox(height: 220, radius: AppRadius.card),
              SizedBox(height: AppSpace.md),
              SkeletonBox(height: 120, radius: AppRadius.card),
            ],
          ),
        ),
      );
    }
    if (_error != null && data == null) {
      return EmptyState(
        icon: Icons.lock_outline_rounded,
        title: _error!,
        message: 'Pick another rider or date, or try again.',
        actionLabel: 'Retry',
        actionIcon: Icons.refresh_rounded,
        onAction: _loadTransactions,
        isError: true,
      );
    }
    if (data == null) return const SizedBox.shrink();

    final summary =
        (data['summary'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final dailySummary =
        (data['daily_summary'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final ledgerSummary =
        (data['ledger_summary'] as Map<String, dynamic>?) ??
        <String, dynamic>{};
    final movements = (data['movements'] as List?) ?? const [];
    final orderLedger = (data['order_ledger'] as List?) ?? const [];
    final summaryDate = (dailySummary['date'] ?? _dateKey(_selectedDate))
        .toString();

    double totalSubmitted = 0;
    for (final raw in movements) {
      final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
      if ((m['movement_type'] ?? '').toString() == 'cash_submission') {
        totalSubmitted += _toDouble(m['amount']);
      }
    }

    final cashInCustomer = _toDouble(
      ledgerSummary['cash_in_customer'] ?? summary['cash_in_customer'],
    );
    final cashOutStore = _toDouble(
      ledgerSummary['cash_out_store_paid'] ??
          summary['cash_out_store_paid'] ??
          summary['store_payment'],
    );
    final officeAdvance = _toDouble(summary['office_advance']);
    final fuelPayment = _toDouble(summary['fuel_payment']);
    final expectedCashWithRider =
        officeAdvance +
        cashInCustomer -
        cashOutStore -
        fuelPayment -
        totalSubmitted;
    final unsubmitted = _toDouble(summary['unsubmitted_cash_received']);

    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (_error != null) ...[
              AppCard(
                color: AppColors.dangerBg,
                borderColor: AppColors.dangerBg,
                padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                child: Row(
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      color: AppColors.danger,
                    ),
                    const SizedBox(width: AppSpace.sm),
                    Expanded(
                      child: Text(
                        _error!,
                        style: AppText.small.copyWith(color: AppColors.danger),
                      ),
                    ),
                    TextButton(
                      onPressed: () => setState(() => _error = null),
                      child: const Text('Dismiss'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpace.md),
            ],
            // Headline: what the rider should be holding.
            Container(
              padding: const EdgeInsets.all(AppSpace.lg),
              decoration: BoxDecoration(
                color: AppColors.tint50,
                borderRadius: AppRadius.cardAll,
                border: Border.all(color: AppColors.tint200),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Expected cash with rider',
                          style: AppText.bodyStrong.copyWith(
                            color: AppColors.primaryDeep,
                          ),
                        ),
                        Text(
                          Fmt.money(expectedCashWithRider),
                          style: AppText.price.copyWith(
                            fontSize: 28,
                            color: AppColors.primaryDeep,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (unsubmitted > 0)
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        const Text('Unsubmitted', style: AppText.caption),
                        Text(
                          Fmt.money(unsubmitted),
                          style: AppText.price.copyWith(
                            color: AppColors.warning,
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.md),
            StaffSection(
              title: 'Cash position',
              collapsible: true,
              children: [
                MoneyRow(
                  label: 'Office advance',
                  amount: officeAdvance,
                  sign: '+',
                ),
                MoneyRow(
                  label: 'Customer cash collected',
                  amount: cashInCustomer,
                  sign: '+',
                  tone: StaffTone.primary,
                ),
                MoneyRow(
                  label: 'Store paid by rider',
                  amount: cashOutStore,
                  sign: '-',
                ),
                MoneyRow(
                  label: 'Fuel / expense',
                  amount: fuelPayment,
                  sign: '-',
                ),
                MoneyRow(
                  label: 'Submitted to office',
                  amount: totalSubmitted,
                  sign: '-',
                ),
                const Divider(height: 16),
                MoneyRow(
                  label: 'Expected cash with rider',
                  amount: expectedCashWithRider,
                  strong: true,
                  tone: StaffTone.primary,
                ),
                MoneyRow(
                  label: 'Unsubmitted cash',
                  amount: summary['unsubmitted_cash_received'],
                  tone: unsubmitted > 0 ? StaffTone.warning : StaffTone.neutral,
                ),
              ],
            ),
            const SizedBox(height: AppSpace.md),
            StaffSection(
              title: 'Daily summary',
              collapsible: true,
              initiallyExpanded: false,
              trailing: Text(
                StaffDates.dateOnly(summaryDate, fallback: summaryDate),
                style: AppText.caption,
              ),
              children: [
                MoneyRow(
                  label: 'Cash collection',
                  amount: dailySummary['cash_collection'],
                ),
                MoneyRow(
                  label: 'Store paid',
                  amount: dailySummary['store_payment'],
                ),
                MoneyRow(
                  label: 'Fuel payment',
                  amount: dailySummary['fuel_payment'],
                ),
                MoneyRow(
                  label: 'Delivery fee earned',
                  amount: dailySummary['delivery_fee_earned'],
                  tone: StaffTone.primary,
                ),
              ],
            ),
            const SizedBox(height: AppSpace.md),
            StaffSection(
              title: 'Order-wise ledger',
              collapsible: true,
              initiallyExpanded: false,
              trailing: TonePill.neutral(
                Fmt.count(orderLedger.length, 'order'),
              ),
              children: orderLedger.isEmpty
                  ? [
                      Text(
                        'No orders on this day',
                        style: AppText.bodySecondary,
                      ),
                    ]
                  : [
                      for (final rawOrder in orderLedger) ...[
                        _buildOrderCard(
                          (rawOrder as Map?)?.cast<String, dynamic>() ?? {},
                        ),
                        const SizedBox(height: AppSpace.sm),
                      ],
                    ],
            ),
            const SizedBox(height: AppSpace.md),
            StaffSection(
              title: 'Cash movement log',
              collapsible: true,
              initiallyExpanded: false,
              trailing: TonePill.neutral(
                Fmt.count(movements.length, 'entry', 'entries'),
              ),
              children: movements.isEmpty
                  ? [
                      Text(
                        'No movements on this day',
                        style: AppText.bodySecondary,
                      ),
                    ]
                  : [
                      for (var i = 0; i < movements.length; i++) ...[
                        if (i > 0) const Divider(height: 16),
                        Builder(
                          builder: (_) {
                            final m =
                                (movements[i] as Map?)
                                    ?.cast<String, dynamic>() ??
                                {};
                            final type = (m['movement_type'] ?? '').toString();
                            final description = (m['description'] ?? '')
                                .toString()
                                .trim();
                            final tone = _movementTone(type);
                            return Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _movementLabel(type),
                                        style: AppText.bodyStrong,
                                      ),
                                      if (description.isNotEmpty)
                                        Text(description, style: AppText.small),
                                      Text(
                                        Fmt.dateTime(
                                          m['movement_at'] ??
                                              m['created_at'] ??
                                              m['movement_date'],
                                          fallback: '-',
                                        ),
                                        style: AppText.caption,
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: AppSpace.sm),
                                Text(
                                  Fmt.money(_toDouble(m['amount'])),
                                  style: AppText.price.copyWith(
                                    fontSize: 14,
                                    color: tone.foreground,
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ],
                    ],
            ),
          ],
        ),
        if (_isLoading)
          const Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: LinearProgressIndicator(minHeight: 2),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Rider day transactions'),
        actions: [
          IconButton(
            onPressed: _isLoading ? null : _loadTransactions,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: [
          _buildControls(),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }
}
