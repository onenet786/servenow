import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';

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

  Map<String, dynamic>? get _selectedRider {
    for (final raw in widget.riders) {
      final rider = (raw as Map).cast<String, dynamic>();
      if (int.tryParse('${rider['id']}') == _selectedRiderId) {
        return rider;
      }
    }
    return null;
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

  String _friendlyDateLabel(DateTime value) {
    final today = DateTime.now();
    final selected = DateTime(value.year, value.month, value.day);
    final current = DateTime(today.year, today.month, today.day);
    if (selected == current) return 'Today';
    if (selected == current.subtract(const Duration(days: 1))) {
      return 'Yesterday';
    }
    return _dateKey(selected);
  }

  String _formatDateTime(dynamic raw) {
    if (raw == null) return '-';
    final value = raw.toString().trim();
    if (value.isEmpty) return '-';
    final parsed =
        DateTime.tryParse(value) ?? DateTime.tryParse(value.replaceFirst(' ', 'T'));
    if (parsed == null) return value;
    final dt = parsed.isUtc ? parsed.toLocal() : parsed;
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '$y-$m-$d $hh:$mm';
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
        _error = 'Failed to load rider day transactions: $e';
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

  Widget _amountRow(
    String label,
    dynamic value, {
    Color? color,
    bool strong = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: strong ? Colors.black87 : Colors.black54,
                fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ),
          Text(
            'PKR ${_toDouble(value).toStringAsFixed(2)}',
            style: TextStyle(
              fontSize: 12,
              color: color ?? Colors.black87,
              fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _collapsibleSection({
    required String title,
    required List<Widget> children,
    Color color = const Color(0xFFF8FAFC),
    Color borderColor = const Color(0xFFE2E8F0),
    Widget? trailing,
    bool initiallyExpanded = false,
  }) {
    return _TransactionSection(
      title: title,
      color: color,
      borderColor: borderColor,
      trailing: trailing,
      initiallyExpanded: initiallyExpanded,
      children: children,
    );
  }

  Color _movementColor(String type) {
    final t = type.toLowerCase();
    if (t.contains('cash_collection')) return const Color(0xFF15803D);
    if (t.contains('store_payment')) return const Color(0xFF1D4ED8);
    if (t.contains('fuel')) return const Color(0xFFD97706);
    if (t.contains('advance')) return const Color(0xFF7C3AED);
    if (t.contains('settlement')) return const Color(0xFF0F766E);
    return Colors.grey;
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final stores = (order['stores'] as List?) ?? const [];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  (order['order_number'] ?? '#${order['order_id'] ?? '-'}')
                      .toString(),
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              Text(
                'Cash PKR ${_toDouble(order['expected_rider_cash_effect']).toStringAsFixed(2)}',
                style: const TextStyle(
                  color: Color(0xFF0F766E),
                  fontSize: 11.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            _formatDateTime(order['created_at']),
            style: const TextStyle(color: Colors.black54, fontSize: 11),
          ),
          const SizedBox(height: 8),
          _amountRow(
            'Customer cash collected',
            order['customer_cash_collected'],
            color: const Color(0xFF15803D),
          ),
          _amountRow(
            'Store paid by rider',
            order['rider_store_paid'],
            color: const Color(0xFFB91C1C),
          ),
          _amountRow(
            'Store payable later',
            order['store_payable_later'],
            color: const Color(0xFF1D4ED8),
          ),
          if (stores.isNotEmpty) ...[
            const SizedBox(height: 6),
            ...stores.map((rawStore) {
              final store = (rawStore as Map?)?.cast<String, dynamic>() ?? {};
              return Text(
                '${store['store_name'] ?? 'Store'} - ${store['payment_term'] ?? '-'}',
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              );
            }),
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
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
      child: Column(
        children: [
          DropdownButtonFormField<int>(
            initialValue: _selectedRiderId,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Select Rider',
              border: OutlineInputBorder(),
              isDense: true,
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
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF3E0),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                IconButton(
                  onPressed: _isLoading ? null : () => _changeDate(-1),
                  icon: const Icon(Icons.chevron_left),
                  color: const Color(0xFFE65100),
                ),
                Expanded(
                  child: InkWell(
                    onTap: _isLoading ? null : _pickDate,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        '${_friendlyDateLabel(_selectedDate)}  ${_dateKey(_selectedDate)}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFFE65100),
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: _isLoading || !canGoNext ? null : () => _changeDate(1),
                  icon: const Icon(Icons.chevron_right),
                  color: const Color(0xFFE65100),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    final data = _data;
    if (_isLoading && data == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && data == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.redAccent),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _loadTransactions,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }
    if (data == null) return const SizedBox.shrink();

    final summary =
        (data['summary'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final dailySummary =
        (data['daily_summary'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final ledgerSummary =
        (data['ledger_summary'] as Map<String, dynamic>?) ?? <String, dynamic>{};
    final movements = (data['movements'] as List?) ?? const [];
    final orderLedger = (data['order_ledger'] as List?) ?? const [];
    final summaryDate = (dailySummary['date'] ?? _dateKey(_selectedDate)).toString();

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
        officeAdvance + cashInCustomer - cashOutStore - fuelPayment - totalSubmitted;

    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            if (_error != null) ...[
              MaterialBanner(
                content: Text(_error!),
                leading: const Icon(Icons.warning_amber, color: Colors.redAccent),
                actions: [
                  TextButton(
                    onPressed: () => setState(() => _error = null),
                    child: const Text('Dismiss'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
            _collapsibleSection(
              title: 'Cash Position',
              initiallyExpanded: true,
              color: const Color(0xFFF0FDFA),
              borderColor: const Color(0xFF99F6E4),
              children: [
                _amountRow('Office advance', officeAdvance,
                    color: const Color(0xFF7C3AED)),
                _amountRow('Customer cash collected', cashInCustomer,
                    color: const Color(0xFF15803D)),
                _amountRow('Store paid by rider', cashOutStore,
                    color: const Color(0xFFB91C1C)),
                _amountRow('Fuel / expense', fuelPayment,
                    color: const Color(0xFFD97706)),
                _amountRow('Submitted to office', totalSubmitted,
                    color: const Color(0xFF475569)),
                const Divider(height: 14),
                _amountRow(
                  'Expected cash with rider',
                  expectedCashWithRider,
                  color: const Color(0xFF0F766E),
                  strong: true,
                ),
                _amountRow(
                  'Unsubmitted cash',
                  summary['unsubmitted_cash_received'],
                  color: const Color(0xFFE65100),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _collapsibleSection(
              title: 'Daily Summary',
              trailing: Text(
                summaryDate,
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              children: [
                _amountRow('Cash collection', dailySummary['cash_collection']),
                _amountRow('Store paid', dailySummary['store_payment']),
                _amountRow('Fuel payment', dailySummary['fuel_payment']),
                _amountRow(
                  'Delivery fee earned',
                  dailySummary['delivery_fee_earned'],
                ),
              ],
            ),
            const SizedBox(height: 12),
            _collapsibleSection(
              title: 'Order-wise Ledger',
              children: orderLedger.isEmpty
                  ? const [
                      Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Center(child: Text('No orders found')),
                      ),
                    ]
                  : [
                      for (final rawOrder in orderLedger) ...[
                        _buildOrderCard(
                          (rawOrder as Map?)?.cast<String, dynamic>() ?? {},
                        ),
                        const SizedBox(height: 8),
                      ],
                    ],
            ),
            const SizedBox(height: 12),
            _collapsibleSection(
              title: 'Cash Movement Log',
              children: movements.isEmpty
                  ? const [
                      Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Center(child: Text('No movements found')),
                      ),
                    ]
                  : [
                      for (final rawMovement in movements) ...[
                        Builder(
                          builder: (_) {
                            final m =
                                (rawMovement as Map?)?.cast<String, dynamic>() ??
                                    {};
                            final type = (m['movement_type'] ?? '-').toString();
                            final color = _movementColor(type);
                            return Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: Colors.grey.shade200),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          type.replaceAll('_', ' ').toUpperCase(),
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w800,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ),
                                      Text(
                                        'PKR ${_toDouble(m['amount']).toStringAsFixed(2)}',
                                        style: TextStyle(
                                          color: color,
                                          fontWeight: FontWeight.w900,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 5),
                                  Text(
                                    _formatDateTime(
                                      m['movement_at'] ??
                                          m['created_at'] ??
                                          m['movement_date'],
                                    ),
                                    style: const TextStyle(
                                      color: Colors.black54,
                                      fontSize: 12,
                                    ),
                                  ),
                                  if ((m['description'] ?? '')
                                      .toString()
                                      .trim()
                                      .isNotEmpty) ...[
                                    const SizedBox(height: 4),
                                    Text(
                                      m['description'].toString(),
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 8),
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
    final selectedRider = _selectedRider;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Rider Day Transactions'),
        actions: [
          IconButton(
            onPressed: _isLoading ? null : _loadTransactions,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: Column(
        children: [
          _buildControls(),
          if (selectedRider != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _riderDisplayName(selectedRider),
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }
}

class _TransactionSection extends StatefulWidget {
  const _TransactionSection({
    required this.title,
    required this.children,
    required this.color,
    required this.borderColor,
    required this.initiallyExpanded,
    this.trailing,
  });

  final String title;
  final List<Widget> children;
  final Color color;
  final Color borderColor;
  final bool initiallyExpanded;
  final Widget? trailing;

  @override
  State<_TransactionSection> createState() => _TransactionSectionState();
}

class _TransactionSectionState extends State<_TransactionSection> {
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.initiallyExpanded;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: widget.color,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: widget.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.circular(8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (widget.trailing != null) ...[
                  widget.trailing!,
                  const SizedBox(width: 6),
                ],
                Icon(
                  _expanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                  color: Colors.black54,
                ),
              ],
            ),
          ),
          if (_expanded) ...[
            const SizedBox(height: 8),
            ...widget.children,
          ],
        ],
      ),
    );
  }
}
