import 'package:flutter/material.dart';
import 'package:logger/logger.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';

class AdminStoreDetailReportScreen extends StatefulWidget {
  final int storeId;
  final String storeName;

  const AdminStoreDetailReportScreen({
    super.key,
    required this.storeId,
    required this.storeName,
  });

  @override
  State<AdminStoreDetailReportScreen> createState() =>
      _AdminStoreDetailReportScreenState();
}

class _AdminStoreDetailReportScreenState
    extends State<AdminStoreDetailReportScreen> {
  final _logger = Logger();
  bool _isLoading = true;
  List<dynamic> _products = [];
  List<dynamic> _orders = [];
  double _totalRevenue = 0;
  int _completedOrders = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      // Fetch store details and products
      final storeData = await ApiService.getStoreDetails(widget.storeId);

      // Fetch store orders for stats
      final orders = await ApiService.getAllOrders(
        token,
        storeId: widget.storeId,
      );

      // Calculate stats
      double revenue = 0;
      int completed = 0;
      for (var order in orders) {
        if (order['status'] == 'delivered') {
          completed++;
          revenue += (double.tryParse(order['total_amount'].toString()) ?? 0);
        }
      }

      setState(() {
        _products = storeData['products'] ?? [];
        _orders = orders;
        _totalRevenue = revenue;
        _completedOrders = completed;
        _isLoading = false;
      });
    } catch (e) {
      _logger.e('Error loading store report: $e');
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error loading report: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('${widget.storeName} Report')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildStatsCard(),
                  const SizedBox(height: 20),
                  const Text(
                    'Products Stock & Status',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 10),
                  _buildProductsList(),
                ],
              ),
            ),
    );
  }

  Widget _buildStatsCard() {
    return Card(
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatItem('Total Orders', '${_orders.length}'),
                _buildStatItem('Delivered', '$_completedOrders'),
                _buildStatItem(
                  'Revenue',
                  'PKR ${_totalRevenue.toStringAsFixed(2)}',
                  color: Colors.green,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatItem(String label, String value, {Color? color}) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: color ?? Colors.black87,
          ),
        ),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
      ],
    );
  }

  Widget _buildProductsList() {
    if (_products.isEmpty) {
      return const Text('No products found');
    }
    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _products.length,
      separatorBuilder: (context, index) => const Divider(),
      itemBuilder: (context, index) {
        final product = _products[index];
        final stock = product['stock_quantity'] ?? 0;
        final isAvailable =
            product['is_available'] == 1 || product['is_available'] == true;

        return ListTile(
          contentPadding: EdgeInsets.zero,
          leading: product['image_url'] != null
              ? Image.network(
                  ApiService.getImageUrl(product['image_url']),
                  width: 50,
                  height: 50,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const Icon(Icons.image, size: 40),
                )
              : const Icon(Icons.image, size: 40),
          title: Text(product['name']),
          subtitle: Text('Price: PKR ${product['price']}'),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                'Stock: $stock',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: stock < 10 ? Colors.red : Colors.black,
                ),
              ),
              Text(
                isAvailable ? 'Active' : 'Inactive',
                style: TextStyle(
                  fontSize: 12,
                  color: isAvailable ? Colors.green : Colors.grey,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
