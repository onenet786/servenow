import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/admin/admin_ui.dart';
import '../widgets/ui/ui.dart';

class InventoryReportScreen extends StatefulWidget {
  const InventoryReportScreen({super.key});

  @override
  State<InventoryReportScreen> createState() => _InventoryReportScreenState();
}

class _InventoryReportScreenState extends State<InventoryReportScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  bool _hasError = false;
  List<dynamic> _storeItems = [];
  List<dynamic> _categoryItems = [];
  dynamic _totalStats;

  @override
  void initState() {
    super.initState();
    _loadInventoryReport();
  }

  Future<void> _loadInventoryReport() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final data = await ApiService.getInventoryReport(token);
      final rawStoreItems =
          (data['store_items'] as List?) ?? (data['store_wise'] as List?) ?? [];
      final rawCategoryItems =
          (data['category_items'] as List?) ??
          (data['category_wise'] as List?) ??
          [];
      final breakdown = (data['store_category_breakdown'] as List?) ?? [];
      final summary = data['total_stats'] ?? data['summary'];

      final storeBreakdownMap = <String, List<Map<String, dynamic>>>{};
      final categoryBreakdownMap = <String, List<Map<String, dynamic>>>{};

      for (final row in breakdown) {
        final item = Map<String, dynamic>.from(row as Map);
        final storeKey = (item['store_id'] ?? '').toString();
        final categoryKey = (item['category_id'] ?? '').toString();
        final stockQty = _asInt(item['stock_quantity']);
        final value = _asDouble(item['inventory_value']);
        final unitPrice = stockQty > 0 ? value / stockQty : 0.0;

        storeBreakdownMap.putIfAbsent(storeKey, () => []).add({
          'product_name': item['category_name'] ?? 'Uncategorized',
          'stock_quantity': stockQty,
          'price': unitPrice,
          'inventory_value': value,
        });

        categoryBreakdownMap.putIfAbsent(categoryKey, () => []).add({
          'product_name': item['store_name'] ?? 'Unknown Store',
          'store_name': item['store_name'] ?? 'Unknown Store',
          'stock_quantity': stockQty,
          'price': unitPrice,
          'inventory_value': value,
        });
      }

      final normalizedStoreItems = rawStoreItems.map((row) {
        final item = Map<String, dynamic>.from(row as Map);
        final storeKey = (item['store_id'] ?? '').toString();
        return {
          ...item,
          'items':
              (item['items'] as List?) ??
              storeBreakdownMap[storeKey] ??
              <Map>[],
          'total_quantity': _asInt(
            item['total_quantity'] ?? item['total_stock'],
          ),
          'total_value': _asDouble(
            item['total_value'] ?? item['total_inventory_value'],
          ),
        };
      }).toList();

      final normalizedCategoryItems = rawCategoryItems.map((row) {
        final item = Map<String, dynamic>.from(row as Map);
        final categoryKey = (item['category_id'] ?? '').toString();
        return {
          ...item,
          'products':
              (item['products'] as List?) ??
              categoryBreakdownMap[categoryKey] ??
              <Map>[],
          'total_quantity': _asInt(
            item['total_quantity'] ?? item['total_stock'],
          ),
          'inventory_value': _asDouble(
            item['inventory_value'] ?? item['total_inventory_value'],
          ),
          'total_products': _asInt(item['total_products']) > 0
              ? _asInt(item['total_products'])
              : ((item['products'] as List?)?.length ??
                    (categoryBreakdownMap[categoryKey]?.length ?? 0)),
        };
      }).toList();

      setState(() {
        _storeItems = normalizedStoreItems;
        _categoryItems = normalizedCategoryItems;
        _totalStats = summary;
        _isLoading = false;
        _hasError = false;
      });
    } catch (e) {
      _logger.e('Error loading inventory report: $e');
      if (mounted) {
        setState(() {
          _isLoading = false;
          _hasError = _totalStats == null && _storeItems.isEmpty;
        });
        if (!_hasError) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not refresh the report.')),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Inventory report')),
      body: _isLoading
          ? const SkeletonList(count: 4)
          : _hasError
          ? EmptyState(
              isError: true,
              icon: Icons.cloud_off_rounded,
              title: 'Could not load the report',
              message: 'Check the connection and try again.',
              actionLabel: 'Retry',
              actionIcon: Icons.refresh_rounded,
              onAction: () {
                setState(() => _isLoading = true);
                _loadInventoryReport();
              },
            )
          : RefreshIndicator(
              onRefresh: _loadInventoryReport,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildTotalStatsCard(),
                    const SizedBox(height: AppSpace.xxl),
                    _buildStoreInventorySection(),
                    const SizedBox(height: AppSpace.xxl),
                    _buildCategoryInventorySection(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildTotalStatsCard() {
    if (_totalStats == null) {
      return const SizedBox.shrink();
    }
    final stats = _totalStats as Map;
    final totalProducts = _asInt(stats['total_products']);
    final totalItems = _asInt(stats['total_items'] ?? stats['total_products']);
    final totalQuantity = _asInt(
      stats['total_quantity'] ?? stats['total_stock'],
    );
    final totalValue = _asDouble(stats['total_inventory_value']);
    final averagePrice =
        _asNum(stats['average_price'])?.toDouble() ??
        (totalValue / (totalProducts == 0 ? 1 : totalProducts));

    return AdminPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const AdminIconBadge(icon: Icons.inventory_2_rounded),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text('Total inventory', style: AppText.h2),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.lg),
          // One value per tile, each scaled to fit: the old card put
          // "Total Value" and "Average Price" side by side and they ran
          // together ("PKR 1666428172.00PKR 1038920.31").
          AdminTileGrid(
            columns: 2,
            children: [
              AdminStatTile(
                icon: Icons.category_outlined,
                label: 'Products',
                value: Fmt.number(totalItems),
              ),
              AdminStatTile(
                icon: Icons.shopping_bag_outlined,
                label: 'Units in stock',
                value: Fmt.number(totalQuantity),
              ),
              AdminStatTile(
                icon: Icons.payments_outlined,
                label: 'Stock value',
                value: Fmt.money(totalValue.round()),
              ),
              AdminStatTile(
                icon: Icons.sell_outlined,
                label: 'Average price',
                value: Fmt.money(averagePrice.round()),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title, String subtitle) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(header: true, child: Text(title, style: AppText.h2)),
          const SizedBox(height: 2),
          Text(subtitle, style: AppText.small),
        ],
      ),
    );
  }

  Widget _buildStoreInventorySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('By store', Fmt.count(_storeItems.length, 'store')),
        if (_storeItems.isEmpty)
          const AdminPanel(
            child: EmptyState(
              compact: true,
              icon: Icons.storefront_rounded,
              title: 'No store inventory data',
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _storeItems.length,
            separatorBuilder: (context, index) =>
                const SizedBox(height: AppSpace.sm),
            itemBuilder: (context, index) {
              final item = _storeItems[index];
              return _buildStoreInventoryCard(item);
            },
          ),
      ],
    );
  }

  Widget _expandableCard({
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        shape: const Border(),
        collapsedShape: const Border(),
        tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
        iconColor: AppColors.primary,
        collapsedIconColor: AppColors.muted,
        title: Text(
          title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppText.bodyStrong,
        ),
        subtitle: Text(subtitle, style: AppText.small),
        children: children,
      ),
    );
  }

  Widget _breakdownRow({
    required String name,
    String? caption,
    required int quantity,
    required double price,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.body,
                ),
                if (caption != null)
                  Text(
                    caption,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption,
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${Fmt.number(quantity)} units',
                style: AppText.small.copyWith(fontFeatures: AppText.tabular),
              ),
              Text(
                '${Fmt.money(price.round())} / unit',
                style: AppText.label.copyWith(
                  color: AppColors.text,
                  fontFeatures: AppText.tabular,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStoreInventoryCard(dynamic item) {
    final storeItems = item['items'] as List<dynamic>? ?? [];
    final totalValue = _asDouble(item['total_value']);
    final totalQuantity = _asInt(item['total_quantity']);

    return _expandableCard(
      title: (item['store_name'] ?? 'Store').toString(),
      subtitle:
          '${Fmt.number(totalQuantity)} units · ${Fmt.money(totalValue.round())}',
      children: [
        InfoRow(label: 'Categories', value: Fmt.number(storeItems.length)),
        InfoRow(label: 'Units in stock', value: Fmt.number(totalQuantity)),
        InfoRow(
          label: 'Stock value',
          value: Fmt.money(totalValue.round()),
          emphasize: true,
        ),
        if (storeItems.isNotEmpty) ...[
          const Divider(height: AppSpace.xl),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text('By category', style: AppText.label),
          ),
          const SizedBox(height: AppSpace.xs),
          ...storeItems.map(
            (product) => _breakdownRow(
              name: (product['product_name'] ?? 'Uncategorized').toString(),
              quantity: _asInt(product['stock_quantity']),
              price: _asDouble(product['price']),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildCategoryInventorySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle(
          'By category',
          Fmt.count(_categoryItems.length, 'category', 'categories'),
        ),
        if (_categoryItems.isEmpty)
          const AdminPanel(
            child: EmptyState(
              compact: true,
              icon: Icons.category_outlined,
              title: 'No category inventory data',
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _categoryItems.length,
            separatorBuilder: (context, index) =>
                const SizedBox(height: AppSpace.sm),
            itemBuilder: (context, index) {
              final item = _categoryItems[index];
              return _buildCategoryInventoryCard(item);
            },
          ),
      ],
    );
  }

  Widget _buildCategoryInventoryCard(dynamic item) {
    final products = item['products'] as List<dynamic>? ?? [];
    final totalProducts = _asInt(item['total_products'] ?? products.length);
    final totalQuantity = _asInt(item['total_quantity']);
    final totalValue = _asDouble(item['inventory_value']);

    return _expandableCard(
      title: (item['category_name'] ?? 'Uncategorized').toString(),
      subtitle:
          '${Fmt.count(totalProducts, 'product')} · ${Fmt.number(totalQuantity)} units',
      children: [
        InfoRow(label: 'Products', value: Fmt.number(totalProducts)),
        InfoRow(label: 'Units in stock', value: Fmt.number(totalQuantity)),
        InfoRow(
          label: 'Stock value',
          value: Fmt.money(totalValue.round()),
          emphasize: true,
        ),
        if (products.isNotEmpty) ...[
          const Divider(height: AppSpace.xl),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text('By store', style: AppText.label),
          ),
          const SizedBox(height: AppSpace.xs),
          ...products.map(
            (product) => _breakdownRow(
              name: (product['product_name'] ?? 'Unknown').toString(),
              caption:
                  product['store_name'] != null &&
                      product['store_name'] != product['product_name']
                  ? 'Store: ${product['store_name']}'
                  : null,
              quantity: _asInt(product['stock_quantity']),
              price: _asDouble(product['price']),
            ),
          ),
        ],
      ],
    );
  }

  num? _asNum(dynamic value) {
    if (value == null) return null;
    if (value is num) return value;
    return num.tryParse(value.toString());
  }

  int _asInt(dynamic value) {
    final n = _asNum(value);
    return n?.toInt() ?? 0;
  }

  double _asDouble(dynamic value) {
    final n = _asNum(value);
    return n?.toDouble() ?? 0.0;
  }
}
