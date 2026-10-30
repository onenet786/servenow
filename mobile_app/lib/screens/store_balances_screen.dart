import 'package:flutter/material.dart';
import 'package:logger/logger.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/admin/admin_ui.dart';
import '../widgets/notification_bell_widget.dart';
import '../widgets/ui/ui.dart';

class StoreBalancesScreen extends StatefulWidget {
  const StoreBalancesScreen({super.key});

  @override
  State<StoreBalancesScreen> createState() => _StoreBalancesScreenState();
}

class _StoreBalancesScreenState extends State<StoreBalancesScreen> {
  final Logger _logger = Logger();
  final TextEditingController _storeSearchController = TextEditingController();
  bool _isLoading = true;
  String? _error;

  List<Map<String, dynamic>> _storeBalanceRows = [];
  List<Map<String, dynamic>> _storeFilterOptions = [];
  int? _selectedStoreFilterId;
  String _storeSearchQuery = '';
  String _selectedBalanceFilter = 'all';
  String _selectedStoreTab = 'all';

  @override
  void initState() {
    super.initState();
    _loadStoreBalances();
  }

  @override
  void dispose() {
    _storeSearchController.dispose();
    super.dispose();
  }

  Future<void> _loadStoreBalances() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final stores = await ApiService.getStoresForAdmin(token);
      final storeSalesResponse = await ApiService.getStoreSalesReport(token);
      final storeSales = (storeSalesResponse['store_sales'] as List?) ?? [];
      final storeOrdersResponse = await ApiService.getStoreOrderBreakdown(
        token,
      );
      final storeOrders = (storeOrdersResponse['store_orders'] as List?) ?? [];
      Map<String, dynamic> paymentsResponse = {};
      try {
        paymentsResponse = await ApiService.getStorePaymentsReport(token);
      } catch (e) {
        _logger.w('Store payments lookup blocked: $e');
      }

      // Same figures as Store Payments & Balances on the website.
      final storeWalletBalances = <int, double>{};
      for (final row in (paymentsResponse['stores'] as List? ?? [])) {
        final sid = int.tryParse(row['store_id']?.toString() ?? '');
        if (sid == null) continue;
        storeWalletBalances[sid] =
            double.tryParse(row['current_balance']?.toString() ?? '0') ?? 0;
      }

      final storeNameLookup = <int, String>{};
      final storeSummaryMap = <int, Map<String, dynamic>>{};
      for (final s in stores) {
        final sid = int.tryParse(s['id']?.toString() ?? '');
        if (sid == null) continue;
        final name = (s['name'] ?? 'Store #$sid').toString();
        storeNameLookup[sid] = name;
        storeSummaryMap[sid] = {
          'store_id': sid,
          'store_name': name,
          'total_orders': 0,
          'served_orders': 0,
          'pending_orders': 0,
          'cancelled_orders': 0,
          'gross_sales': 0.0,
          'net_sales': 0.0,
          'total_discount': 0.0,
          'total_cost': 0.0,
          'estimated_profit': 0.0,
          'served_sales': 0.0,
          'pending_sales': 0.0,
          'wallet_balance': storeWalletBalances[sid] ?? 0.0,
          'orders': <Map<String, dynamic>>[],
        };
      }

      for (final o in storeOrders) {
        final sid = int.tryParse(o['store_id']?.toString() ?? '');
        if (sid == null) continue;
        final summary = storeSummaryMap.putIfAbsent(sid, () {
          final name =
              storeNameLookup[sid] ?? (o['store_name'] ?? 'Store #$sid');
          return {
            'store_id': sid,
            'store_name': name.toString(),
            'total_orders': 0,
            'served_orders': 0,
            'pending_orders': 0,
            'cancelled_orders': 0,
            'gross_sales': 0.0,
            'net_sales': 0.0,
            'total_discount': 0.0,
            'total_cost': 0.0,
            'estimated_profit': 0.0,
            'served_sales': 0.0,
            'pending_sales': 0.0,
            'wallet_balance': storeWalletBalances[sid] ?? 0.0,
            'orders': <Map<String, dynamic>>[],
          };
        });

        final status = (o['status'] ?? '').toString().toLowerCase();
        final amount =
            double.tryParse(o['store_order_amount']?.toString() ?? '0') ?? 0;
        summary['total_orders'] = (summary['total_orders'] as int) + 1;
        summary['gross_sales'] = (summary['gross_sales'] as double) + amount;
        summary['net_sales'] = (summary['net_sales'] as double) + amount;

        if (status == 'delivered') {
          summary['served_orders'] = (summary['served_orders'] as int) + 1;
          summary['served_sales'] =
              (summary['served_sales'] as double) + amount;
        } else if (status == 'cancelled') {
          summary['cancelled_orders'] =
              (summary['cancelled_orders'] as int) + 1;
        } else {
          summary['pending_orders'] = (summary['pending_orders'] as int) + 1;
          summary['pending_sales'] =
              (summary['pending_sales'] as double) + amount;
        }

        final parsedDate =
            DateTime.tryParse(o['created_at']?.toString() ?? '') ??
            DateTime(1970);
        (summary['orders'] as List<Map<String, dynamic>>).add({
          'id': o['order_id'],
          'order_number': o['order_number'],
          'status': status,
          'amount': amount,
          'created_at': parsedDate,
        });
      }

      for (final ss in storeSales) {
        final sid = int.tryParse(ss['store_id']?.toString() ?? '');
        if (sid == null || !storeSummaryMap.containsKey(sid)) continue;
        final summary = storeSummaryMap[sid]!;
        final totalGrossSales =
            double.tryParse(ss['total_sales_gross']?.toString() ?? '0') ?? 0;
        final totalNetSales =
            double.tryParse(ss['total_sales_net']?.toString() ?? '0') ?? 0;
        final totalDiscount =
            double.tryParse(ss['total_discount']?.toString() ?? '0') ?? 0;
        final totalCost =
            double.tryParse(ss['total_cost']?.toString() ?? '0') ?? 0;
        final estimatedProfit =
            double.tryParse(ss['estimated_profit']?.toString() ?? '0') ?? 0;
        final avgOrder =
            double.tryParse(ss['average_order_value']?.toString() ?? '0') ?? 0;
        summary['gross_sales'] = totalGrossSales;
        summary['net_sales'] = totalNetSales;
        summary['total_discount'] = totalDiscount;
        summary['total_cost'] = totalCost;
        summary['estimated_profit'] = estimatedProfit;
        summary['average_order_value'] = avgOrder;
        summary['unique_customers'] =
            int.tryParse(ss['unique_customers']?.toString() ?? '0') ?? 0;
      }

      final rows = storeSummaryMap.values.toList();
      rows.sort((a, b) {
        final ba = (a['wallet_balance'] as double?) ?? 0.0;
        final bb = (b['wallet_balance'] as double?) ?? 0.0;
        return bb.compareTo(ba);
      });
      for (final row in rows) {
        final list = row['orders'] as List<Map<String, dynamic>>;
        list.sort((a, b) {
          final da = a['created_at'] as DateTime;
          final db = b['created_at'] as DateTime;
          return db.compareTo(da);
        });
      }

      final filters =
          storeNameLookup.entries
              .map((e) => {'store_id': e.key, 'store_name': e.value})
              .toList()
            ..sort(
              (a, b) => a['store_name'].toString().compareTo(
                b['store_name'].toString(),
              ),
            );

      setState(() {
        _storeBalanceRows = rows;
        _storeFilterOptions = filters;
        if (!_storeFilterOptions.any(
          (o) => o['store_id'] == _selectedStoreFilterId,
        )) {
          _selectedStoreFilterId = null;
        }
        _isLoading = false;
      });
    } catch (e, stack) {
      _logger.e('Failed loading store balances', error: e, stackTrace: stack);
      if (mounted) {
        setState(() {
          _error = 'Could not load store balances';
          _isLoading = false;
        });
      }
    }
  }

  List<Map<String, dynamic>> _filteredStoreRows() {
    final baseRows = _storeBalanceRows.where((r) {
      if (_selectedStoreFilterId == null) return true;
      return r['store_id'] == _selectedStoreFilterId;
    }).toList();

    final query = _storeSearchQuery.trim().toLowerCase();
    final searchFilteredRows = baseRows.where((r) {
      if (query.isEmpty) return true;
      final name = (r['store_name'] ?? '').toString().toLowerCase();
      final id = (r['store_id'] ?? '').toString();
      return name.contains(query) || id.contains(query);
    }).toList();

    final balanceFilteredRows = searchFilteredRows.where((r) {
      final wallet = r['wallet_balance'] as double? ?? 0;
      switch (_selectedBalanceFilter) {
        case 'positive':
          return wallet > 0;
        case 'negative':
          return wallet < 0;
        case 'zero':
          return wallet == 0;
        case 'all':
        default:
          return true;
      }
    }).toList();

    switch (_selectedStoreTab) {
      case 'delivered':
        return balanceFilteredRows
            .where((r) => (r['served_orders'] as int? ?? 0) > 0)
            .toList();
      case 'pending':
        return balanceFilteredRows
            .where((r) => (r['pending_orders'] as int? ?? 0) > 0)
            .toList();
      case 'cancelled':
        return balanceFilteredRows
            .where((r) => (r['cancelled_orders'] as int? ?? 0) > 0)
            .toList();
      case 'all':
      default:
        return balanceFilteredRows;
    }
  }

  Widget _buildStoreSearchField() {
    return TextField(
      controller: _storeSearchController,
      onChanged: (value) => setState(() => _storeSearchQuery = value),
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'Search store by name or ID',
        prefixIcon: const Icon(Icons.search),
        suffixIcon: _storeSearchQuery.trim().isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                icon: const Icon(Icons.clear),
                onPressed: () {
                  _storeSearchController.clear();
                  setState(() => _storeSearchQuery = '');
                },
              ),
      ),
    );
  }

  Map<String, dynamic> _summaryTotals(List<Map<String, dynamic>> rows) {
    int orders = 0;
    double netSales = 0;
    for (final r in rows) {
      orders += r['total_orders'] as int? ?? 0;
      netSales += r['net_sales'] as double? ?? 0;
    }
    return {'orders': orders, 'net_sales': netSales};
  }

  Widget _buildFilterDropdown() {
    return DropdownButtonFormField<int?>(
      initialValue: _selectedStoreFilterId,
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down),
      decoration: const InputDecoration(
        labelText: 'Store',
        prefixIcon: Icon(Icons.storefront_outlined),
      ),
      items: [
        const DropdownMenuItem(value: null, child: Text('All stores')),
        ..._storeFilterOptions.map(
          (opt) => DropdownMenuItem(
            value: opt['store_id'] as int?,
            child: Text(
              opt['store_name']?.toString() ?? 'Store',
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ],
      onChanged: (value) {
        setState(() => _selectedStoreFilterId = value);
      },
    );
  }

  Widget _buildBalanceFilterDropdown() {
    return DropdownButtonFormField<String>(
      initialValue: _selectedBalanceFilter,
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down),
      decoration: const InputDecoration(
        labelText: 'Balance',
        prefixIcon: Icon(Icons.account_balance_wallet_outlined),
      ),
      items: const [
        DropdownMenuItem(value: 'all', child: Text('All balances')),
        DropdownMenuItem(value: 'positive', child: Text('Owed')),
        DropdownMenuItem(value: 'negative', child: Text('Overpaid')),
        DropdownMenuItem(value: 'zero', child: Text('Settled')),
      ],
      onChanged: (value) {
        if (value == null) return;
        setState(() => _selectedBalanceFilter = value);
      },
    );
  }

  Widget _buildTabChips() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildTabChip('All', 'all'),
          const SizedBox(width: 8),
          _buildTabChip('With delivered', 'delivered'),
          const SizedBox(width: 8),
          _buildTabChip('With pending', 'pending'),
          const SizedBox(width: 8),
          _buildTabChip('With cancelled', 'cancelled'),
        ],
      ),
    );
  }

  Widget _buildTabChip(String label, String value) {
    final selected = _selectedStoreTab == value;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (v) {
        if (!v) return;
        setState(() => _selectedStoreTab = value);
      },
    );
  }

  Widget _buildCard(Map<String, dynamic> row) {
    final storeName = (row['store_name'] ?? 'Store').toString();
    final totalOrders = row['total_orders'] as int? ?? 0;
    final delivered = row['served_orders'] as int? ?? 0;
    final pending = row['pending_orders'] as int? ?? 0;
    final cancelled = row['cancelled_orders'] as int? ?? 0;
    final wallet = row['wallet_balance'] as double? ?? 0;
    final gross = row['gross_sales'] as double? ?? 0;
    final net = row['net_sales'] as double? ?? 0;
    final discount = row['total_discount'] as double? ?? 0;
    final cost = row['total_cost'] as double? ?? 0;
    final profit = row['estimated_profit'] as double? ?? 0;
    final deliveredSales = row['served_sales'] as double? ?? 0;
    final pendingSales = row['pending_sales'] as double? ?? 0;
    final orders = (row['orders'] as List<Map<String, dynamic>>?) ?? [];
    final balanceColor = wallet > 0
        ? AppColors.danger
        : (wallet < 0 ? AppColors.success : AppColors.text2);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpace.sm + 2),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        shape: const Border(),
        collapsedShape: const Border(),
        iconColor: AppColors.primary,
        collapsedIconColor: AppColors.muted,
        tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
        title: Text(
          storeName,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppText.bodyStrong,
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Row(
            children: [
              Text('Owed ', style: AppText.small),
              Text(
                Fmt.money(wallet),
                style: AppText.label.copyWith(
                  color: balanceColor,
                  fontFeatures: AppText.tabular,
                ),
              ),
              Text(
                ' · ${Fmt.count(totalOrders, 'order')}',
                style: AppText.small,
              ),
            ],
          ),
        ),
        children: [
          AdminTileGrid(
            columns: 3,
            spacing: AppSpace.sm,
            children: [
              AdminCountChip(
                label: 'Delivered',
                value: delivered,
                foreground: AppColors.success,
                background: AppColors.successBg,
              ),
              AdminCountChip(
                label: 'Pending',
                value: pending,
                foreground: AppColors.warning,
                background: AppColors.warningBg,
              ),
              AdminCountChip(
                label: 'Cancelled',
                value: cancelled,
                foreground: AppColors.danger,
                background: AppColors.dangerBg,
              ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          InfoRow(label: 'Gross sales', value: Fmt.money(gross.round())),
          InfoRow(label: 'Net sales', value: Fmt.money(net.round())),
          InfoRow(label: 'Discount', value: Fmt.money(discount.round())),
          InfoRow(label: 'Cost', value: Fmt.money(cost.round())),
          InfoRow(
            label: 'Estimated profit',
            value: Fmt.money(profit.round()),
            valueColor: profit >= 0 ? AppColors.success : AppColors.danger,
          ),
          InfoRow(
            label: 'Delivered sales',
            value: Fmt.money(deliveredSales.round()),
          ),
          InfoRow(
            label: 'Pending sales',
            value: Fmt.money(pendingSales.round()),
          ),
          const Divider(height: AppSpace.xl),
          if (orders.isEmpty)
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text('No orders yet', style: AppText.small),
            )
          else ...[
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text('Recent orders', style: AppText.label),
            ),
            const SizedBox(height: AppSpace.xs),
            ...orders.take(5).map((o) {
              final number = (o['order_number'] ?? '').toString();
              final status = (o['status'] ?? '').toString();
              final amount = o['amount'] as double? ?? 0;
              final created = o['created_at'] as DateTime?;
              return Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: AppRadius.controlAll,
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            Fmt.orderNumber(number, fallbackId: o['id']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.bodyStrong,
                          ),
                          if (created != null && created.year > 1970)
                            Text(Fmt.dateTime(created), style: AppText.caption),
                        ],
                      ),
                    ),
                    StatusPill(status: status, dense: true),
                    const SizedBox(width: AppSpace.sm),
                    Text(
                      Fmt.money(amount.round()),
                      style: AppText.price.copyWith(fontSize: 14),
                    ),
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredStoreRows();
    final totals = _summaryTotals(filtered);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Store Balances'),
        actions: const [NotificationBellWidget()],
      ),
      body: RefreshIndicator(
        onRefresh: _loadStoreBalances,
        child: _isLoading
            ? const SkeletonList(count: 5)
            : _error != null
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  EmptyState(
                    isError: true,
                    icon: Icons.cloud_off_rounded,
                    title: _error!,
                    message: 'Check the connection and try again.',
                    actionLabel: 'Retry',
                    actionIcon: Icons.refresh_rounded,
                    onAction: _loadStoreBalances,
                  ),
                ],
              )
            : SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Amount owed, sales and order counts per store.',
                      style: AppText.small,
                    ),
                    const SizedBox(height: AppSpace.md),
                    _buildStoreSearchField(),
                    const SizedBox(height: AppSpace.md),
                    if (_storeFilterOptions.isNotEmpty) ...[
                      _buildFilterDropdown(),
                      const SizedBox(height: AppSpace.md),
                    ],
                    _buildBalanceFilterDropdown(),
                    const SizedBox(height: AppSpace.md),
                    _buildTabChips(),
                    const SizedBox(height: AppSpace.md),
                    AdminTileGrid(
                      columns: 3,
                      spacing: AppSpace.sm,
                      children: [
                        AdminStatTile(
                          label: 'Stores',
                          value: Fmt.number(filtered.length),
                        ),
                        AdminStatTile(
                          label: 'Orders',
                          value: Fmt.number(totals['orders']),
                        ),
                        AdminStatTile(
                          label: 'Net sales',
                          value: Fmt.money(
                            (totals['net_sales'] as double).round(),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.md),
                    if (filtered.isEmpty)
                      const EmptyState(
                        compact: true,
                        icon: Icons.filter_alt_off_rounded,
                        title: 'No stores match these filters',
                      )
                    else
                      ...filtered.map(_buildCard),
                  ],
                ),
              ),
      ),
    );
  }
}
