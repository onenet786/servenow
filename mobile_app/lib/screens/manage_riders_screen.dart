import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class ManageRidersScreen extends StatefulWidget {
  const ManageRidersScreen({super.key});

  @override
  State<ManageRidersScreen> createState() => _ManageRidersScreenState();
}

class _ManageRidersScreenState extends State<ManageRidersScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  List<dynamic> _riders = [];
  List<dynamic> _filteredRiders = [];
  String _statusFilter = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadRiders();
    _searchController.addListener(_filterRiders);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadRiders() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final riders = await ApiService.getRiders(token);

      setState(() {
        _riders = riders;
        _filteredRiders = riders;
        _isLoading = false;
      });
    } catch (e) {
      _logger.e('Error loading riders: $e');
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Error loading riders: $e')));
      }
    }
  }

  void _filterRiders() {
    final query = _searchController.text.toLowerCase();
    final List<dynamic> filtered = _riders.where((rider) {
      final name = '${rider['first_name']} ${rider['last_name']}'.toLowerCase();
      final email = (rider['email'] ?? '').toString().toLowerCase();
      final status = (rider['status'] ?? '').toString();

      final matchesSearch = name.contains(query) || email.contains(query);
      final matchesStatus = _statusFilter.isEmpty || status == _statusFilter;

      return matchesSearch && matchesStatus;
    }).toList();

    setState(() => _filteredRiders = filtered);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[100],
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        title: const Text(
          'Manage Riders',
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
              onRefresh: _loadRiders,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      children: [
                        TextField(
                          controller: _searchController,
                          decoration: InputDecoration(
                            hintText: 'Search by name or email...',
                            prefixIcon: const Icon(Icons.search),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              _buildFilterChip('All', ''),
                              _buildFilterChip('Active', 'active'),
                              _buildFilterChip('Inactive', 'inactive'),
                              _buildFilterChip('Suspended', 'suspended'),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: _filteredRiders.isEmpty
                        ? Center(
                            child: Text(
                              'No riders found',
                              style: TextStyle(color: Colors.grey[600]),
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: _filteredRiders.length,
                            itemBuilder: (context, index) {
                              final rider = _filteredRiders[index];
                              return _buildRiderCard(rider);
                            },
                          ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildFilterChip(String label, String status) {
    final isSelected = _statusFilter == status;
    return Padding(
      padding: const EdgeInsets.only(right: 8.0),
      child: FilterChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (selected) {
          setState(() => _statusFilter = selected ? status : '');
          _filterRiders();
        },
        backgroundColor: Colors.white,
        selectedColor: Colors.indigo.withAlpha((0.2 * 255).round()),
        side: BorderSide(color: isSelected ? Colors.indigo : Colors.grey[300]!),
      ),
    );
  }

  Widget _buildRiderCard(dynamic rider) {
    final status = rider['status'] ?? 'active';
    final Color statusColor = status == 'active'
        ? Colors.green
        : status == 'inactive'
        ? Colors.orange
        : Colors.red;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withAlpha((0.1 * 255).round()),
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
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${rider['first_name']} ${rider['last_name']}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        rider['email'] ?? 'No email',
                        style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withAlpha((0.2 * 255).round()),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    status.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: statusColor,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildInfoColumn('Phone', rider['phone'] ?? '-'),
                _buildInfoColumn(
                  'Deliveries',
                  '${rider['total_deliveries'] ?? 0}',
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildInfoColumn('Rating', '${rider['rating'] ?? 'N/A'}'),
                _buildInfoColumn('Vehicle', rider['vehicle_type'] ?? '-'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoColumn(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[600])),
        Text(
          value.length > 15 ? '${value.substring(0, 15)}...' : value,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
        ),
      ],
    );
  }
}
