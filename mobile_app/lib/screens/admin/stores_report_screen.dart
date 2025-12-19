import 'package:flutter/material.dart';
import 'package:logger/logger.dart';
import '../../services/api_service.dart';
import 'store_detail_report_screen.dart';

class AdminStoresReportScreen extends StatefulWidget {
  const AdminStoresReportScreen({super.key});

  @override
  State<AdminStoresReportScreen> createState() =>
      _AdminStoresReportScreenState();
}

class _AdminStoresReportScreenState extends State<AdminStoresReportScreen> {
  final _logger = Logger();
  bool _isLoading = true;
  List<dynamic> _stores = [];

  @override
  void initState() {
    super.initState();
    _loadStores();
  }

  Future<void> _loadStores() async {
    try {
      final stores = await ApiService.getStores();
      setState(() {
        _stores = stores;
        _isLoading = false;
      });
    } catch (e) {
      _logger.e('Error loading stores: $e');
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error loading stores: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stores Report')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              itemCount: _stores.length,
              itemBuilder: (context, index) {
                final store = _stores[index];
                return Card(
                  margin: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  child: ListTile(
                    leading: store['image_url'] != null
                        ? Image.network(
                            ApiService.getImageUrl(store['image_url']),
                            width: 50,
                            height: 50,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) =>
                                const Icon(Icons.store, size: 40),
                          )
                        : const Icon(Icons.store, size: 40),
                    title: Text(store['name'] ?? 'Unnamed'),
                    subtitle: Text(store['location'] ?? 'No location'),
                    trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => AdminStoreDetailReportScreen(
                            storeId: store['id'],
                            storeName: store['name'] ?? 'Store',
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
    );
  }
}
