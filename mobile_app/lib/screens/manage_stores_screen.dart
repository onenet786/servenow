import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/admin/admin_ui.dart';
import '../widgets/ui/ui.dart';

class ManageStoresScreen extends StatefulWidget {
  const ManageStoresScreen({super.key});

  @override
  State<ManageStoresScreen> createState() => _ManageStoresScreenState();
}

class _ManageStoresScreenState extends State<ManageStoresScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  bool _hasError = false;
  List<dynamic> _stores = [];
  List<dynamic> _filteredStores = [];
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadStores();
    _searchController.addListener(_applySearch);
  }

  @override
  void dispose() {
    _searchController.removeListener(_applySearch);
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadStores() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final stores = await ApiService.getStoresForAdmin(
        token,
        includeInactive: true,
      );

      setState(() {
        _stores = stores;
        _filteredStores = stores;
        _isLoading = false;
        _hasError = false;
      });
      _applySearch();
    } catch (e) {
      _logger.e('Error loading stores: $e');
      if (mounted) {
        setState(() {
          _isLoading = false;
          _hasError = _stores.isEmpty;
        });
        if (_stores.isNotEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not refresh stores.')),
          );
        }
      }
    }
  }

  void _applySearch() {
    final q = _searchController.text.trim().toLowerCase();
    if (q.isEmpty) {
      setState(() => _filteredStores = _stores);
      return;
    }
    setState(() {
      _filteredStores = _stores.where((s) {
        final name = (s['name'] ?? s['store_name'] ?? '').toString().toLowerCase();
        final id = (s['id'] ?? '').toString();
        final location = (s['location'] ?? '').toString().toLowerCase();
        return name.contains(q) || id.contains(q) || location.contains(q);
      }).toList();
    });
  }

  /// Account state of the store. The API has no `status` column for
  /// stores (the old screen showed "inactive" for every store); the real
  /// flags are `is_active` and `is_customer_visible`.
  bool _isActive(dynamic store) => adminFlag(store['is_active'], fallback: true);
  bool _isVisible(dynamic store) =>
      adminFlag(store['is_customer_visible'], fallback: true);

  @override
  Widget build(BuildContext context) {
    final activeCount = _stores.where(_isActive).length;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Stores')),
      body: _isLoading
          ? const SkeletonList(count: 5)
          : _hasError
          ? EmptyState(
              isError: true,
              icon: Icons.cloud_off_rounded,
              title: 'Could not load stores',
              message: 'Check the connection and try again.',
              actionLabel: 'Retry',
              actionIcon: Icons.refresh_rounded,
              onAction: () {
                setState(() => _isLoading = true);
                _loadStores();
              },
            )
          : RefreshIndicator(
              onRefresh: _loadStores,
              child: _stores.isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: const [
                        EmptyState(
                          icon: Icons.storefront_rounded,
                          title: 'No stores yet',
                        ),
                      ],
                    )
                  : Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                          child: TextField(
                            controller: _searchController,
                            textInputAction: TextInputAction.search,
                            decoration: const InputDecoration(
                              hintText: 'Search by name, ID or location',
                              prefixIcon: Icon(Icons.search),
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 6, 16, 2),
                          child: Row(
                            children: [
                              Text(
                                '${Fmt.count(_stores.length, 'store')} · ${Fmt.number(activeCount)} active',
                                style: AppText.small,
                              ),
                            ],
                          ),
                        ),
                        Expanded(
                          child: _filteredStores.isEmpty
                              ? ListView(
                                  physics:
                                      const AlwaysScrollableScrollPhysics(),
                                  children: const [
                                    EmptyState(
                                      compact: true,
                                      icon: Icons.search_off_rounded,
                                      title: 'No matching store',
                                      message: 'Try another name or ID.',
                                    ),
                                  ],
                                )
                              : ListView.separated(
                                  padding: const EdgeInsets.fromLTRB(
                                    16,
                                    8,
                                    16,
                                    24,
                                  ),
                                  physics:
                                      const AlwaysScrollableScrollPhysics(),
                                  itemCount: _filteredStores.length,
                                  separatorBuilder: (_, _) =>
                                      const SizedBox(height: AppSpace.md),
                                  itemBuilder: (context, index) {
                                    final store = _filteredStores[index];
                                    return _buildStoreCard(store);
                                  },
                                ),
                        ),
                      ],
                    ),
            ),
    );
  }

  Widget _buildStoreCard(dynamic store) {
    final active = _isActive(store);
    final visible = _isVisible(store);
    final manuallyClosed = adminFlag(store['is_closed']);
    final withinHours = _checkIsOpen(
      store['opening_time'],
      store['closing_time'],
    );
    final open = active && !manuallyClosed && withinHours;
    final hours = Fmt.hours(
      store['opening_time']?.toString(),
      store['closing_time']?.toString(),
    );
    final overnight = _isOvernight(
      store['opening_time'],
      store['closing_time'],
    );
    final closedNote = !active
        ? 'Inactive store'
        : manuallyClosed
        ? 'Closed by admin'
        : (!withinHours ? 'Outside opening hours' : null);
    final email = (store['email'] ?? '').toString().trim();
    final phone = (store['phone'] ?? '').toString().trim();
    final address = (store['address'] ?? '').toString().trim();

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  (store['name'] ?? store['store_name'] ?? 'Store').toString(),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.title,
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              OpenBadge(isOpen: open),
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
              if (!visible) const TonePill.warning('Hidden from customers'),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Row(
            children: [
              const Icon(Icons.schedule_rounded, size: 16, color: AppColors.muted),
              const SizedBox(width: AppSpace.xs + 2),
              Expanded(
                child: Text(
                  hours.isEmpty
                      ? 'Hours not set'
                      : (overnight ? '$hours (next day)' : hours),
                  style: AppText.small.copyWith(color: AppColors.text),
                ),
              ),
            ],
          ),
          if (closedNote != null) ...[
            const SizedBox(height: 2),
            Text(closedNote, style: AppText.caption),
          ],
          const Divider(height: AppSpace.xl),
          InfoRow(
            icon: Icons.call_outlined,
            label: 'Phone',
            value: phone.isEmpty ? '-' : phone,
          ),
          InfoRow(
            icon: Icons.mail_outline_rounded,
            label: 'E-mail',
            value: email.isEmpty ? '-' : email,
          ),
          InfoRow(
            icon: Icons.place_outlined,
            label: 'Address',
            value: address.isEmpty ? '-' : address,
            maxLines: 2,
          ),
        ],
      ),
    );
  }

  bool _isOvernight(dynamic openTimeStr, dynamic closeTimeStr) {
    try {
      final open = openTimeStr.toString().split(':');
      final close = closeTimeStr.toString().split(':');
      final o = int.parse(open[0]) * 60 + int.parse(open[1]);
      final c = int.parse(close[0]) * 60 + int.parse(close[1]);
      return c < o;
    } catch (_) {
      return false;
    }
  }

  bool _checkIsOpen(dynamic openTimeStr, dynamic closeTimeStr) {
    if (openTimeStr == null || closeTimeStr == null) return false;

    try {
      final now = DateTime.now();
      final currentTime = TimeOfDay.fromDateTime(now);

      TimeOfDay parseTime(String timeStr) {
        final parts = timeStr.split(':');
        return TimeOfDay(
          hour: int.parse(parts[0]),
          minute: int.parse(parts[1]),
        );
      }

      final openTime = parseTime(openTimeStr.toString());
      final closeTime = parseTime(closeTimeStr.toString());

      final double nowDouble = currentTime.hour + currentTime.minute / 60.0;
      final double openDouble = openTime.hour + openTime.minute / 60.0;
      final double closeDouble = closeTime.hour + closeTime.minute / 60.0;

      if (openDouble <= closeDouble) {
        return nowDouble >= openDouble && nowDouble <= closeDouble;
      } else {
        // Handle overnight hours (e.g., 22:00 - 04:00)
        return nowDouble >= openDouble || nowDouble <= closeDouble;
      }
    } catch (e) {
      return false;
    }
  }
}
