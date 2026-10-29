import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/admin/admin_ui.dart';
import '../widgets/ui/ui.dart';

class ManageRidersScreen extends StatefulWidget {
  const ManageRidersScreen({super.key});

  @override
  State<ManageRidersScreen> createState() => _ManageRidersScreenState();
}

class _ManageRidersScreenState extends State<ManageRidersScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  bool _hasError = false;
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
        _hasError = false;
      });
      _filterRiders();
    } catch (e) {
      _logger.e('Error loading riders: $e');
      if (mounted) {
        setState(() {
          _isLoading = false;
          _hasError = _riders.isEmpty;
        });
        if (_riders.isNotEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not refresh riders.')),
          );
        }
      }
    }
  }

  /// `GET /api/riders` returns `full_name` (or first/last name) and the
  /// flags `is_active` / `is_available` - there is no `status`, delivery
  /// count or rating column, so the old "ACTIVE / Deliveries 0 / Rating
  /// N/A" values were defaults, not data.
  String _name(dynamic rider) {
    final full = (rider['full_name'] ?? '').toString().trim();
    if (full.isNotEmpty) return full;
    final name = '${rider['first_name'] ?? ''} ${rider['last_name'] ?? ''}'
        .trim();
    return name.isEmpty ? 'Rider #${rider['id'] ?? '-'}' : name;
  }

  bool _isActive(dynamic rider) =>
      adminFlag(rider['is_active'], fallback: true);
  bool _isAvailable(dynamic rider) => adminFlag(rider['is_available']);

  void _filterRiders() {
    final query = _searchController.text.toLowerCase();
    final List<dynamic> filtered = _riders.where((rider) {
      final name = _name(rider).toLowerCase();
      final email = (rider['email'] ?? '').toString().toLowerCase();
      final phone = (rider['phone'] ?? '').toString().toLowerCase();

      final matchesSearch =
          name.contains(query) ||
          email.contains(query) ||
          phone.contains(query);
      final matchesStatus = switch (_statusFilter) {
        'active' => _isActive(rider),
        'inactive' => !_isActive(rider),
        'available' => _isActive(rider) && _isAvailable(rider),
        _ => true,
      };

      return matchesSearch && matchesStatus;
    }).toList();

    setState(() => _filteredRiders = filtered);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Riders')),
      body: _isLoading
          ? const SkeletonList(count: 5)
          : _hasError
          ? EmptyState(
              isError: true,
              icon: Icons.cloud_off_rounded,
              title: 'Could not load riders',
              message: 'Check the connection and try again.',
              actionLabel: 'Retry',
              actionIcon: Icons.refresh_rounded,
              onAction: () {
                setState(() => _isLoading = true);
                _loadRiders();
              },
            )
          : RefreshIndicator(
              onRefresh: _loadRiders,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: Column(
                      children: [
                        TextField(
                          controller: _searchController,
                          textInputAction: TextInputAction.search,
                          decoration: const InputDecoration(
                            hintText: 'Search by name, e-mail or phone',
                            prefixIcon: Icon(Icons.search),
                          ),
                        ),
                        const SizedBox(height: AppSpace.md),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              _buildFilterChip('All', ''),
                              _buildFilterChip('Active', 'active'),
                              _buildFilterChip('Available now', 'available'),
                              _buildFilterChip('Inactive', 'inactive'),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: _filteredRiders.isEmpty
                        ? ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: [
                              EmptyState(
                                compact: true,
                                icon: Icons.two_wheeler_rounded,
                                title: _riders.isEmpty
                                    ? 'No riders yet'
                                    : 'No riders match',
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                            physics: const AlwaysScrollableScrollPhysics(),
                            itemCount: _filteredRiders.length,
                            separatorBuilder: (_, _) =>
                                const SizedBox(height: AppSpace.md),
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
      padding: const EdgeInsetsDirectional.only(end: 8.0),
      child: ChoiceChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (selected) {
          setState(() => _statusFilter = selected ? status : '');
          _filterRiders();
        },
      ),
    );
  }

  Widget _buildRiderCard(dynamic rider) {
    final active = _isActive(rider);
    final available = _isAvailable(rider);
    final name = _name(rider);
    final email = (rider['email'] ?? '').toString().trim();
    final phone = (rider['phone'] ?? '').toString().trim();
    final vehicle = adminHumanize(rider['vehicle_type']);
    final joined = Fmt.date(rider['created_at']);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: AppColors.tint100,
                child: Text(
                  name.isEmpty ? 'R' : name[0].toUpperCase(),
                  style: AppText.title.copyWith(color: AppColors.primaryDeep),
                ),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                    if (email.isNotEmpty)
                      Text(
                        email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Wrap(
            spacing: AppSpace.sm,
            runSpacing: AppSpace.xs,
            children: [
              if (active)
                const TonePill.success('Active')
              else
                const TonePill.neutral('Inactive'),
              if (active)
                available
                    ? const TonePill.info('Available')
                    : const TonePill.neutral('Off duty'),
            ],
          ),
          const Divider(height: AppSpace.xl),
          InfoRow(
            icon: Icons.call_outlined,
            label: 'Phone',
            value: phone.isEmpty ? '-' : phone,
          ),
          InfoRow(
            icon: Icons.two_wheeler_rounded,
            label: 'Vehicle',
            value: vehicle,
          ),
          InfoRow(
            icon: Icons.account_balance_wallet_outlined,
            label: 'Wallet',
            value: Fmt.money(rider['wallet_balance']),
          ),
          if (joined.isNotEmpty)
            InfoRow(icon: Icons.event_outlined, label: 'Joined', value: joined),
        ],
      ),
    );
  }
}
