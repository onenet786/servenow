import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class InventoryReportScreen extends StatefulWidget {
  const InventoryReportScreen({super.key});

  @override
  State<InventoryReportScreen> createState() => _InventoryReportScreenState();
}

class _InventoryReportScreenState extends State<InventoryReportScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  String _selectedReportType = 'store';
  List<dynamic> _storeItems = [];
  List<dynamic> _categoryItems = [];
  List<dynamic> _breakdownItems = [];
  List<dynamic> _salesItems = [];
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
      final salesData = await ApiService.getStoreSalesReport(token);

      setState(() {
        _storeItems = data['store_wise'] ?? [];
        _categoryItems = data['category_wise'] ?? [];
        _breakdownItems = data['store_category_breakdown'] ?? [];
        _salesItems = salesData['store_sales'] ?? [];
        _totalStats = data['summary'];
        _isLoading = false;
      });
    } catch (e) {
      _logger.e('Error loading inventory report: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error loading report: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[100],
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        title: const Text(
          'Inventory Report',
          style: TextStyle(color: Colors.black87, fontWeight: FontWeight.bold),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.black87),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadInventoryReport,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16.0),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildReportSelector(),
                    const SizedBox(height: 20),
                    _buildTotalStatsCard(),
                    const SizedBox(height: 24),
                    if (_selectedReportType == 'store')
                      _buildStoreInventorySection()
                    else if (_selectedReportType == 'category')
                      _buildCategoryInventorySection()
                    else if (_selectedReportType == 'breakdown')
                      _buildBreakdownSection()
                    else if (_selectedReportType == 'sales')
                      _buildSalesReportSection(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildReportSelector() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: DropdownButton<String>(
        value: _selectedReportType,
        isExpanded: true,
        underline: const SizedBox.shrink(),
        items: const [
          DropdownMenuItem(value: 'store', child: Text('Store-wise Inventory')),
          DropdownMenuItem(value: 'category', child: Text('Category-wise Inventory')),
          DropdownMenuItem(value: 'breakdown', child: Text('Store-Category Breakdown')),
          DropdownMenuItem(value: 'sales', child: Text('Store Sales Report')),
        ],
        onChanged: (value) {
          if (value != null) {
            setState(() {
              _selectedReportType = value;
            });
          }
        },
      ),
    );
  }

  Widget _buildTotalStatsCard() {
    if (_totalStats == null) {
      return const SizedBox.shrink();
    }

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Colors.indigo.shade400, Colors.indigo.shade700],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.indigo.withValues(alpha: 0.3),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Total Inventory Summary',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildStatItem(
                'Total Items',
                _totalStats['total_items']?.toString() ?? '0',
                Icons.inventory,
              ),
              _buildStatItem(
                'Total Quantity',
                _totalStats['total_quantity']?.toString() ?? '0',
                Icons.shopping_bag,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildStatItem(
                'Total Value',
                'PKR ${(_totalStats['total_inventory_value'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                Icons.monetization_on,
              ),
              _buildStatItem(
                'Average Price',
                'PKR ${(_totalStats['average_price'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                Icons.price_check,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, IconData icon) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, color: Colors.white, size: 18),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Widget _buildStoreInventorySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Inventory by Store',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: 12),
        if (_storeItems.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Text(
                'No store inventory data',
                style: TextStyle(color: Colors.grey[600]),
              ),
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _storeItems.length,
            separatorBuilder: (context, index) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final item = _storeItems[index];
              return _buildStoreInventoryCard(item);
            },
          ),
      ],
    );
  }

  Widget _buildStoreInventoryCard(dynamic item) {
    final storeItems = item['items'] as List<dynamic>? ?? [];

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ExpansionTile(
        title: Text(
          item['store_name'] ?? 'Unknown Store',
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            color: Colors.black87,
          ),
        ),
        subtitle: Text(
          '${storeItems.length} items | Value: PKR ${(item['total_value'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
          style: TextStyle(color: Colors.grey[600], fontSize: 12),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildInfoRow('Total Items', storeItems.length.toString()),
                _buildInfoRow(
                  'Total Quantity',
                  (item['total_quantity'] ?? 0).toString(),
                ),
                _buildInfoRow(
                  'Total Value',
                  'PKR ${(item['total_value'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                ),
                const Divider(height: 16),
                const Text(
                  'Products:',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                ...storeItems.map(
                  (product) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4.0),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            product['product_name'] ?? 'Unknown',
                            style: const TextStyle(fontSize: 12),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Text(
                          'Qty: ${product['stock_quantity'] ?? 0}',
                          style: const TextStyle(fontSize: 11),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'PKR ${(product['price'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryInventorySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Inventory by Category',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: 12),
        if (_categoryItems.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Text(
                'No category inventory data',
                style: TextStyle(color: Colors.grey[600]),
              ),
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _categoryItems.length,
            separatorBuilder: (context, index) => const SizedBox(height: 8),
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

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ExpansionTile(
        title: Text(
          item['category_name'] ?? 'Unknown Category',
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            color: Colors.black87,
          ),
        ),
        subtitle: Text(
          '${products.length} products | Qty: ${item['total_quantity'] ?? 0}',
          style: TextStyle(color: Colors.grey[600], fontSize: 12),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildInfoRow('Total Products', products.length.toString()),
                _buildInfoRow(
                  'Total Quantity',
                  (item['total_quantity'] ?? 0).toString(),
                ),
                _buildInfoRow(
                  'Total Value',
                  'PKR ${(item['inventory_value'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                ),
                const Divider(height: 16),
                const Text(
                  'Products:',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                ...products.map(
                  (product) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4.0),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                product['product_name'] ?? 'Unknown',
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w500,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                'Store: ${product['store_name'] ?? 'Unknown'}',
                                style: TextStyle(
                                  fontSize: 10,
                                  color: Colors.grey[600],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              'Qty: ${product['stock_quantity'] ?? 0}',
                              style: const TextStyle(fontSize: 11),
                            ),
                            Text(
                              'PKR ${(product['price'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBreakdownSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Store-Category Breakdown',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: 12),
        if (_breakdownItems.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Text(
                'No breakdown data',
                style: TextStyle(color: Colors.grey[600]),
              ),
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _breakdownItems.length,
            separatorBuilder: (context, index) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final item = _breakdownItems[index];
              return _buildBreakdownCard(item);
            },
          ),
      ],
    );
  }

  Widget _buildBreakdownCard(dynamic item) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
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
                        item['store_name'] ?? 'Unknown Store',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Colors.black87,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item['category_name'] ?? 'No Category',
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 16),
            _buildInfoRow('Products', (item['product_count'] ?? 0).toString()),
            _buildInfoRow('Quantity', (item['stock_quantity'] ?? 0).toString()),
            _buildInfoRow(
              'Value',
              'PKR ${(item['inventory_value'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSalesReportSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Store Sales Report',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: 12),
        if (_salesItems.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Text(
                'No sales data',
                style: TextStyle(color: Colors.grey[600]),
              ),
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _salesItems.length,
            separatorBuilder: (context, index) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final item = _salesItems[index];
              return _buildSalesCard(item);
            },
          ),
      ],
    );
  }

  Widget _buildSalesCard(dynamic item) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item['store_name'] ?? 'Unknown Store',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.black87,
                fontSize: 14,
              ),
            ),
            const Divider(height: 16),
            _buildInfoRow('Total Orders', (item['total_orders'] ?? 0).toString()),
            _buildInfoRow(
              'Total Sales',
              'PKR ${(item['total_sales'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
            ),
            _buildInfoRow(
              'Average Order Value',
              'PKR ${(item['average_order_value'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
            ),
            _buildInfoRow(
              'Unique Customers',
              (item['unique_customers'] ?? 0).toString(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[600], fontSize: 12)),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
